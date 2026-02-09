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
import {
  getOrCreateLocation,
  updateInventoryLevel,
  getPrimaryLocation,
} from "~/lib/shopify/inventory.server";
import {
  unifiedInventoryUpdate,
  recordSyncOperation,
  getAllMappingsForProduct,
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
export async function processOrderCreated(data: OrderCreatedJobData): Promise<void> {
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
export async function processOrderCancelled(data: OrderCancelledJobData): Promise<void> {
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
export async function processRefundCreated(data: RefundCreatedJobData): Promise<void> {
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
export async function processInventoryUpdate(data: InventoryUpdateJobData): Promise<void> {
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
  // Check if this update was caused by our own outbound sync to avoid loops.
  // We compare BOTH time (within 15 seconds) AND value (same quantity we pushed).
  // A pure time-based check causes false positives when a new order on the same store
  // arrives shortly after we pushed inventory to it.
  const recentOutboundSync = await prisma.syncOperation.findFirst({
    where: {
      productId: mapping.productId,
      storeId: store.id,
      operationType: "INVENTORY_UPDATE",
      direction: "CENTRAL_TO_STORE",
      status: "COMPLETED",
      completedAt: {
        gte: new Date(Date.now() - 15000), // Within last 15 seconds
      },
    },
    orderBy: {
      completedAt: "desc",
    },
  });

  if (recentOutboundSync) {
    // Compare the value we pushed with the incoming webhook value.
    // If they match, this is an echo. If different, it's a genuine new change.
    const pushedAvailable = (recentOutboundSync.newValue as any)?.available;
    if (pushedAvailable === inventoryLevel.available) {
      logger.info("Skipping inventory update - echo from our own outbound sync (same value)", {
        eventId,
        productId: mapping.productId,
        syncOpId: recentOutboundSync.id,
        pushedValue: pushedAvailable,
        webhookValue: inventoryLevel.available,
      });
      return;
    }
    logger.info("Processing inventory update despite recent outbound sync - value differs (new change)", {
      eventId,
      productId: mapping.productId,
      pushedValue: pushedAvailable,
      webhookValue: inventoryLevel.available,
    });
  }

  // Resolve the location from the webhook's numeric location_id
  const sessionId = `offline_${shopDomain}`;
  const session = await storage.loadSession(sessionId);

  const newAvailable = inventoryLevel.available;

  if (session) {
    // Resolve location name from DB → absolute mode (per-location + recalculate)
    const storeLocation = await getOrCreateLocation(
      { shop: session.shop, accessToken: session.accessToken },
      store.id,
      inventoryLevel.location_id
    );

    const result = await unifiedInventoryUpdate({
      sku: mapping.product.sku,
      productId: mapping.productId,
      adjustedBy: `webhook-${shopDomain}`,
      absolute: {
        availableQuantity: newAvailable,
        locationName: storeLocation.name,
      },
    });

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
        previousValue: { available: result.previousAggregate.available },
        newValue: { available: result.newAggregate.available },
        triggeredBy: `webhook-${eventId}`,
      },
    });

    logger.info("Inventory updated from manual adjustment (absolute)", {
      eventId,
      productId: mapping.productId,
      sku: mapping.product.sku,
      locationId: inventoryLevel.location_id,
      previousValue: result.previousAggregate.available,
      newValue: result.newAggregate.available,
    });

    // Propagate to other stores — push the per-location value, not the aggregate
    await propagateInventoryToOtherStores({
      productId: mapping.productId,
      sku: mapping.product.sku,
      sourceStoreId: store.id,
      locationName: storeLocation.name,
      newAvailableQuantity: newAvailable,
      eventId,
    });
  } else {
    // No session — setAggregate fallback
    logger.warn("No session for store, falling back to setAggregate update", {
      shopDomain,
    });

    const result = await unifiedInventoryUpdate({
      sku: mapping.product.sku,
      productId: mapping.productId,
      adjustedBy: `webhook-${shopDomain}`,
      setAggregate: {
        availableQuantity: newAvailable,
      },
    });

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
        previousValue: { available: result.previousAggregate.available },
        newValue: { available: result.newAggregate.available },
        triggeredBy: `webhook-${eventId}`,
      },
    });

    logger.info("Inventory updated from manual adjustment (setAggregate)", {
      eventId,
      productId: mapping.productId,
      sku: mapping.product.sku,
      locationId: inventoryLevel.location_id,
      previousValue: result.previousAggregate.available,
      newValue: result.newAggregate.available,
    });

    // Cannot propagate without location name — no session to resolve location
    logger.warn("Skipping propagation: no session to resolve location name", {
      shopDomain,
      productId: mapping.productId,
    });
  }
}

/**
 * Propagate inventory change to all other stores (except the source).
 * Pushes the per-location value to the matching location (by name) on each target store.
 */
