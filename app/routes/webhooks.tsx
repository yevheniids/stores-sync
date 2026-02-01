/**
 * Unified Webhook Handler
 *
 * Single endpoint that handles ALL Shopify webhook topics.
 * Verifies HMAC signature, checks idempotency, and queues jobs for async processing.
 *
 * Supported webhook topics:
 * - orders/create: Decrease inventory for each line item
 * - orders/cancelled: Restore inventory for cancelled orders
 * - refunds/create: Restore inventory if items are restocked
 * - inventory_levels/update: Manual inventory adjustments in Shopify admin
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { logger } from "~/lib/logger.server";
import {
  isProcessed,
  createWebhookEvent,
  markProcessed,
  markFailed,
} from "~/lib/utils/idempotency.server";
import { idToGid } from "~/lib/helpers";
import { isRedisAvailable } from "~/lib/redis.server";
import {
  enqueueOrderCreated,
  enqueueOrderCancelled,
  enqueueRefundCreated,
  enqueueInventoryUpdate,
} from "~/lib/queue/jobs.server";
import { unifiedInventoryUpdate } from "~/lib/db/inventory-queries.server";
import type {
  OrderCreatedJobData,
  OrderCancelledJobData,
  RefundCreatedJobData,
  InventoryUpdateJobData,
} from "~/lib/queue/jobs.server";
import {
  processOrderCreated,
  processOrderCancelled,
  processRefundCreated,
  processInventoryUpdate,
} from "~/lib/queue/workers/webhook-processor.worker";

/**
 * Webhook action handler
 * All webhooks POST to /webhooks or /api/webhooks/*
 * This is the unified handler for all webhook topics
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify webhook signature using Shopify's authenticate.webhook
  const { topic, shop, session, admin, payload } = await authenticate.webhook(
    request
  );

  // Extract webhook event ID from headers
  const eventId = request.headers.get("X-Shopify-Webhook-Id");

  if (!eventId) {
    logger.error("Webhook received without event ID", undefined, {
      topic,
      shop,
    });
    return new Response("Missing webhook event ID", { status: 400 });
  }

  logger.webhook(topic, shop, eventId);

  // Check idempotency - have we already processed this webhook?
  const alreadyProcessed = await isProcessed(eventId);

  if (alreadyProcessed) {
    logger.info("Webhook already processed, skipping", {
      eventId,
      topic,
      shop,
    });
    return new Response("Webhook already processed", { status: 200 });
  }

  try {
    // Create webhook event record for tracking
    await createWebhookEvent(eventId, topic, shop, payload);

    // Route to appropriate handler based on topic
    switch (topic) {
      case "ORDERS_CREATE":
        await handleOrderCreated(eventId, shop, payload);
        break;

      case "ORDERS_CANCELLED":
        await handleOrderCancelled(eventId, shop, payload);
        break;

      case "REFUNDS_CREATE":
        await handleRefundCreated(eventId, shop, payload);
        break;

      case "INVENTORY_LEVELS_UPDATE":
        await handleInventoryUpdate(eventId, shop, payload);
        break;

      case "APP_UNINSTALLED":
        await handleAppUninstalled(shop, payload);
        break;

      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE":
        await handleProductCreateOrUpdate(eventId, shop, payload);
        break;

      case "PRODUCTS_DELETE":
        await handleProductDelete(eventId, shop, payload);
        break;

      default:
        logger.warn("Unknown webhook topic received", {
          eventId,
          topic,
          shop,
        });
        await markProcessed(eventId, topic, shop, payload);
        break;
    }

    // Return 200 immediately - processing happens async
    return new Response("Webhook queued for processing", { status: 200 });
  } catch (error) {
    logger.error("Webhook processing failed", error, {
      eventId,
      topic,
      shop,
    });

    // Mark as failed for retry
    await markFailed(
      eventId,
      error instanceof Error ? error.message : "Unknown error"
    );

    // Still return 200 to prevent Shopify from retrying immediately
    // Our queue will handle retries with exponential backoff
    return new Response("Webhook failed but queued for retry", { status: 200 });
  }
};

/**
 * Handle orders/create webhook
 * Decreases inventory for each line item in the order
 */
async function handleOrderCreated(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  const data: OrderCreatedJobData = {
    eventId,
    shopDomain,
    order: payload,
    timestamp: new Date().toISOString(),
  };

  if (isRedisAvailable) {
    await enqueueOrderCreated(data);
    logger.info("Order created webhook queued", { eventId, shopDomain, orderId: payload.id });
  } else {
    await processOrderCreated(data);
    await markProcessed(eventId, "ORDERS_CREATE", shopDomain, payload);
    logger.info("Order created webhook processed inline", { eventId, shopDomain, orderId: payload.id });
  }
}

