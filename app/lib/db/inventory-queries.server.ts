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
  getSyncStats,
};