async function propagateInventoryToOtherStores(params: {
  productId: string;
  sku: string;
  sourceStoreId: string;
  locationName: string;
  newAvailableQuantity: number;
  eventId: string;
}): Promise<void> {
  const { productId, sku, sourceStoreId, locationName, newAvailableQuantity, eventId } = params;

  // Get all store mappings for this product
  const allMappings = await getAllMappingsForProduct(productId);
  const targetMappings = allMappings.filter(
    (m) => m.storeId !== sourceStoreId && m.store.isActive && m.store.syncEnabled
  );

  if (targetMappings.length === 0) {
    logger.debug("No target stores to propagate inventory to", { sku, productId });
    return;
  }

  logger.info("Propagating inventory to other stores", {
    sku,
    productId,
    locationName,
    targetStoreCount: targetMappings.length,
    newAvailableQuantity,
  });

  for (const mapping of targetMappings) {
    try {
      const targetShop = mapping.store.shopDomain;

      // Resolve access token: offline session > Store.accessToken
      let targetAccessToken: string | undefined;
      const offlineSession = await storage.loadSession(`offline_${targetShop}`);
      if (offlineSession?.accessToken) {
        targetAccessToken = offlineSession.accessToken;
      } else {
        const storeForToken = await prisma.store.findUnique({
          where: { shopDomain: targetShop },
          select: { accessToken: true },
        });
        targetAccessToken = storeForToken?.accessToken || undefined;
      }

      if (!targetAccessToken) {
        logger.warn("No access token for target store, skipping", { shopDomain: targetShop });
        continue;
      }

      if (!mapping.shopifyInventoryItemId) {
        logger.warn("No inventory item ID for mapping, skipping", {
          shopDomain: targetShop,
          productId,
        });
        continue;
      }

      // Find the target store's location with the same name
      const targetLocation = await prisma.storeLocation.findFirst({
        where: {
          storeId: mapping.storeId,
          name: locationName,
          isActive: true,
        },
      });

      if (!targetLocation) {
        logger.warn("No matching location found on target store, skipping", {
          shopDomain: targetShop,
          locationName,
        });
        continue;
      }

      // Push inventory to Shopify at the matching location
      await updateInventoryLevel(
        { shop: targetShop, accessToken: targetAccessToken },
        mapping.shopifyInventoryItemId,
        targetLocation.shopifyLocationId,
        newAvailableQuantity,
        `Synced inventory for location ${locationName}`
      );

      // Record CENTRAL_TO_STORE sync operation
      await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "CENTRAL_TO_STORE",
        productId,
        storeId: mapping.storeId,
        status: "COMPLETED",
        newValue: { available: newAvailableQuantity, location: locationName },
        triggeredBy: `webhook-${eventId}`,
      });

      logger.info("Inventory propagated to store", {
        sku,
        targetShop,
        locationName,
        newAvailableQuantity,
      });
    } catch (error) {
      logger.error("Failed to propagate inventory to store", error, {
        sku,
        targetShop: mapping.store.shopDomain,
        locationName,
        productId,
      });

      // Record failed sync but continue with other stores
      await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "CENTRAL_TO_STORE",
        productId,
        storeId: mapping.storeId,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        triggeredBy: `webhook-${eventId}`,
      });
    }
  }
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
  // Ensure product exists (discover if needed)
  let product = await prisma.product.findUnique({ where: { sku } });

  if (!product) {
    logger.warn("Product not found for SKU in order, attempting discovery", {
      sku, reference, shopDomain,
    });

    const { discoverAndMapProduct } = await import("~/lib/sync/product-mapper.server");
    const mapping = await discoverAndMapProduct(shopDomain, sku);

    if (!mapping) {
      logger.error("Product not found and could not be discovered", { sku, shopDomain, reference });
      return;
    }

    product = await prisma.product.findUnique({ where: { sku } });
    if (!product) {
      logger.error("Product still not found after discovery", { sku, shopDomain });
      return;
    }
  }

  // Only update committed quantity here.
  // The available quantity change is handled by the inventory_levels/update webhook
  // which carries the absolute value from Shopify and propagates to other stores.
  // This prevents double-counting when both webhooks fire for the same order.
  const result = await unifiedInventoryUpdate({
    sku,
    productId: product.id,
    adjustedBy: `webhook-${reference}`,
    delta: {
      availableQuantityChange: 0,
      committedQuantityChange: quantity,
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
        committed: result.previousAggregate.committed,
      },
      newValue: {
        committed: result.newAggregate.committed,
      },
      triggeredBy: `webhook-${eventId}`,
    },
  });

  logger.sync("INVENTORY_UPDATE", product.id, storeId, "completed");
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
  // Ensure product exists (discover if needed)
  let product = await prisma.product.findUnique({ where: { sku } });

  if (!product) {
    logger.warn("Product not found for SKU in cancellation/refund, attempting discovery", {
      sku, reference, shopDomain,
    });

    const { discoverAndMapProduct } = await import("~/lib/sync/product-mapper.server");
    const mapping = await discoverAndMapProduct(shopDomain, sku);

    if (!mapping) {
      logger.error("Product not found and could not be discovered", { sku, shopDomain, reference });
      return;
    }

    product = await prisma.product.findUnique({ where: { sku } });
    if (!product) {
      logger.error("Product still not found after discovery", { sku, shopDomain });
      return;
    }
  }

  // Only update committed quantity here.
  // The available quantity change is handled by the inventory_levels/update webhook
  // which carries the absolute value from Shopify and propagates to other stores.
  const result = await unifiedInventoryUpdate({
    sku,
    productId: product.id,
    adjustedBy: `webhook-${reference}`,
    delta: {
      availableQuantityChange: 0,
      committedQuantityChange: -quantity,
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
        committed: result.previousAggregate.committed,
      },
      newValue: {
        committed: result.newAggregate.committed,
      },
      triggeredBy: `webhook-${eventId}`,
    },
  });

  logger.sync("INVENTORY_UPDATE", product.id, storeId, "completed");
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
