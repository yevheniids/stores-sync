/**
 * Webhook Processor Worker
 *
 * BullMQ worker that processes webhook jobs from the queue.
 * Handles different webhook topics and updates inventory accordingly.
 */

import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "~/lib/redis.server";
import { logger } from "~/lib/logger.server";
import { prisma } from "~/db.server";
import { markProcessed, markFailed } from "~/lib/utils/idempotency.server";
import type { WebhookProcessingJob } from "~/lib/queue.server";
import { WebhookJobType } from "~/lib/queue/jobs.server";
import type {
  OrderCreatedJobData,
  OrderCancelledJobData,
  RefundCreatedJobData,
  InventoryUpdateJobData,
} from "~/lib/queue/jobs.server";
import { gidToId, idToGid } from "~/lib/helpers";
import { getOrCreateLocation } from "~/lib/shopify/inventory.server";
import {
  upsertInventoryLocation,
  recalculateAggregateInventory,
} from "~/lib/db/inventory-queries.server";
import { sessionStorage as storage } from "~/shopify.server";

/**
 * Process webhook job
 */
async function processWebhookJob(job: Job<WebhookProcessingJob>): Promise<void> {
  const { webhookEventId, topic, shopDomain, payload } = job.data;

  logger.job("webhook-processing", job.id!, "processing", {
    eventId: webhookEventId,
    topic,
    shopDomain,
  });

  try {
    // Route to appropriate handler based on webhook type
    switch (payload.type) {
      case WebhookJobType.ORDER_CREATED:
        await processOrderCreated(payload as OrderCreatedJobData);
        break;

      case WebhookJobType.ORDER_CANCELLED:
        await processOrderCancelled(payload as OrderCancelledJobData);
        break;

      case WebhookJobType.REFUND_CREATED:
        await processRefundCreated(payload as RefundCreatedJobData);
        break;

      case WebhookJobType.INVENTORY_UPDATE:
        await processInventoryUpdate(payload as InventoryUpdateJobData);
        break;

      default:
        logger.warn("Unknown webhook job type", {
          eventId: webhookEventId,
          type: payload.type,
        });
        break;
    }

    // Mark webhook as successfully processed
    await markProcessed(webhookEventId, topic, shopDomain, payload);

    logger.job("webhook-processing", job.id!, "completed", {
      eventId: webhookEventId,
      topic,
      shopDomain,
    });
  } catch (error) {
    logger.error("Webhook job processing failed", error, {
      eventId: webhookEventId,
      topic,
      shopDomain,
      jobId: job.id,
    });

    // Mark as failed for retry tracking
    await markFailed(
      webhookEventId,
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error; // Re-throw to trigger BullMQ retry mechanism
  }
}

/**
 * Process order created webhook
 * Decreases inventory for each line item
 */
async function processOrderCreated(data: OrderCreatedJobData): Promise<void> {
  const { eventId, shopDomain, order } = data;

  logger.info("Processing order created", {
    eventId,
    shopDomain,
    orderId: order.id,
    lineItemCount: order.line_items.length,
  });

  // Get store from database
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    logger.error("Store not found for order webhook", undefined, {
      shopDomain,
      orderId: order.id,
    });
    throw new Error(`Store not found: ${shopDomain}`);
  }

  // Process each line item
  for (const lineItem of order.line_items) {
    try {
      await decreaseInventoryForLineItem(
        store.id,
        shopDomain,
        lineItem.sku,
        lineItem.quantity,
        `order-${order.id}`,
        eventId
      );
    } catch (error) {
      logger.error("Failed to decrease inventory for line item", error, {
        orderId: order.id,
        lineItemId: lineItem.id,
        sku: lineItem.sku,
        quantity: lineItem.quantity,
      });
      // Continue processing other line items even if one fails
    }
  }

  logger.info("Order created processed successfully", {
    eventId,
    orderId: order.id,
    lineItemsProcessed: order.line_items.length,
  });
}

/**
 * Process order cancelled webhook
 * Restores inventory for all line items
 */
async function processOrderCancelled(data: OrderCancelledJobData): Promise<void> {
  const { eventId, shopDomain, order } = data;

  logger.info("Processing order cancelled", {
    eventId,
    shopDomain,
    orderId: order.id,
    lineItemCount: order.line_items.length,
  });

  // Get store from database
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    logger.error("Store not found for order cancellation webhook", undefined, {
      shopDomain,
      orderId: order.id,
    });
    throw new Error(`Store not found: ${shopDomain}`);
  }

  // Restore inventory for each line item
  for (const lineItem of order.line_items) {
    try {
      await increaseInventoryForLineItem(
        store.id,
        shopDomain,
        lineItem.sku,
        lineItem.quantity,
        `order-cancelled-${order.id}`,
        eventId
      );
    } catch (error) {
      logger.error("Failed to restore inventory for cancelled line item", error, {
        orderId: order.id,
        lineItemId: lineItem.id,
        sku: lineItem.sku,
        quantity: lineItem.quantity,
      });
      // Continue processing other line items
    }
  }

  logger.info("Order cancelled processed successfully", {
    eventId,
    orderId: order.id,
    lineItemsProcessed: order.line_items.length,
  });
}