/**
 * Handle orders/cancelled webhook
 * Restores inventory for cancelled orders
 */
async function handleOrderCancelled(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  const data: OrderCancelledJobData = {
    eventId,
    shopDomain,
    order: payload,
    timestamp: new Date().toISOString(),
  };

  if (isRedisAvailable) {
    await enqueueOrderCancelled(data);
    logger.info("Order cancelled webhook queued", { eventId, shopDomain, orderId: payload.id });
  } else {
    await processOrderCancelled(data);
    await markProcessed(eventId, "ORDERS_CANCELLED", shopDomain, payload);
    logger.info("Order cancelled webhook processed inline", { eventId, shopDomain, orderId: payload.id });
  }
}

/**
 * Handle refunds/create webhook
 * Restores inventory only for items that are restocked
 */
async function handleRefundCreated(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  const data: RefundCreatedJobData = {
    eventId,
    shopDomain,
    refund: payload,
    timestamp: new Date().toISOString(),
  };

  if (isRedisAvailable) {
    await enqueueRefundCreated(data);
    logger.info("Refund created webhook queued", { eventId, shopDomain, refundId: payload.id });
  } else {
    await processRefundCreated(data);
    await markProcessed(eventId, "REFUNDS_CREATE", shopDomain, payload);
    logger.info("Refund created webhook processed inline", { eventId, shopDomain, refundId: payload.id });
  }
}

/**
 * Handle inventory_levels/update webhook
 * Detects manual inventory adjustments made in Shopify admin
 */
async function handleInventoryUpdate(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  const data: InventoryUpdateJobData = {
    eventId,
    shopDomain,
    inventoryLevel: payload,
    timestamp: new Date().toISOString(),
  };

  if (isRedisAvailable) {
    await enqueueInventoryUpdate(data);
    logger.info("Inventory update webhook queued", { eventId, shopDomain, inventoryItemId: payload.inventory_item_id });
  } else {
    await processInventoryUpdate(data);
    await markProcessed(eventId, "INVENTORY_LEVELS_UPDATE", shopDomain, payload);
    logger.info("Inventory update webhook processed inline", { eventId, shopDomain, inventoryItemId: payload.inventory_item_id });
  }
}

/**
 * Handle app/uninstalled webhook
 * Clean up store data when app is uninstalled
 */
async function handleAppUninstalled(
  shopDomain: string,
  payload: any
): Promise<void> {
  try {
    const { prisma } = await import("~/db.server");

    // Mark store as inactive
    await prisma.store.update({
      where: { shopDomain },
      data: {
        isActive: false,
        syncEnabled: false,
      },
    });

    logger.info("App uninstalled - store marked as inactive", {
      shopDomain,
    });
  } catch (error) {
    logger.error("Failed to handle app uninstalled webhook", error, {
      shopDomain,
    });
    throw error;
  }
}

/**
 * Handle products/create and products/update webhooks
 * Creates or updates the product in the central registry and maps it to the store
 */
