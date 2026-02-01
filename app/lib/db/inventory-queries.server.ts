/**
 * Database Query Functions
 *
 * Prisma-based database operations for inventory management
 * All functions include proper error handling and return typed results
 */

import { prisma, executeTransaction } from "~/db.server";
import { logger } from "~/lib/logger.server";
import type {
  Product,
  Inventory,
  Store,
  ProductStoreMapping,
  SyncOperation,
  SyncStatus,
  OperationType,
  SyncDirection,
} from "@prisma/client";
import type { ProductWithRelations } from "~/types";

/**
 * Get inventory record by SKU
 */
export async function getInventoryBySku(
  sku: string
): Promise<(Inventory & { product: Product }) | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
      },
    });

    if (!product || !product.inventory) {
      return null;
    }

    return {
      ...product.inventory,
      product,
    };
  } catch (error) {
    logger.error("Failed to get inventory by SKU", error, { sku });
    throw error;
  }
}

/**
 * Update inventory with optimistic locking
 * Returns true if update succeeded, false if version mismatch (conflict)
 */
export async function updateInventory(
  sku: string,
  newQuantity: number,
  expectedVersion?: number,
  metadata?: {
    reason?: string;
    adjustedBy?: string;
  }
): Promise<{ success: boolean; inventory?: Inventory; conflict?: boolean }> {
  try {
    return await executeTransaction(async (tx) => {
      // Find product and lock the row
      const product = await tx.product.findUnique({
        where: { sku },
        include: {
          inventory: true,
        },
      });

      if (!product || !product.inventory) {
        throw new Error(`Product or inventory not found for SKU: ${sku}`);
      }

      // Check version for optimistic locking (if provided)
      if (
        expectedVersion !== undefined &&
        product.inventory.updatedAt.getTime() !== expectedVersion
      ) {
        logger.warn("Inventory version mismatch detected", {
          sku,
          expectedVersion,
          currentVersion: product.inventory.updatedAt.getTime(),
        });
        return { success: false, conflict: true };
      }

      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: { id: product.inventory.id },
        data: {
          availableQuantity: newQuantity,
          lastAdjustedAt: new Date(),
          lastAdjustedBy: metadata?.adjustedBy || "system",
        },
      });

      logger.database("update", "inventory", {
        sku,
        previousQuantity: product.inventory.availableQuantity,
        newQuantity,
        reason: metadata?.reason,
      });

      return { success: true, inventory: updatedInventory };
    });
  } catch (error) {
    logger.error("Failed to update inventory", error, { sku, newQuantity });
    throw error;
  }
}

/**
 * Get all inventory for a store
 */
export async function getInventoryForStore(
  shopDomain: string
): Promise<Array<Inventory & { product: Product }>> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      include: {
        productMappings: {
          include: {
            product: {
              include: {
                inventory: true,
              },
            },
          },
        },
      },
    });

    if (!store) {
      return [];
    }

    const inventory = store.productMappings
      .filter((mapping) => mapping.product.inventory)
      .map((mapping) => ({
        ...mapping.product.inventory!,
        product: mapping.product,
      }));

    return inventory;
  } catch (error) {
    logger.error("Failed to get inventory for store", error, { shopDomain });
    throw error;
  }
}

/**
 * Record sync operation in audit log
 */
export async function recordSyncOperation(data: {
  operationType: OperationType;
  direction: SyncDirection;
  productId?: string;
  storeId?: string;
  status: SyncStatus;
  previousValue?: any;
  newValue?: any;
  errorMessage?: string;
  triggeredBy?: string;
  userId?: string;
}): Promise<SyncOperation> {
  try {
    const now = new Date();
    const syncOp = await prisma.syncOperation.create({
      data: {
        ...data,
        startedAt: now,
        completedAt: data.status === "COMPLETED" ? now : undefined,
      },
    });

    logger.database("create", "sync_operation", {
      id: syncOp.id,
      operationType: data.operationType,
      status: data.status,
    });

    return syncOp;
  } catch (error) {
    logger.error("Failed to record sync operation", error, data);
    throw error;
  }
}

/**
 * Update sync operation status
 */
export async function updateSyncOperation(
  id: string,
  data: {
    status?: SyncStatus;
    completedAt?: Date;
    errorMessage?: string;
    newValue?: any;
  }
): Promise<SyncOperation> {
  try {
    const syncOp = await prisma.syncOperation.update({
      where: { id },
      data: {
        ...data,
        completedAt: data.status === "COMPLETED" ? new Date() : data.completedAt,
      },
    });

    return syncOp;
  } catch (error) {
    logger.error("Failed to update sync operation", error, { id, data });
    throw error;
  }
}

/**
 * Get recent sync operations with filters
 */