/**
 * Process refund created webhook
 * Restores inventory only for items marked as restocked
 */
async function processRefundCreated(data: RefundCreatedJobData): Promise<void> {
  const { eventId, shopDomain, refund } = data;

  logger.info("Processing refund created", {
    eventId,
    shopDomain,
    refundId: refund.id,
    orderId: refund.order_id,
    refundLineItemCount: refund.refund_line_items.length,
  });

  // Get store from database
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    logger.error("Store not found for refund webhook", undefined, {
      shopDomain,
      refundId: refund.id,
    });
    throw new Error(`Store not found: ${shopDomain}`);
  }

  // Process each refund line item
  let restoredCount = 0;
  for (const refundLineItem of refund.refund_line_items) {
    // Only restore inventory if items are being restocked
    if (refundLineItem.restock_type !== "no_restock") {
      try {
        await increaseInventoryForLineItem(
          store.id,
          shopDomain,
          refundLineItem.line_item.sku,
          refundLineItem.quantity,
          `refund-${refund.id}`,
          eventId
        );
        restoredCount++;
      } catch (error) {
        logger.error("Failed to restore inventory for refund line item", error, {
          refundId: refund.id,
          lineItemId: refundLineItem.line_item_id,
          sku: refundLineItem.line_item.sku,
          quantity: refundLineItem.quantity,
        });
      }
    } else {
      logger.debug("Skipping inventory restore for no_restock refund", {
        refundId: refund.id,
        lineItemId: refundLineItem.line_item_id,
        sku: refundLineItem.line_item.sku,
      });
    }
  }

  logger.info("Refund created processed successfully", {
    eventId,
    refundId: refund.id,
    totalItems: refund.refund_line_items.length,
    restoredItems: restoredCount,
  });
}

/**
 * Process inventory update webhook
 * Detects manual adjustments and syncs to central database.
 * Now writes per-location data and recalculates the aggregate.
 */
async function processInventoryUpdate(data: InventoryUpdateJobData): Promise<void> {
  const { eventId, shopDomain, inventoryLevel } = data;

  logger.info("Processing inventory update", {
    eventId,
    shopDomain,
    inventoryItemId: inventoryLevel.inventory_item_id,
    available: inventoryLevel.available,
    locationId: inventoryLevel.location_id,
  });

  // Get store from database
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    logger.error("Store not found for inventory update webhook", undefined, {
      shopDomain,
      inventoryItemId: inventoryLevel.inventory_item_id,
    });
    throw new Error(`Store not found: ${shopDomain}`);
  }

  // Find product mapping by inventory item ID
  const inventoryItemGid = idToGid(inventoryLevel.inventory_item_id, "InventoryItem");
  const mapping = await prisma.productStoreMapping.findFirst({
    where: {
      storeId: store.id,
      shopifyInventoryItemId: inventoryItemGid,
    },
    include: {
      product: {
        include: {
          inventory: true,
        },
      },
    },
  });

  if (!mapping) {
    // Also try with raw numeric string for backwards compatibility
    const mappingFallback = await prisma.productStoreMapping.findFirst({
      where: {
        storeId: store.id,
        shopifyInventoryItemId: inventoryLevel.inventory_item_id.toString(),
      },
      include: {
        product: {
          include: {
            inventory: true,
          },
        },
      },
    });

    if (!mappingFallback) {
      logger.warn("No product mapping found for inventory update", {
        inventoryItemId: inventoryLevel.inventory_item_id,
        shopDomain,
      });
      return;
    }

    // Use the fallback mapping — continue below with same logic
    await processInventoryUpdateForMapping(eventId, shopDomain, store, mappingFallback, inventoryLevel);
    return;
  }

  await processInventoryUpdateForMapping(eventId, shopDomain, store, mapping, inventoryLevel);
}

/**
 * Inner handler for processing inventory update once a mapping is resolved.
 */