async function handleProductCreateOrUpdate(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  try {
    const { prisma } = await import("~/db.server");

    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) {
      logger.warn("Store not found for product webhook", { shopDomain });
      await markProcessed(eventId, "PRODUCTS_CREATE", shopDomain, payload);
      return;
    }

    // Process each variant in the product
    const variants = payload.variants || [];
    let processedCount = 0;

    for (const variant of variants) {
      const sku = variant.sku;
      if (!sku) {
        logger.debug("Skipping variant without SKU", {
          variantId: variant.id,
          productId: payload.id,
        });
        continue;
      }

      // Upsert product in central registry
      const product = await prisma.product.upsert({
        where: { sku },
        create: {
          sku,
          title: payload.title || `Product ${sku}`,
          description: payload.body_html || undefined,
          vendor: payload.vendor || undefined,
          productType: payload.product_type || undefined,
          tags: payload.tags ? payload.tags.split(",").map((t: string) => t.trim()) : [],
          imageUrl: payload.images?.[0]?.src || undefined,
          weight: variant.grams ? variant.grams : undefined,
          weightUnit: variant.weight_unit || "g",
          inventoryPolicy: variant.inventory_policy === "continue" ? "CONTINUE" : "DENY",
          tracksInventory: variant.inventory_management === "shopify",
        },
        update: {
          title: payload.title || undefined,
          description: payload.body_html || undefined,
          vendor: payload.vendor || undefined,
          productType: payload.product_type || undefined,
          tags: payload.tags ? payload.tags.split(",").map((t: string) => t.trim()) : [],
          imageUrl: payload.images?.[0]?.src || undefined,
        },
      });

      // Upsert store mapping — use GID format to match catalog sync
      const productGid = idToGid(payload.id, "Product");
      const variantGid = idToGid(variant.id, "ProductVariant");
      const inventoryItemGid = variant.inventory_item_id
        ? idToGid(variant.inventory_item_id, "InventoryItem")
        : undefined;

      await prisma.productStoreMapping.upsert({
        where: {
          productId_storeId: {
            productId: product.id,
            storeId: store.id,
          },
        },
        create: {
          productId: product.id,
          storeId: store.id,
          shopifyProductId: productGid,
          shopifyVariantId: variantGid,
          shopifyInventoryItemId: inventoryItemGid,
          price: variant.price ? parseFloat(variant.price) : undefined,
          compareAtPrice: variant.compare_at_price
            ? parseFloat(variant.compare_at_price)
            : undefined,
          storeSku: sku,
          barcode: variant.barcode || undefined,
          syncStatus: "COMPLETED",
          lastSyncedAt: new Date(),
        },
        update: {
          shopifyProductId: productGid,
          shopifyVariantId: variantGid,
          shopifyInventoryItemId: inventoryItemGid,
          price: variant.price ? parseFloat(variant.price) : undefined,
          compareAtPrice: variant.compare_at_price
            ? parseFloat(variant.compare_at_price)
            : undefined,
          barcode: variant.barcode || undefined,
          lastSyncedAt: new Date(),
        },
      });

      // Upsert inventory record via unified function
      if (variant.inventory_management === "shopify") {
        await unifiedInventoryUpdate({
          sku,
          productId: product.id,
          adjustedBy: `webhook-product-${eventId}`,
          setAggregate: {
            availableQuantity: variant.inventory_quantity || 0,
          },
        });
      }

      processedCount++;
    }

    // Record sync operation
    await prisma.syncOperation.create({
      data: {
        operationType: "PRODUCT_CREATE",
        direction: "STORE_TO_CENTRAL",
        storeId: store.id,
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
        triggeredBy: `webhook-${eventId}`,
        newValue: {
          shopifyProductId: payload.id,
          title: payload.title,
          variantsProcessed: processedCount,
        },
      },
    });

    await markProcessed(eventId, "PRODUCTS_CREATE", shopDomain, payload);

    logger.info("Product create/update webhook processed", {
      eventId,
      shopDomain,
      shopifyProductId: payload.id,
      title: payload.title,
      variantsProcessed: processedCount,
    });
  } catch (error) {
    logger.error("Failed to handle product create/update webhook", error, {
      eventId,
      shopDomain,
      productId: payload.id,
    });
    throw error;
  }
}

/**
 * Handle products/delete webhook
 * Marks the product mapping as deleted (keeps central product for audit)
 */
async function handleProductDelete(
  eventId: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  try {
    const { prisma } = await import("~/db.server");

    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) {
      logger.warn("Store not found for product delete webhook", { shopDomain });
      await markProcessed(eventId, "PRODUCTS_DELETE", shopDomain, payload);
      return;
    }

    // Find and remove mappings for this Shopify product (GID format)
    const productGid = idToGid(payload.id, "Product");
    const deletedMappings = await prisma.productStoreMapping.deleteMany({
      where: {
        storeId: store.id,
        shopifyProductId: productGid,
      },
    });

    // Record sync operation
    await prisma.syncOperation.create({
      data: {
        operationType: "PRODUCT_DELETE",
        direction: "STORE_TO_CENTRAL",
        storeId: store.id,
        status: "COMPLETED",
        startedAt: new Date(),
        completedAt: new Date(),
        triggeredBy: `webhook-${eventId}`,
        previousValue: {
          shopifyProductId: payload.id,
          mappingsRemoved: deletedMappings.count,
        },
      },
    });

    await markProcessed(eventId, "PRODUCTS_DELETE", shopDomain, payload);

    logger.info("Product delete webhook processed", {
      eventId,
      shopDomain,
      shopifyProductId: payload.id,
      mappingsRemoved: deletedMappings.count,
    });
  } catch (error) {
    logger.error("Failed to handle product delete webhook", error, {
      eventId,
      shopDomain,
      productId: payload.id,
    });
    throw error;
  }
}
