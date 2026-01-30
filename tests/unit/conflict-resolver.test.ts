/**
 * Conflict Resolver Unit Tests
 *
 * Tests for conflict detection and resolution
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectConflict,
  resolveConflict,
  createConflict,
  autoResolveConflict,
  getPendingConflicts,
} from "~/lib/sync/conflict-resolver.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";
import {
  storeA,
  storeB,
  productWithSku001,
  inventoryFor001,
  conflictSyncCollision,
  conflictInventoryMismatch,
} from "../mocks/fixtures";

// Mock modules
vi.mock("~/db.server", () => ({
  prisma: mockPrisma,
  executeTransaction: vi.fn(async (callback) => callback(mockPrisma)),
}));

vi.mock("~/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    conflict: vi.fn(),
    database: vi.fn(),
  },
}));

vi.mock("~/lib/helpers", () => ({
  resolveConflictValue: vi.fn((centralValue, storeValue, strategy) => {
    if (strategy === "USE_LOWEST") return Math.min(centralValue, storeValue);
    if (strategy === "USE_DATABASE") return centralValue;
    if (strategy === "USE_STORE") return storeValue;
    return centralValue;
  }),
  gidToId: vi.fn((gid) => gid.split("/").pop()),
  idToGid: vi.fn((id, type) => `gid://shopify/${type}/${id}`),
}));

describe("Conflict Resolver", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();

    // Setup test data
    mockData.stores.set(storeA.id, storeA);
    mockData.stores.set(storeB.id, storeB);
    mockData.products.set(productWithSku001.id, productWithSku001);
    mockData.inventory.set(inventoryFor001.id, { ...inventoryFor001 });
  });

  describe("detectConflict", () => {
    it("should identify simultaneous updates within 5s window", async () => {
      // Create a recent sync operation (within 5 seconds)
      const recentOp = {
        id: "sync-recent",
        productId: productWithSku001.id,
        storeId: storeB.id,
        status: "COMPLETED",
        completedAt: new Date(Date.now() - 3000), // 3 seconds ago
        operationType: "INVENTORY_UPDATE",
        direction: "STORE_TO_CENTRAL",
        startedAt: new Date(Date.now() - 3000),
        previousValue: {},
        newValue: {},
        errorMessage: null,
        triggeredBy: null,
        userId: null,
        createdAt: new Date(),
      };
      mockData.syncOperations.set(recentOp.id, recentOp);

      const result = await detectConflict({
        productId: productWithSku001.id,
        storeId: storeA.id,
        expectedValue: 100,
        actualValue: 95,
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe("SYNC_COLLISION");
    });

    it("should ignore non-conflicting updates", async () => {
      const result = await detectConflict({
        productId: productWithSku001.id,
        storeId: storeA.id,
        expectedValue: 100,
        actualValue: 100, // Same value
      });

      expect(result.hasConflict).toBe(false);
    });

    it("should detect inventory mismatch without recent operations", async () => {
      const result = await detectConflict({
        productId: productWithSku001.id,
        storeId: storeA.id,
        expectedValue: 100,
        actualValue: 95,
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe("INVENTORY_MISMATCH");
    });

    it("should not conflict if recent operations are old", async () => {
      // Create an old sync operation (more than 5 seconds ago)
      const oldOp = {
        id: "sync-old",
        productId: productWithSku001.id,
        storeId: storeB.id,
        status: "COMPLETED",
        completedAt: new Date(Date.now() - 10000), // 10 seconds ago
        operationType: "INVENTORY_UPDATE",
        direction: "STORE_TO_CENTRAL",
        startedAt: new Date(Date.now() - 10000),
        previousValue: {},
        newValue: {},
        errorMessage: null,
        triggeredBy: null,
        userId: null,
        createdAt: new Date(),
      };
      mockData.syncOperations.set(oldOp.id, oldOp);

      const result = await detectConflict({
        productId: productWithSku001.id,
        storeId: storeA.id,
        expectedValue: 100,
        actualValue: 95,
      });

      // Should still detect mismatch, but as INVENTORY_MISMATCH not SYNC_COLLISION
      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe("INVENTORY_MISMATCH");
    });
  });

  describe("createConflict", () => {
    it("should create conflict record", async () => {
      const conflict = await createConflict({
        conflictType: "SYNC_COLLISION",
        productId: productWithSku001.id,
        storeId: storeA.id,
        centralValue: { available: 100 },
        storeValue: { available: 95 },
        notes: "Test conflict",
      });

      expect(conflict.id).toBeDefined();
      expect(conflict.resolved).toBe(false);
      expect(conflict.conflictType).toBe("SYNC_COLLISION");
      expect(conflict.resolutionStrategy).toBe("USE_DATABASE"); // Default
    });

    it("should accept custom resolution strategy", async () => {
      const conflict = await createConflict({
        conflictType: "INVENTORY_MISMATCH",
        productId: productWithSku001.id,
        storeId: storeA.id,
        centralValue: { available: 100 },
        storeValue: { available: 95 },
        resolutionStrategy: "USE_LOWEST",
      });

      expect(conflict.resolutionStrategy).toBe("USE_LOWEST");
    });
  });

  describe("resolveConflict", () => {
    it("should resolve conflict with USE_LOWEST strategy", async () => {
      const conflict = { ...conflictSyncCollision };
      mockData.conflicts.set(conflict.id, conflict);
      mockData.products.set(productWithSku001.id, {
        ...productWithSku001,
        inventory: inventoryFor001,
      });

      const resolved = await resolveConflict(conflict.id, "USE_LOWEST", "test-user");

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedBy).toBe("test-user");
      expect(resolved.resolvedValue).toEqual({ available: 95 }); // Lower value
    });

    it("should resolve conflict with USE_DATABASE strategy", async () => {
      const conflict = { ...conflictInventoryMismatch };
      mockData.conflicts.set(conflict.id, conflict);
      mockData.products.set(productWithSku001.id, {
        ...productWithSku001,
        inventory: inventoryFor001,
      });

      const resolved = await resolveConflict(conflict.id, "USE_DATABASE");

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedValue).toEqual({ available: 100 }); // Database value
    });

    it("should throw error for MANUAL resolution strategy", async () => {
      const conflict = { ...conflictSyncCollision };
      mockData.conflicts.set(conflict.id, conflict);

      await expect(resolveConflict(conflict.id, "MANUAL")).rejects.toThrow("Manual resolution required");
    });

    it("should handle already resolved conflicts", async () => {
      const conflict = { ...conflictInventoryMismatch, resolved: true };
      mockData.conflicts.set(conflict.id, conflict);

      const resolved = await resolveConflict(conflict.id);

      expect(resolved.resolved).toBe(true);
    });

    it("should update central inventory when resolving", async () => {
      const conflict = { ...conflictSyncCollision };
      mockData.conflicts.set(conflict.id, conflict);
      mockData.products.set(productWithSku001.id, {
        ...productWithSku001,
        inventory: inventoryFor001,
      });

      await resolveConflict(conflict.id, "USE_LOWEST");

      // Verify inventory was updated
      const updatedInventory = mockData.inventory.get(inventoryFor001.id);
      expect(updatedInventory.availableQuantity).toBe(95);
    });
  });

  describe("getPendingConflicts", () => {
    beforeEach(() => {
      mockData.conflicts.set(conflictSyncCollision.id, conflictSyncCollision);
      mockData.conflicts.set(conflictInventoryMismatch.id, conflictInventoryMismatch);
    });

    it("should return only unresolved conflicts", async () => {
      const pending = await getPendingConflicts();

      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(conflictSyncCollision.id);
      expect(pending[0].resolved).toBe(false);
    });

    it("should filter by productId", async () => {
      const pending = await getPendingConflicts({ productId: productWithSku001.id });

      expect(pending.length).toBe(1);
      expect(pending[0].productId).toBe(productWithSku001.id);
    });

    it("should filter by conflictType", async () => {
      const pending = await getPendingConflicts({ conflictType: "SYNC_COLLISION" });

      expect(pending.length).toBe(1);
      expect(pending[0].conflictType).toBe("SYNC_COLLISION");
    });
  });

  describe("autoResolveConflict", () => {
    it("should apply store's default strategy", async () => {
      const conflict = { ...conflictSyncCollision };
      mockData.conflicts.set(conflict.id, conflict);
      mockData.stores.set(storeA.id, storeA);
      mockData.products.set(productWithSku001.id, {
        ...productWithSku001,
        inventory: inventoryFor001,
      });

      const resolved = await autoResolveConflict(conflict);

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedBy).toBe("auto-resolution");
      // Default strategy is USE_LOWEST
      expect(resolved.resolvedValue).toEqual({ available: 95 });
    });

    it("should fail if store not found", async () => {
      const conflict = { ...conflictSyncCollision, storeId: "non-existent" };
      mockData.conflicts.set(conflict.id, conflict);

      await expect(autoResolveConflict(conflict)).rejects.toThrow("Store not found");
    });
  });
});