export async function getRecentSyncOperations(filters?: {
  productId?: string;
  storeId?: string;
  operationType?: OperationType;
  status?: SyncStatus;
  limit?: number;
  since?: Date;
}): Promise<SyncOperation[]> {
  try {
    const operations = await prisma.syncOperation.findMany({
      where: {
        productId: filters?.productId,
        storeId: filters?.storeId,
        operationType: filters?.operationType,
        status: filters?.status,
        startedAt: filters?.since
          ? {
              gte: filters.since,
            }
          : undefined,
      },
      orderBy: {
        startedAt: "desc",
      },
      take: filters?.limit || 100,
      include: {
        product: true,
        store: true,
      },
    });

    return operations;
  } catch (error) {
    logger.error("Failed to get recent sync operations", error, filters);
    throw error;
  }
}

/**
 * Get store by domain
 */
export async function getStoreByDomain(shopDomain: string): Promise<Store | null> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    return store;
  } catch (error) {
    logger.error("Failed to get store by domain", error, { shopDomain });
    throw error;
  }
}

/**
 * Get all active stores
 */
export async function getAllActiveStores(): Promise<Store[]> {
  try {
    const stores = await prisma.store.findMany({
      where: {
        isActive: true,
        syncEnabled: true,
      },
      orderBy: {
        shopDomain: "asc",
      },
    });

    return stores;
  } catch (error) {
    logger.error("Failed to get all active stores", error);
    throw error;
  }
}

/**
 * Get product by SKU with all relations
 */
export async function getProductBySku(sku: string): Promise<ProductWithRelations | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          include: {
            store: true,
          },
        },
      },
    });

    return product;
  } catch (error) {
    logger.error("Failed to get product by SKU", error, { sku });
    throw error;
  }
}

/**
 * Get product by ID with all relations
 */
export async function getProductById(id: string): Promise<ProductWithRelations | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        inventory: true,
        storeMappings: {
          include: {
            store: true,
          },
        },
      },
    });

    return product;
  } catch (error) {
    logger.error("Failed to get product by ID", error, { id });
    throw error;
  }
}

/**
 * Get store mapping for a product and store
 */
export async function getStoreMapping(
  productId: string,
  storeId: string
): Promise<ProductStoreMapping | null> {
  try {
    const mapping = await prisma.productStoreMapping.findUnique({
      where: {
        productId_storeId: {
          productId,
          storeId,
        },
      },
    });

    return mapping;
  } catch (error) {
    logger.error("Failed to get store mapping", error, { productId, storeId });
    throw error;
  }
}

/**
 * Get all mappings for a product
 */
export async function getAllMappingsForProduct(
  productId: string
): Promise<(ProductStoreMapping & { store: Store })[]> {
  try {
    const mappings = await prisma.productStoreMapping.findMany({
      where: { productId },
      include: {
        store: true,
      },
    });

    return mappings;
  } catch (error) {
    logger.error("Failed to get all mappings for product", error, { productId });
    throw error;
  }
}

/**
 * Create or update inventory record
 */
export async function upsertInventory(
  productId: string,
  data: {
    availableQuantity?: number;
    committedQuantity?: number;
    incomingQuantity?: number;
    lowStockThreshold?: number;
    lastAdjustedBy?: string;
  }
): Promise<Inventory> {
  try {
    const inventory = await prisma.inventory.upsert({
      where: { productId },
      create: {
        productId,
        availableQuantity: data.availableQuantity || 0,
        committedQuantity: data.committedQuantity || 0,
        incomingQuantity: data.incomingQuantity || 0,
        lowStockThreshold: data.lowStockThreshold,
        lastAdjustedBy: data.lastAdjustedBy || "system",
        lastAdjustedAt: new Date(),
      },
      update: {
        ...data,
        lastAdjustedAt: new Date(),
      },
    });

    logger.database("upsert", "inventory", {
      productId,
      availableQuantity: inventory.availableQuantity,
    });

    return inventory;
  } catch (error) {
    logger.error("Failed to upsert inventory", error, { productId, data });
    throw error;
  }
}

/**
 * Create or update per-location inventory record
 */
export async function upsertInventoryLocation(
  productId: string,
  storeLocationId: string,
  data: {
    availableQuantity?: number;
    committedQuantity?: number;
    incomingQuantity?: number;
    lastAdjustedBy?: string;
  }
): Promise<any> {
  try {
    const record = await prisma.inventoryLocation.upsert({
      where: {
        productId_storeLocationId: {
          productId,
          storeLocationId,
        },
      },
      create: {
        productId,
        storeLocationId,
        availableQuantity: data.availableQuantity ?? 0,
        committedQuantity: data.committedQuantity ?? 0,
        incomingQuantity: data.incomingQuantity ?? 0,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: data.lastAdjustedBy || "system",
      },
      update: {
        availableQuantity: data.availableQuantity,
        committedQuantity: data.committedQuantity,
        incomingQuantity: data.incomingQuantity,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: data.lastAdjustedBy,
      },
    });

    logger.database("upsert", "inventory_location", {
      productId,
      storeLocationId,
      availableQuantity: record.availableQuantity,
    });

    return record;
  } catch (error) {
    logger.error("Failed to upsert inventory location", error, {
      productId,
      storeLocationId,
      data,
    });
    throw error;
  }
}