async function processInventoryUpdateForMapping(
  eventId: string,
  shopDomain: string,
  store: { id: string; shopDomain?: string },
  mapping: any,
  inventoryLevel: { inventory_item_id: number; location_id: number; available: number }
): Promise<void> {
  // Check if this update was caused by our own sync to avoid loops
  const recentSyncOp = await prisma.syncOperation.findFirst({
    where: {
      productId: mapping.productId,
      storeId: store.id,
      operationType: "INVENTORY_UPDATE",
      status: "COMPLETED",
      completedAt: {
        gte: new Date(Date.now() - 60000), // Within last minute
      },
    },
    orderBy: {
      completedAt: "desc",
    },
  });

  if (recentSyncOp) {
    logger.debug("Skipping inventory update - caused by our own sync", {
      eventId,
      productId: mapping.productId,
      syncOpId: recentSyncOp.id,
    });
    return;
  }

  // Resolve the location from the webhook's numeric location_id
  const sessionId = `offline_${shopDomain}`;
  const session = await storage.loadSession(sessionId);

  if (!session) {
    logger.warn("No session for store, falling back to aggregate-only update", {
      shopDomain,
    });
    // Fall through to aggregate-only update below
  }

  const newAvailable = inventoryLevel.available;
  const currentInventory = mapping.product.inventory;
  const previousValue = currentInventory?.availableQuantity ?? 0;

  // Update per-location inventory if we can resolve the location
  if (session) {
    const storeLocation = await getOrCreateLocation(
      { shop: session.shop, accessToken: session.accessToken },
      store.id,
      inventoryLevel.location_id
    );

    await upsertInventoryLocation(mapping.productId, storeLocation.id, {
      availableQuantity: newAvailable,
      lastAdjustedBy: `webhook-${shopDomain}`,
    });

    // Recalculate aggregate from all location rows
    await recalculateAggregateInventory(mapping.productId);
  } else if (currentInventory) {
    // No session — update aggregate directly (legacy behavior)
    await prisma.inventory.update({
      where: { id: currentInventory.id },
      data: {
        availableQuantity: newAvailable,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: `webhook-${shopDomain}`,
      },
    });
  }

  // Record sync operation
  await prisma.syncOperation.create({
    data: {
      operationType: "INVENTORY_UPDATE",
      direction: "STORE_TO_CENTRAL",
      productId: mapping.productId,
      storeId: store.id,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      previousValue: { available: previousValue },
      newValue: { available: newAvailable },
      triggeredBy: `webhook-${eventId}`,
    },
  });

  logger.info("Inventory updated from manual adjustment", {
    eventId,
    productId: mapping.productId,
    sku: mapping.product.sku,
    locationId: inventoryLevel.location_id,
    previousValue,
    newValue: newAvailable,
    difference: newAvailable - previousValue,
  });
}

/**
 * Decrease inventory for a line item (order created)
 */
async function decreaseInventoryForLineItem(
  storeId: string,
  shopDomain: string,
  sku: string,
  quantity: number,
  reference: string,
  eventId: string
): Promise<void> {
  // Find product by SKU
  let product = await prisma.product.findUnique({
    where: { sku },
    include: {
      inventory: true,
      storeMappings: {
        where: { storeId },
      },
    },
  });

  if (!product) {
    // Try to discover the product from the source store
    logger.warn("Product not found for SKU in order, attempting discovery", {
      sku,
      reference,
      shopDomain,
    });

    const { discoverAndMapProduct } = await import("~/lib/sync/product-mapper.server");
    const mapping = await discoverAndMapProduct(shopDomain, sku);

    if (!mapping) {
      logger.error("Product not found and could not be discovered", {
        sku,
        shopDomain,
        reference,
      });
      return;
    }

    // Reload product with mappings after discovery
    product = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          where: { storeId },
        },
      },
    });

    if (!product) {
      logger.error("Product still not found after discovery", {
        sku,
        shopDomain,
      });
      return;
    }

    logger.info("Product discovered and mapped successfully", {
      sku,
      productId: product.id,
      shopDomain,
    });
  }

  // Create inventory record if it doesn't exist
  if (!product.inventory) {
    logger.info("Creating inventory record for product", {
      productId: product.id,
      sku,
      reference,
    });
    
    await prisma.inventory.create({
      data: {
        productId: product.id,
        availableQuantity: 0,
        committedQuantity: 0,
        incomingQuantity: 0,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: `webhook-${reference}`,
      },
    });
    
    // Reload product with inventory
    const updatedProduct = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          where: { storeId },
        },
      },
    });
    
    if (!updatedProduct || !updatedProduct.inventory) {
      logger.error("Failed to create inventory record", {
        productId: product.id,
        sku,
      });
      return;
    }
    
    product = updatedProduct;
  }

  const previousQuantity = product.inventory.availableQuantity;
  const newQuantity = Math.max(0, previousQuantity - quantity); // Don't go negative

  // Update central inventory
  await prisma.inventory.update({
    where: { id: product.inventory.id },
    data: {
      availableQuantity: newQuantity,
      committedQuantity: {
        increment: quantity,
      },
      lastAdjustedAt: new Date(),
      lastAdjustedBy: `webhook-${reference}`,
    },
  });

  // Record sync operation
  await prisma.syncOperation.create({
    data: {
      operationType: "INVENTORY_UPDATE",
      direction: "STORE_TO_CENTRAL",
      productId: product.id,
      storeId,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      previousValue: {
        available: previousQuantity,
        committed: product.inventory.committedQuantity,
      },
      newValue: {
        available: newQuantity,
        committed: product.inventory.committedQuantity + quantity,
      },
      triggeredBy: `webhook-${eventId}`,
    },
  });

  logger.sync(
    "INVENTORY_UPDATE",
    product.id,
    storeId,
    "completed"
  );
}

