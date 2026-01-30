/**
 * Conflict Resolver
 *
 * Detects and resolves inventory sync conflicts between stores
 * Implements various resolution strategies
 */

import { prisma, executeTransaction } from "~/db.server";
import { logger } from "~/lib/logger.server";
import { resolveConflictValue } from "~/lib/helpers";
import type { Conflict, ConflictResolutionStrategy, ConflictType } from "@prisma/client";

/**
 * Conflict detection parameters
 */
export interface ConflictDetectionParams {
  productId: string;
  storeId: string;
  expectedValue: number;
  actualValue: number;
  field?: string;
}

/**
 * Time window for considering updates as "simultaneous" (5 seconds)
 */
const CONFLICT_WINDOW_MS = 5000;

/**
 * Detect if a change conflicts with recent changes
 */
export async function detectConflict(
  params: ConflictDetectionParams
): Promise<{
  hasConflict: boolean;
  conflictType?: ConflictType;
  conflictId?: string;
}> {
  try {
    const { productId, storeId, expectedValue, actualValue, field = "quantity" } = params;

    // Check if values differ
    if (expectedValue === actualValue) {
      return { hasConflict: false };
    }

    // Check for recent sync operations from other stores
    const recentWindow = new Date(Date.now() - CONFLICT_WINDOW_MS);

    const recentOps = await prisma.syncOperation.findMany({
      where: {
        productId,
        storeId: {
          not: storeId,
        },
        status: "COMPLETED",
        completedAt: {
          gte: recentWindow,
        },
      },
      orderBy: {
        completedAt: "desc",
      },
    });

    if (recentOps.length === 0) {
      // No recent conflicting operations, but values still differ
      // This might be a manual adjustment
      logger.warn("Value mismatch detected without recent operations", {
        productId,
        storeId,
        expectedValue,
        actualValue,
      });

      return {
        hasConflict: true,
        conflictType: "INVENTORY_MISMATCH",
      };
    }

    // We have a real conflict - simultaneous updates
    logger.conflict("SYNC_COLLISION", productId, storeId, {
      expectedValue,
      actualValue,
      recentOpsCount: recentOps.length,
    });

    return {
      hasConflict: true,
      conflictType: "SYNC_COLLISION",
    };
  } catch (error) {
    logger.error("Failed to detect conflict", error, params);
    throw error;
  }
}

/**
 * Create a conflict record
 */
export async function createConflict(params: {
  conflictType: ConflictType;
  productId: string;
  storeId: string;
  centralValue: any;
  storeValue: any;
  resolutionStrategy?: ConflictResolutionStrategy;
  notes?: string;
}): Promise<Conflict> {
  try {
    const conflict = await prisma.conflict.create({
      data: {
        conflictType: params.conflictType,
        productId: params.productId,
        storeId: params.storeId,
        centralValue: params.centralValue,
        storeValue: params.storeValue,
        resolutionStrategy: params.resolutionStrategy || "USE_DATABASE",
        resolved: false,
        notes: params.notes,
      },
    });

    logger.conflict(
      params.conflictType,
      params.productId,
      params.storeId,
      {
        conflictId: conflict.id,
        centralValue: params.centralValue,
        storeValue: params.storeValue,
      }
    );

    return conflict;
  } catch (error) {
    logger.error("Failed to create conflict record", error, params);
    throw error;
  }
}

/**
 * Resolve a detected conflict using specified strategy
 */
export async function resolveConflict(
  conflictId: string,
  strategy?: ConflictResolutionStrategy,
  resolvedBy?: string
): Promise<Conflict> {
  try {
    return await executeTransaction(async (tx) => {
      const conflict = await tx.conflict.findUnique({
        where: { id: conflictId },
        include: {
          product: {
            include: {
              inventory: true,
            },
          },
          store: true,
        },
      });

      if (!conflict) {
        throw new Error(`Conflict not found: ${conflictId}`);
      }

      if (conflict.resolved) {
        logger.warn("Conflict already resolved", { conflictId });
        return conflict;
      }

      // Use provided strategy or the one from conflict record
      const resolutionStrategy = strategy || conflict.resolutionStrategy;

      if (resolutionStrategy === "MANUAL") {
        throw new Error("Manual resolution required - cannot auto-resolve");
      }

      // Extract values
      const centralValue =
        typeof conflict.centralValue === "object" &&
        conflict.centralValue !== null &&
        "available" in conflict.centralValue
          ? (conflict.centralValue as any).available
          : 0;

      const storeValue =
        typeof conflict.storeValue === "object" &&
        conflict.storeValue !== null &&
        "available" in conflict.storeValue
          ? (conflict.storeValue as any).available
          : 0;

      // Calculate resolved value
      const resolvedQuantity = resolveConflictValue(
        centralValue,
        storeValue,
        resolutionStrategy
      );

      // Update central inventory
      if (conflict.product.inventory) {
        await tx.inventory.update({
          where: { id: conflict.product.inventory.id },
          data: {
            availableQuantity: resolvedQuantity,
            lastAdjustedAt: new Date(),
            lastAdjustedBy: resolvedBy || `conflict-resolution-${resolutionStrategy}`,
          },
        });
      }

      // Mark conflict as resolved
      const resolvedConflict = await tx.conflict.update({
        where: { id: conflictId },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: resolvedBy || "system",
          resolvedValue: { available: resolvedQuantity },
        },
      });

      logger.info("Conflict resolved", {
        conflictId,
        strategy: resolutionStrategy,
        centralValue,
        storeValue,
        resolvedValue: resolvedQuantity,
      });

      return resolvedConflict;
    });
  } catch (error) {
    logger.error("Failed to resolve conflict", error, { conflictId, strategy });
    throw error;
  }
}