/**
 * Recalculate aggregate inventory from all InventoryLocation rows for a product.
 * Sums availableQuantity, committedQuantity, incomingQuantity across all locations.
 */
export async function recalculateAggregateInventory(
  productId: string
): Promise<Inventory> {
  try {
    const aggregation = await prisma.inventoryLocation.aggregate({
      where: { productId },
      _sum: {
        availableQuantity: true,
        committedQuantity: true,
        incomingQuantity: true,
      },
    });

    const totalAvailable = aggregation._sum.availableQuantity ?? 0;
    const totalCommitted = aggregation._sum.committedQuantity ?? 0;
    const totalIncoming = aggregation._sum.incomingQuantity ?? 0;

    const inventory = await prisma.inventory.upsert({
      where: { productId },
      create: {
        productId,
        availableQuantity: totalAvailable,
        committedQuantity: totalCommitted,
        incomingQuantity: totalIncoming,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: "aggregate-recalculation",
      },
      update: {
        availableQuantity: totalAvailable,
        committedQuantity: totalCommitted,
        incomingQuantity: totalIncoming,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: "aggregate-recalculation",
      },
    });

    logger.database("upsert", "inventory", {
      productId,
      aggregateAvailable: totalAvailable,
      aggregateCommitted: totalCommitted,
      aggregateIncoming: totalIncoming,
    });

    return inventory;
  } catch (error) {
    logger.error("Failed to recalculate aggregate inventory", error, {
      productId,
    });
    throw error;
  }
}

/**
 * Unified inventory update — single entry point for all 6 write paths.
 *
 * Lookups are always by SKU + locationName (not location IDs).
 * The DB is the source of truth — StoreLocation.name identifies a physical location.
 *
 * Modes:
 *   absolute      – catalog sync / inventory webhook: set exact value at a named location, recalculate aggregate
 *   delta         – order create/cancel/refund: arithmetic on matching location rows by name, recalculate aggregate
 *                   (falls back to aggregate-only if locationName not provided)
 *   setAggregate  – product webhook / fallback when no location data: direct upsert of aggregate
 */
