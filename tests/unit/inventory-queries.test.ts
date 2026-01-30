/**
 * Inventory Queries Unit Tests
 *
 * Tests for database query functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getInventoryBySku,
  updateInventory,
  recordSyncOperation,
  getRecentSyncOperations,
} from "~/lib/db/inventory-queries.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";
import {
  productWithSku001,
  inventoryFor001,
  syncOperationInventoryUpdate,
  syncOperationFailed,
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
    database: vi.fn(),
  },
}));

describe("Inventory Queries", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();

    // Setup test data
    mockData.products.set(productWithSku001.id, productWithSku001);
    mockData.inventory.set(inventoryFor001.id, { ...inventoryFor001 });
  });

  describe("getInventoryBySku", () => {
    it("should return correct record", async () => {
      const inventory = await getInventoryBySku(productWithSku001.sku);

      expect(inventory).toBeDefined();
      expect(inventory?.availableQuantity).toBe(100);
      expect(inventory?.product).toBeDefined();
      expect(inventory?.product.sku).toBe(productWithSku001.sku);
    });

    it("should return null for missing SKU", async () => {
      const inventory = await getInventoryBySku("NON-EXISTENT");

      expect(inventory).toBeNull();
    });

    it("should return null if product has no inventory", async () => {
      const productWithoutInventory = { ...productWithSku001, id: "product-no-inv", sku: "NO-INV-SKU" };
      mockData.products.set(productWithoutInventory.id, productWithoutInventory);

      const inventory = await getInventoryBySku("NO-INV-SKU");

      expect(inventory).toBeNull();
    });
  });

  describe("updateInventory", () => {
    it("should succeed with correct version", async () => {
      const currentInventory = mockData.inventory.get(inventoryFor001.id);
      const expectedVersion = currentInventory.updatedAt.getTime();

      const result = await updateInventory(
        productWithSku001.sku,
        95,
        expectedVersion,
        { reason: "test", adjustedBy: "test-user" }
      );

      expect(result.success).toBe(true);
      expect(result.inventory?.availableQuantity).toBe(95);
      expect(result.conflict).toBe(undefined);
    });

    it("should fail with wrong version (optimistic lock)", async () => {
      const wrongVersion = Date.now() - 10000; // Old timestamp

      const result = await updateInventory(
        productWithSku001.sku,
        95,
        wrongVersion
      );

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.inventory).toBe(undefined);
    });

    it("should succeed without version check", async () => {
      const result = await updateInventory(
        productWithSku001.sku,
        90,
        undefined,
        { reason: "no version check" }
      );

      expect(result.success).toBe(true);
      expect(result.inventory?.availableQuantity).toBe(90);
    });

    it("should throw error for missing product", async () => {
      await expect(updateInventory("NON-EXISTENT", 50)).rejects.toThrow();
    });

    it("should update lastAdjustedBy metadata", async () => {
      const result = await updateInventory(
        productWithSku001.sku,
        85,
        undefined,
        { adjustedBy: "specific-user" }
      );

      expect(result.inventory?.lastAdjustedBy).toBe("specific-user");
    });
  });

  describe("recordSyncOperation", () => {
    it("should create audit entry correctly", async () => {
      const op = await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "STORE_TO_CENTRAL",
        productId: productWithSku001.id,
        storeId: "store-a-id",
        status: "COMPLETED",
        previousValue: { available: 100 },
        newValue: { available: 95 },
        triggeredBy: "webhook-001",
      });

      expect(op.id).toBeDefined();
      expect(op.operationType).toBe("INVENTORY_UPDATE");
      expect(op.direction).toBe("STORE_TO_CENTRAL");
      expect(op.status).toBe("COMPLETED");
      expect(op.previousValue).toEqual({ available: 100 });
      expect(op.newValue).toEqual({ available: 95 });
    });

    it("should set completedAt for COMPLETED status", async () => {
      const op = await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "CENTRAL_TO_STORE",
        status: "COMPLETED",
      });

      expect(op.completedAt).toBeInstanceOf(Date);
    });

    it("should not set completedAt for IN_PROGRESS status", async () => {
      const op = await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "STORE_TO_CENTRAL",
        status: "IN_PROGRESS",
      });

      expect(op.completedAt).toBe(undefined);
    });

    it("should record error message for failures", async () => {
      const op = await recordSyncOperation({
        operationType: "INVENTORY_UPDATE",
        direction: "CENTRAL_TO_STORE",
        status: "FAILED",
        errorMessage: "Network timeout",
      });

      expect(op.errorMessage).toBe("Network timeout");
    });
  });

  describe("getRecentSyncOperations", () => {
    beforeEach(() => {
      mockData.syncOperations.set(syncOperationInventoryUpdate.id, syncOperationInventoryUpdate);
      mockData.syncOperations.set(syncOperationFailed.id, syncOperationFailed);
    });

    it("should filter correctly by productId", async () => {
      const ops = await getRecentSyncOperations({
        productId: productWithSku001.id,
      });

      expect(ops.length).toBe(2);
      ops.forEach((op) => {
        expect(op.productId).toBe(productWithSku001.id);
      });
    });

    it("should filter by status", async () => {
      const ops = await getRecentSyncOperations({
        status: "COMPLETED",
      });

      expect(ops.length).toBe(1);
      expect(ops[0].status).toBe("COMPLETED");
    });

    it("should filter by storeId", async () => {
      const ops = await getRecentSyncOperations({
        storeId: "store-a-id",
      });

      expect(ops.length).toBe(1);
      expect(ops[0].storeId).toBe("store-a-id");
    });

    it("should respect limit parameter", async () => {
      // Add more operations
      for (let i = 0; i < 10; i++) {
        const op = {
          ...syncOperationInventoryUpdate,
          id: `sync-${i}`,
          startedAt: new Date(Date.now() - i * 1000),
        };
        mockData.syncOperations.set(op.id, op);
      }

      const ops = await getRecentSyncOperations({ limit: 5 });

      expect(ops.length).toBeLessThanOrEqual(5);
    });

    it("should filter by since date", async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Add old operation
      const oldOp = {
        ...syncOperationInventoryUpdate,
        id: "sync-old",
        startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      };
      mockData.syncOperations.set(oldOp.id, oldOp);

      const ops = await getRecentSyncOperations({
        since: fiveMinutesAgo,
      });

      // Should only return operations after fiveMinutesAgo
      ops.forEach((op) => {
        expect(op.startedAt.getTime()).toBeGreaterThanOrEqual(fiveMinutesAgo.getTime());
      });
    });

    it("should order by startedAt desc", async () => {
      // Add operations with different timestamps
      const op1 = {
        ...syncOperationInventoryUpdate,
        id: "sync-1",
        startedAt: new Date(Date.now() - 3000),
      };
      const op2 = {
        ...syncOperationInventoryUpdate,
        id: "sync-2",
        startedAt: new Date(Date.now() - 1000),
      };
      mockData.syncOperations.clear();
      mockData.syncOperations.set(op1.id, op1);
      mockData.syncOperations.set(op2.id, op2);

      const ops = await getRecentSyncOperations();

      // Most recent should be first
      expect(ops[0].id).toBe("sync-2");
      expect(ops[1].id).toBe("sync-1");
    });
  });
});