/**
 * Get all pending conflicts
 */
export async function getPendingConflicts(filters?: {
  productId?: string;
  storeId?: string;
  conflictType?: ConflictType;
}): Promise<Conflict[]> {
  try {
    const conflicts = await prisma.conflict.findMany({
      where: {
        resolved: false,
        productId: filters?.productId,
        storeId: filters?.storeId,
        conflictType: filters?.conflictType,
      },
      include: {
        product: true,
        store: true,
      },
      orderBy: {
        detectedAt: "desc",
      },
    });

    return conflicts;
  } catch (error) {
    logger.error("Failed to get pending conflicts", error, filters);
    throw error;
  }
}

/**
 * Auto-resolve conflict based on store settings
 */
export async function autoResolveConflict(conflict: Conflict): Promise<Conflict> {
  try {
    // Get store to check default resolution strategy
    const store = await prisma.store.findUnique({
      where: { id: conflict.storeId },
    });

    if (!store) {
      throw new Error(`Store not found: ${conflict.storeId}`);
    }

    // For now, use USE_LOWEST as default strategy to prevent overselling
    const strategy: ConflictResolutionStrategy = "USE_LOWEST";

    logger.info("Auto-resolving conflict", {
      conflictId: conflict.id,
      strategy,
    });

    return await resolveConflict(conflict.id, strategy, "auto-resolution");
  } catch (error) {
    logger.error("Failed to auto-resolve conflict", error, {
      conflictId: conflict.id,
    });
    throw error;
  }
}

/**
 * Batch resolve conflicts with same strategy
 */
export async function batchResolveConflicts(
  conflictIds: string[],
  strategy: ConflictResolutionStrategy,
  resolvedBy?: string
): Promise<{
  resolved: number;
  failed: number;
  errors: Array<{ conflictId: string; error: string }>;
}> {
  const results = {
    resolved: 0,
    failed: 0,
    errors: [] as Array<{ conflictId: string; error: string }>,
  };

  for (const conflictId of conflictIds) {
    try {
      await resolveConflict(conflictId, strategy, resolvedBy);
      results.resolved++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        conflictId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  logger.info("Batch conflict resolution completed", results);

  return results;
}

/**
 * Get conflict statistics
 */
export async function getConflictStats(filters?: {
  storeId?: string;
  since?: Date;
}): Promise<{
  total: number;
  resolved: number;
  pending: number;
  byType: Record<ConflictType, number>;
}> {
  try {
    const where = {
      storeId: filters?.storeId,
      detectedAt: filters?.since
        ? {
            gte: filters.since,
          }
        : undefined,
    };

    const [total, resolved, pending, allConflicts] = await Promise.all([
      prisma.conflict.count({ where }),
      prisma.conflict.count({ where: { ...where, resolved: true } }),
      prisma.conflict.count({ where: { ...where, resolved: false } }),
      prisma.conflict.findMany({
        where,
        select: { conflictType: true },
      }),
    ]);

    // Count by type
    const byType: Record<ConflictType, number> = {
      INVENTORY_MISMATCH: 0,
      PRICE_MISMATCH: 0,
      PRODUCT_DATA_MISMATCH: 0,
      VARIANT_MISSING: 0,
      SKU_DUPLICATE: 0,
      SYNC_COLLISION: 0,
    };

    allConflicts.forEach((conflict) => {
      byType[conflict.conflictType]++;
    });

    return {
      total,
      resolved,
      pending,
      byType,
    };
  } catch (error) {
    logger.error("Failed to get conflict stats", error, filters);
    throw error;
  }
}

/**
 * Check if product has pending conflicts
 */
export async function hasPendingConflicts(
  productId: string,
  storeId?: string
): Promise<boolean> {
  try {
    const count = await prisma.conflict.count({
      where: {
        productId,
        storeId,
        resolved: false,
      },
    });

    return count > 0;
  } catch (error) {
    logger.error("Failed to check pending conflicts", error, { productId, storeId });
    throw error;
  }
}

export default {
  detectConflict,
  createConflict,
  resolveConflict,
  getPendingConflicts,
  autoResolveConflict,
  batchResolveConflicts,
  getConflictStats,
  hasPendingConflicts,
};