export async function unifiedInventoryUpdate(params: {
  sku: string;
  productId?: string;
  adjustedBy: string;

  absolute?: {
    availableQuantity: number;
    committedQuantity?: number;
    incomingQuantity?: number;
    locationName: string;
    skipRecalculation?: boolean;
  };
  delta?: {
    availableQuantityChange: number;
    committedQuantityChange?: number;
    locationName?: string;
  };
  setAggregate?: {
    availableQuantity: number;
    committedQuantity?: number;
    incomingQuantity?: number;
  };
}): Promise<{
  productId: string;
  previousAggregate: { available: number; committed: number; incoming: number };
  newAggregate: { available: number; committed: number; incoming: number };
  mode: "absolute" | "delta" | "setAggregate";
}> {
  const { sku, adjustedBy } = params;

  // Resolve productId — caller may supply it to skip a lookup
  let productId = params.productId;
  if (!productId) {
    const product = await prisma.product.findUnique({ where: { sku } });
    if (!product) throw new Error(`Product not found for SKU: ${sku}`);
    productId = product.id;
  }

  // Ensure Inventory record exists before any operation
  const existing = await prisma.inventory.upsert({
    where: { productId },
    create: {
      productId,
      availableQuantity: 0,
      committedQuantity: 0,
      incomingQuantity: 0,
      lastAdjustedAt: new Date(),
      lastAdjustedBy: adjustedBy,
    },
    update: {},
  });

  const previousAggregate = {
    available: existing.availableQuantity,
    committed: existing.committedQuantity,
    incoming: existing.incomingQuantity,
  };

  // --- MODE A: absolute (set exact value at every location matching name → recalculate) ---
  if (params.absolute) {
    const a = params.absolute;

    // Find all StoreLocation records with this name (across all stores)
    const matchingLocations = await prisma.storeLocation.findMany({
      where: { name: a.locationName },
    });

    if (matchingLocations.length === 0) {
      logger.warn("No StoreLocation found for locationName, skipping per-location write", {
        sku, locationName: a.locationName,
      });
    }

    for (const loc of matchingLocations) {
      await upsertInventoryLocation(productId, loc.id, {
        availableQuantity: a.availableQuantity,
        committedQuantity: a.committedQuantity,
        incomingQuantity: a.incomingQuantity,
        lastAdjustedBy: adjustedBy,
      });
    }

    let updated = existing;
    if (!a.skipRecalculation) {
      updated = await recalculateAggregateInventory(productId);
    }

    return {
      productId,
      previousAggregate,
      newAggregate: {
        available: updated.availableQuantity,
        committed: updated.committedQuantity,
        incoming: updated.incomingQuantity,
      },
      mode: "absolute",
    };
  }

  // --- MODE B: delta (find location rows by name, apply delta, recalculate) ---
  if (params.delta) {
    const d = params.delta;

    if (d.locationName) {
      // Find all InventoryLocation rows for this product where StoreLocation.name matches
      const locationRows = await prisma.inventoryLocation.findMany({
        where: {
          productId,
          storeLocation: { name: d.locationName },
        },
      });

      if (locationRows.length > 0) {
        // Apply delta to each matching location row
        for (const row of locationRows) {
          await prisma.inventoryLocation.update({
            where: { id: row.id },
            data: {
              availableQuantity: Math.max(0, row.availableQuantity + d.availableQuantityChange),
              committedQuantity: Math.max(0, row.committedQuantity + (d.committedQuantityChange ?? 0)),
              lastAdjustedAt: new Date(),
              lastAdjustedBy: adjustedBy,
            },
          });
        }

        // Recalculate aggregate from all location rows
        const updated = await recalculateAggregateInventory(productId);

        return {
          productId,
          previousAggregate,
          newAggregate: {
            available: updated.availableQuantity,
            committed: updated.committedQuantity,
            incoming: updated.incomingQuantity,
          },
          mode: "delta",
        };
      }

      // No location rows found for this name — fall through to aggregate fallback
      logger.warn("No InventoryLocation rows found for delta locationName, falling back to aggregate", {
        sku, locationName: d.locationName, productId,
      });
    }

    // Fallback: direct arithmetic on aggregate (no location info available)
    const updated = await executeTransaction(async (tx) => {
      const current = await tx.inventory.findUniqueOrThrow({ where: { productId } });

      const newAvailable = Math.max(0, current.availableQuantity + d.availableQuantityChange);
      const newCommitted = Math.max(0, current.committedQuantity + (d.committedQuantityChange ?? 0));

      return tx.inventory.update({
        where: { productId },
        data: {
          availableQuantity: newAvailable,
          committedQuantity: newCommitted,
          lastAdjustedAt: new Date(),
          lastAdjustedBy: adjustedBy,
        },
      });
    });

    return {
      productId,
      previousAggregate,
      newAggregate: {
        available: updated.availableQuantity,
        committed: updated.committedQuantity,
        incoming: updated.incomingQuantity,
      },
      mode: "delta",
    };
  }

  // --- MODE C: setAggregate (direct overwrite) ---
  if (params.setAggregate) {
    const s = params.setAggregate;
    const updated = await prisma.inventory.update({
      where: { productId },
      data: {
        availableQuantity: s.availableQuantity,
        committedQuantity: s.committedQuantity,
        incomingQuantity: s.incomingQuantity,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: adjustedBy,
      },
    });

    return {
      productId,
      previousAggregate,
      newAggregate: {
        available: updated.availableQuantity,
        committed: updated.committedQuantity,
        incoming: updated.incomingQuantity,
      },
      mode: "setAggregate",
    };
  }

  throw new Error("unifiedInventoryUpdate: exactly one of absolute | delta | setAggregate must be provided");
}

/**
 * Get sync operation statistics
 */
export async function getSyncStats(filters?: {
  storeId?: string;
  since?: Date;
}): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
}> {
  try {
    const where = {
      storeId: filters?.storeId,
      startedAt: filters?.since
        ? {
            gte: filters.since,
          }
        : undefined,
    };

    const [total, completed, failed, pending, inProgress] = await Promise.all([
      prisma.syncOperation.count({ where }),
      prisma.syncOperation.count({ where: { ...where, status: "COMPLETED" } }),
      prisma.syncOperation.count({ where: { ...where, status: "FAILED" } }),
      prisma.syncOperation.count({ where: { ...where, status: "PENDING" } }),
      prisma.syncOperation.count({ where: { ...where, status: "IN_PROGRESS" } }),
    ]);

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
    };
  } catch (error) {
    logger.error("Failed to get sync stats", error, filters);
    throw error;
  }
}

export default {
  getInventoryBySku,
  updateInventory,
  getInventoryForStore,
  recordSyncOperation,
  updateSyncOperation,
  getRecentSyncOperations,
  getStoreByDomain,
  getAllActiveStores,
  getProductBySku,
  getProductById,
  getStoreMapping,
  getAllMappingsForProduct,
  upsertInventory,
  upsertInventoryLocation,
  recalculateAggregateInventory,
  unifiedInventoryUpdate,
  getSyncStats,
};