/**
 * Increase inventory for a line item (order cancelled or refund)
 */
async function increaseInventoryForLineItem(
  storeId: string,
  shopDomain: string,
  sku: string,
  quantity: number,
  reference: string,
  eventId: string
): Promise<void> {
  // Find product by SKU
  let product = await prisma.product.findUnique({
    where: { sku },
    include: {
      inventory: true,
      storeMappings: {
        where: { storeId },
      },
    },
  });

  if (!product) {
    // Try to discover the product from the source store
    logger.warn("Product not found for SKU in cancellation/refund, attempting discovery", {
      sku,
      reference,
      shopDomain,
    });

    const { discoverAndMapProduct } = await import("~/lib/sync/product-mapper.server");
    const mapping = await discoverAndMapProduct(shopDomain, sku);

    if (!mapping) {
      logger.error("Product not found and could not be discovered", {
        sku,
        shopDomain,
        reference,
      });
      return;
    }

    // Reload product with mappings after discovery
    product = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          where: { storeId },
        },
      },
    });

    if (!product) {
      logger.error("Product still not found after discovery", {
        sku,
        shopDomain,
      });
      return;
    }

    logger.info("Product discovered and mapped successfully", {
      sku,
      productId: product.id,
      shopDomain,
    });
  }

  // Create inventory record if it doesn't exist
  if (!product.inventory) {
    logger.info("Creating inventory record for product", {
      productId: product.id,
      sku,
      reference,
    });
    
    await prisma.inventory.create({
      data: {
        productId: product.id,
        availableQuantity: 0,
        committedQuantity: 0,
        incomingQuantity: 0,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: `webhook-${reference}`,
      },
    });
    
    // Reload product with inventory
    const updatedProduct = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          where: { storeId },
        },
      },
    });
    
    if (!updatedProduct || !updatedProduct.inventory) {
      logger.error("Failed to create inventory record", {
        productId: product.id,
        sku,
      });
      return;
    }
    
    product = updatedProduct;
  }

  const previousQuantity = product.inventory.availableQuantity;
  const previousCommitted = product.inventory.committedQuantity;
  const newQuantity = previousQuantity + quantity;
  const newCommitted = Math.max(0, previousCommitted - quantity); // Don't go negative

  // Update central inventory
  await prisma.inventory.update({
    where: { id: product.inventory.id },
    data: {
      availableQuantity: newQuantity,
      committedQuantity: newCommitted,
      lastAdjustedAt: new Date(),
      lastAdjustedBy: `webhook-${reference}`,
    },
  });

  // Record sync operation
  await prisma.syncOperation.create({
    data: {
      operationType: "INVENTORY_UPDATE",
      direction: "STORE_TO_CENTRAL",
      productId: product.id,
      storeId,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      previousValue: {
        available: previousQuantity,
        committed: previousCommitted,
      },
      newValue: {
        available: newQuantity,
        committed: newCommitted,
      },
      triggeredBy: `webhook-${eventId}`,
    },
  });

  logger.sync(
    "INVENTORY_UPDATE",
    product.id,
    storeId,
    "completed"
  );
}

/**
 * Create and export webhook processor worker
 */
export function createWebhookProcessorWorker(): Worker {
  const worker = new Worker(
    "webhook-processing",
    processWebhookJob,
    {
      connection: createBullMQConnection(),
      concurrency: 5, // Process up to 5 webhooks concurrently
      limiter: {
        max: 10, // Max 10 jobs
        duration: 1000, // Per second
      },
    }
  );

  // Worker event handlers
  worker.on("completed", (job) => {
    logger.job("webhook-processing", job.id!, "completed", {
      eventId: job.data.webhookEventId,
      topic: job.data.topic,
      duration: Date.now() - job.timestamp,
    });
  });

  worker.on("failed", (job, error) => {
    logger.error("Webhook job failed", error, {
      jobId: job?.id,
      eventId: job?.data.webhookEventId,
      topic: job?.data.topic,
      attemptsMade: job?.attemptsMade,
      attemptsRemaining: (job?.opts.attempts || 0) - (job?.attemptsMade || 0),
    });
  });

  worker.on("error", (error) => {
    logger.error("Webhook worker error", error);
  });

  logger.info("Webhook processor worker started", {
    concurrency: 5,
    queue: "webhook-processing",
  });

  return worker;
}

export default createWebhookProcessorWorker;
