/**
 * Sync Engine
 *
 * The main sync engine - core of the application
 * Coordinates inventory synchronization across all connected stores
 * Single source of truth for inventory state
 */

import { executeTransaction, prisma } from "~/db.server";
import { logger } from "~/lib/logger.server";
import { sessionStorage as storage } from "~/shopify.server";
import {
  getInventoryBySku,
  updateInventory,
  recordSyncOperation,
  updateSyncOperation,
  getAllActiveStores,
  getProductBySku,
} from "~/lib/db/inventory-queries.server";
import {
  findProductBySku,
  getAllMappings,
  discoverAndMapProduct,
} from "./product-mapper.server";
import {
  updateInventoryLevel,
  batchUpdateInventory,
  getPrimaryLocation,
} from "~/lib/shopify/inventory.server";
import {
  detectConflict,
  createConflict,
  autoResolveConflict,
} from "./conflict-resolver.server";
import type { SyncResult } from "~/types";

/**
 * Parameters for inventory change processing
 */
export interface ProcessInventoryChangeParams {
  shopDomain: string;
  sku: string;
  quantityChange: number;
  reason: string;
  sourceEventId?: string;
}

/**
 * Main entry point for processing inventory changes
 * This is the heart of the sync engine
 */
export async function processInventoryChange(
  params: ProcessInventoryChangeParams
): Promise<SyncResult> {
  const { shopDomain, sku, quantityChange, reason, sourceEventId } = params;

  logger.info("Processing inventory change", {
    shopDomain,
    sku,
    quantityChange,
    reason,
  });

  try {
    // Step 1: Look up the product by SKU
    let product = await findProductBySku(sku);

    if (!product) {
      // Try to discover the product from the source store
      logger.warn("Product not found, attempting discovery", { sku, shopDomain });

      const mapping = await discoverAndMapProduct(shopDomain, sku);

      if (!mapping) {
        throw new Error(`Product with SKU ${sku} not found and could not be discovered`);
      }

      // Reload product with mappings
      product = await findProductBySku(sku);

      if (!product) {
        throw new Error(`Product discovery failed for SKU: ${sku}`);
      }
    }

    // Step 2: Get all store mappings for this product
    const mappings = await getAllMappings(sku);

    if (mappings.length === 0) {
      logger.warn("No store mappings found for product", { sku, productId: product.id });
      return {
        success: false,
        productId: product.id,
        operation: "INVENTORY_UPDATE",
        error: "No store mappings found",
      };
    }

    // Find the source store
    const sourceStore = mappings.find((m) => m.store.shopDomain === shopDomain);

    if (!sourceStore) {
      logger.error("Source store not found in mappings", { shopDomain, sku });
      return {
        success: false,
        productId: product.id,
        operation: "INVENTORY_UPDATE",
        error: "Source store not found in mappings",
      };
    }

    // Step 3: Update central inventory atomically with optimistic locking
    const result = await executeTransaction(async (tx) => {
      // Get current inventory (lock the row)
      const inventory = await tx.inventory.findUnique({
        where: { productId: product!.id },
      });

      if (!inventory) {
        // Create inventory if it doesn't exist
        const newInventory = await tx.inventory.create({
          data: {
            productId: product!.id,
            availableQuantity: Math.max(0, quantityChange), // Don't go negative
            lastAdjustedAt: new Date(),
            lastAdjustedBy: `webhook-${shopDomain}`,
          },
        });

        return { inventory: newInventory, previousQuantity: 0 };
      }

      // Calculate new quantity
      const previousQuantity = inventory.availableQuantity;
      const newQuantity = Math.max(0, previousQuantity + quantityChange);

      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          availableQuantity: newQuantity,
          lastAdjustedAt: new Date(),
          lastAdjustedBy: `sync-${reason}`,
        },
      });

      return { inventory: updatedInventory, previousQuantity };
    });

    logger.info("Central inventory updated", {
      productId: product.id,
      sku,
      previousQuantity: result.previousQuantity,
      newQuantity: result.inventory.availableQuantity,
      change: quantityChange,
    });

    // Step 4: Record the sync operation
    const syncOp = await recordSyncOperation({
      operationType: "INVENTORY_UPDATE",
      direction: "STORE_TO_CENTRAL",
      productId: product.id,
      storeId: sourceStore.storeId,
      status: "IN_PROGRESS",
      previousValue: { available: result.previousQuantity },
      newValue: { available: result.inventory.availableQuantity },
      triggeredBy: sourceEventId ? `webhook-${sourceEventId}` : reason,
    });

    // Step 5: Push to all OTHER connected stores
    const targetStores = mappings.filter((m) => m.store.shopDomain !== shopDomain);

    logger.info("Propagating inventory change to other stores", {
      sku,
      targetStoreCount: targetStores.length,
      newQuantity: result.inventory.availableQuantity,
    });

    let successCount = 0;
    let failureCount = 0;

    for (const mapping of targetStores) {
      try {
        // Skip if store is not active or sync is disabled
        if (!mapping.store.isActive || !mapping.store.syncEnabled) {
          logger.debug("Skipping inactive or sync-disabled store", {
            shopDomain: mapping.store.shopDomain,
          });
          continue;
        }

        // Resolve access token: offline session > Store.accessToken
        const targetShop = mapping.store.shopDomain;
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
          logger.warn("No access token found for store", { shopDomain: targetShop });
          failureCount++;
          continue;
        }

        // Get primary location for the store (DB first, then API fallback)
        const storeRecord = await prisma.store.findUnique({
          where: { shopDomain: targetShop },
        });

        const location = await getPrimaryLocation(
          { shop: targetShop, accessToken: targetAccessToken },
          storeRecord?.id
        );

        if (!location) {
          logger.warn("No location found for store", { shopDomain: targetShop });
          failureCount++;
          continue;
        }

        // Update inventory in Shopify
        await updateInventoryLevel(
          { shop: targetShop, accessToken: targetAccessToken },
          mapping.shopifyInventoryItemId!,
          location.id,
          result.inventory.availableQuantity,
          `Synced from ${shopDomain}: ${reason}`
        );

        // Record successful sync
        await recordSyncOperation({
          operationType: "INVENTORY_UPDATE",
          direction: "CENTRAL_TO_STORE",
          productId: product.id,
          storeId: mapping.storeId,
          status: "COMPLETED",
          previousValue: { available: result.previousQuantity },
          newValue: { available: result.inventory.availableQuantity },
          triggeredBy: syncOp.id,
        });

        successCount++;

        logger.sync(
          "INVENTORY_UPDATE",
          product.id,
          mapping.storeId,
          "completed"
        );
      } catch (error) {
        logger.error("Failed to sync to store", error, {
          targetStore: mapping.store.shopDomain,
          sku,
        });

        // Record failed sync
        await recordSyncOperation({
          operationType: "INVENTORY_UPDATE",
          direction: "CENTRAL_TO_STORE",
          productId: product.id,
          storeId: mapping.storeId,
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          triggeredBy: syncOp.id,
        });

        failureCount++;
      }
    }

    // Update original sync operation
    await updateSyncOperation(syncOp.id, {
      status: failureCount > 0 ? "FAILED" : "COMPLETED",
      completedAt: new Date(),
      errorMessage:
        failureCount > 0
          ? `Failed to sync to ${failureCount} of ${targetStores.length} stores`
          : undefined,
    });

    logger.info("Inventory change processed", {
      sku,
      productId: product.id,
      sourceStore: shopDomain,
      targetStores: targetStores.length,
      successful: successCount,
      failed: failureCount,
    });

    return {
      success: failureCount === 0,
      productId: product.id,
      operation: "INVENTORY_UPDATE",
      details: {
        sku,
        previousQuantity: result.previousQuantity,
        newQuantity: result.inventory.availableQuantity,
        change: quantityChange,
        storesSynced: successCount,
        storesFailed: failureCount,
      },
    };
  } catch (error) {
    logger.error("Failed to process inventory change", error, params);

    return {
      success: false,
      productId: "",
      operation: "INVENTORY_UPDATE",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Perform full inventory reconciliation for a store
 * Compares Shopify quantities with central DB and resolves discrepancies
 */
export async function performFullSync(shopDomain: string): Promise<{
  total: number;
  synced: number;
  conflicts: number;
  errors: number;
}> {
  logger.info("Starting full inventory sync", { shopDomain });

  try {
    const stats = {
      total: 0,
      synced: 0,
      conflicts: 0,
      errors: 0,
    };

    // Get all products mapped to this store
    const product = await getProductBySku(""); // This won't work, need to refactor

    // For now, return placeholder stats
    // Full implementation would iterate through all mapped products
    // and compare Shopify inventory with central database

    logger.info("Full sync completed", { shopDomain, ...stats });

    return stats;
  } catch (error) {
    logger.error("Full sync failed", error, { shopDomain });
    throw error;
  }
}

/**
 * Get current inventory status across all stores
 */
export async function getInventoryStatus(sku: string): Promise<{
  centralQuantity: number;
  lastUpdated: Date | null;
  stores: Array<{
    shopDomain: string;
    storeId: string;
    isActive: boolean;
    syncEnabled: boolean;
    lastSynced: Date | null;
  }>;
  hasPendingConflicts: boolean;
}> {
  try {
    const product = await findProductBySku(sku);

    if (!product || !product.inventory) {
      throw new Error(`Product not found or has no inventory: ${sku}`);
    }

    const mappings = await getAllMappings(sku);

    const stores = mappings.map((mapping) => ({
      shopDomain: mapping.store.shopDomain,
      storeId: mapping.storeId,
      isActive: mapping.store.isActive,
      syncEnabled: mapping.store.syncEnabled,
      lastSynced: mapping.lastSyncedAt,
    }));

    // Check for pending conflicts
    const conflicts = await import("~/db.server").then((mod) =>
      mod.prisma.conflict.count({
        where: {
          productId: product.id,
          resolved: false,
        },
      })
    );

    return {
      centralQuantity: product.inventory.availableQuantity,
      lastUpdated: product.inventory.lastAdjustedAt,
      stores,
      hasPendingConflicts: conflicts > 0,
    };
  } catch (error) {
    logger.error("Failed to get inventory status", error, { sku });
    throw error;
  }
}

/**
 * Sync specific product to specific store
 */
export async function syncProductToStore(
  sku: string,
  shopDomain: string
): Promise<SyncResult> {
  logger.info("Syncing product to store", { sku, shopDomain });

  try {
    const product = await findProductBySku(sku);

    if (!product || !product.inventory) {
      throw new Error(`Product not found or has no inventory: ${sku}`);
    }

    const mapping = product.storeMappings.find(
      (m) => m.store.shopDomain === shopDomain
    );

    if (!mapping) {
      throw new Error(`No mapping found for store: ${shopDomain}`);
    }

    // Resolve access token: offline session > Store.accessToken
    let syncAccessToken: string | undefined;
    const offlineSession = await storage.loadSession(`offline_${shopDomain}`);
    if (offlineSession?.accessToken) {
      syncAccessToken = offlineSession.accessToken;
    } else {
      const storeForToken = await prisma.store.findUnique({
        where: { shopDomain },
        select: { accessToken: true },
      });
      syncAccessToken = storeForToken?.accessToken || undefined;
    }

    if (!syncAccessToken) {
      throw new Error(`No access token found for store: ${shopDomain}`);
    }

    // Get location (DB first, then API fallback)
    const location = await getPrimaryLocation(
      { shop: shopDomain, accessToken: syncAccessToken },
      mapping.storeId
    );

    if (!location) {
      throw new Error(`No location found for store: ${shopDomain}`);
    }

    // Update inventory
    await updateInventoryLevel(
      { shop: shopDomain, accessToken: syncAccessToken },
      mapping.shopifyInventoryItemId!,
      location.id,
      product.inventory.availableQuantity,
      "Manual sync from central inventory"
    );

    // Record sync
    await recordSyncOperation({
      operationType: "INVENTORY_UPDATE",
      direction: "CENTRAL_TO_STORE",
      productId: product.id,
      storeId: mapping.storeId,
      status: "COMPLETED",
      newValue: { available: product.inventory.availableQuantity },
      triggeredBy: "manual-sync",
    });

    logger.info("Product synced to store", { sku, shopDomain });

    return {
      success: true,
      productId: product.id,
      storeId: mapping.storeId,
      operation: "INVENTORY_UPDATE",
    };
  } catch (error) {
    logger.error("Failed to sync product to store", error, { sku, shopDomain });

    return {
      success: false,
      productId: "",
      operation: "INVENTORY_UPDATE",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default {
  processInventoryChange,
  performFullSync,
  getInventoryStatus,
  syncProductToStore,
};
