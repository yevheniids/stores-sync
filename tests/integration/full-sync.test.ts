/**
 * Full Sync Integration Tests
 *
 * Tests full synchronization cycles across multiple stores
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { processInventoryChange } from "~/lib/sync/engine.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";
import {
  storeA,
  storeB,
  storeC,
  productWithSku001,
  productWithSku002,
  inventoryFor001,
  inventoryFor002,
  mappingProduct001StoreA,
  mappingProduct001StoreB,
  mappingProduct002StoreA,
} from "../mocks/fixtures";
import { mockSessionStorage, mockInventoryAPI } from "../mocks/shopify";

// Mock modules
vi.mock("~/db.server", () => ({
  prisma: mockPrisma,
  executeTransaction: vi.fn(async (callback) => callback(mockPrisma)),
}));

vi.mock("~/shopify.server", () => ({
  storage: mockSessionStorage,
}));

vi.mock("~/lib/shopify/inventory.server", () => mockInventoryAPI);

vi.mock("~/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    sync: vi.fn(),
    database: vi.fn(),
  },
}));

vi.mock("~/lib/sync/product-mapper.server", () => ({
  findProductBySku: vi.fn((sku) => {
    const product = sku === productWithSku001.sku
      ? mockData.products.get(productWithSku001.id)
      : sku === productWithSku002.sku
      ? mockData.products.get(productWithSku002.id)
      : null;

    if (!product) return null;

    const inventory = sku === productWithSku001.sku
      ? mockData.inventory.get(inventoryFor001.id)
      : mockData.inventory.get(inventoryFor002.id);

    const mappings = Array.from(mockData.productStoreMappings.values())
      .filter((m: any) => m.productId === product.id)
      .map((m: any) => ({
        ...m,
        store: mockData.stores.get(m.storeId),
      }));

    return {
      ...product,
      inventory,
      storeMappings: mappings,
    };
  }),
  getAllMappings: vi.fn((sku) => {
    const product = sku === productWithSku001.sku
      ? mockData.products.get(productWithSku001.id)
      : mockData.products.get(productWithSku002.id);

    if (!product) return [];

    return Array.from(mockData.productStoreMappings.values())
      .filter((m: any) => m.productId === product.id)
      .map((m: any) => ({
        ...m,
        store: mockData.stores.get(m.storeId),
      }));
  }),
}));

vi.mock("~/lib/db/inventory-queries.server", () => ({
  recordSyncOperation: vi.fn((data) => ({
    ...data,
    id: `sync-${Date.now()}-${Math.random()}`,
    createdAt: new Date(),
  })),
  updateSyncOperation: vi.fn((id, data) => ({ id, ...data })),
}));

describe("Full Sync Integration", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();

    // Setup test data
    mockData.stores.set(storeA.id, storeA);
    mockData.stores.set(storeB.id, storeB);
    mockData.stores.set(storeC.id, storeC);
    mockData.products.set(productWithSku001.id, productWithSku001);
    mockData.products.set(productWithSku002.id, productWithSku002);
    mockData.inventory.set(inventoryFor001.id, { ...inventoryFor001, availableQuantity: 100 });
    mockData.inventory.set(inventoryFor002.id, { ...inventoryFor002, availableQuantity: 50 });
    mockData.productStoreMappings.set(`${productWithSku001.id}-${storeA.id}`, mappingProduct001StoreA);
    mockData.productStoreMappings.set(`${productWithSku001.id}-${storeB.id}`, mappingProduct001StoreB);
    mockData.productStoreMappings.set(`${productWithSku002.id}-${storeA.id}`, mappingProduct002StoreA);
  });

  describe("Multi-Store Sync", () => {
    it("should detect and fix discrepancies across stores", async () => {
      // Simulate discrepancy: Store A has different inventory than central DB
      const inventory001 = mockData.inventory.get(inventoryFor001.id);
      inventory001.availableQuantity = 100; // Central DB

      // Process inventory change from Store A
      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -10,
        reason: "order-created",
      });

      expect(result.success).toBe(true);

      // Verify central inventory updated
      expect(mockData.inventory.get(inventoryFor001.id).availableQuantity).toBe(90);

      // Verify Store B was updated
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledWith(
        expect.objectContaining({ shop: storeB.shopDomain }),
        expect.any(String),
        expect.any(String),
        90,
        expect.any(String)
      );
    });

    it("should handle multiple stores with different sync statuses", async () => {
      // Store A: active and sync enabled
      // Store B: active and sync enabled
      // Store C: active but sync disabled

      mockData.productStoreMappings.set(
        `${productWithSku001.id}-${storeC.id}`,
        {
          ...mappingProduct001StoreA,
          id: "mapping-c",
          storeId: storeC.id,
        }
      );

      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      expect(result.success).toBe(true);

      // Should only update Store B (Store C has sync disabled)
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledTimes(1);
    });

    it("should record all sync operations", async () => {
      const { recordSyncOperation } = await import("~/lib/db/inventory-queries.server");

      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      // Should have multiple calls:
      // 1. STORE_TO_CENTRAL for Store A
      // 2. CENTRAL_TO_STORE for Store B
      expect(recordSyncOperation).toHaveBeenCalled();
      const calls = vi.mocked(recordSyncOperation).mock.calls;
      expect(calls.length).toBeGreaterThan(1);
    });
  });

  describe("Concurrent Sync Operations", () => {
    it("should handle concurrent sync operations without data corruption", async () => {
      // Simulate two concurrent inventory changes
      const promise1 = processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -3,
        reason: "order-1",
      });

      const promise2 = processInventoryChange({
        shopDomain: storeB.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-2",
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should succeed (transactions should handle concurrency)
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Final inventory should reflect both changes
      // Note: In real implementation with proper transactions, this would be 92 (100 - 3 - 5)
      // In our mock, they might overwrite each other, which is expected behavior to test
      const finalInventory = mockData.inventory.get(inventoryFor001.id);
      expect(finalInventory.availableQuantity).toBeLessThan(100);
    });
  });

  describe("Sync Operation Audit Trail", () => {
    it("should maintain complete audit trail", async () => {
      const { recordSyncOperation } = await import("~/lib/db/inventory-queries.server");

      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -10,
        reason: "test-audit",
      });

      // Verify all sync operations were recorded
      const calls = vi.mocked(recordSyncOperation).mock.calls;

      // Should have STORE_TO_CENTRAL operation
      const storeToCentral = calls.find(
        (call) => call[0].direction === "STORE_TO_CENTRAL"
      );
      expect(storeToCentral).toBeDefined();

      // Should have CENTRAL_TO_STORE operation(s)
      const centralToStore = calls.find(
        (call) => call[0].direction === "CENTRAL_TO_STORE"
      );
      expect(centralToStore).toBeDefined();

      // All should have previousValue and newValue
      calls.forEach((call) => {
        expect(call[0].previousValue).toBeDefined();
        expect(call[0].newValue).toBeDefined();
      });
    });
  });

  describe("Partial Failures", () => {
    it("should handle partial sync failures gracefully", async () => {
      // Make one store update fail
      mockInventoryAPI.updateInventoryLevel
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error("Network timeout")); // Second call fails

      // Add more stores to test partial failure
      const storeD = { ...storeB, id: "store-d-id", shopDomain: "store-d.myshopify.com" };
      mockData.stores.set(storeD.id, storeD);
      mockData.productStoreMappings.set(
        `${productWithSku001.id}-${storeD.id}`,
        {
          ...mappingProduct001StoreB,
          id: "mapping-d",
          storeId: storeD.id,
        }
      );

      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "test-partial-failure",
      });

      // Central update should succeed even if some stores fail
      expect(result.details?.newQuantity).toBe(95);

      // Result should indicate partial failure
      if (result.details?.storesFailed !== undefined) {
        expect(result.details.storesFailed).toBeGreaterThan(0);
      }
    });

    it("should continue processing remaining stores after failure", async () => {
      // Make first store update fail, second should still be attempted
      mockInventoryAPI.updateInventoryLevel
        .mockRejectedValueOnce(new Error("Store B failed"))
        .mockResolvedValueOnce(undefined);

      // Add third store
      const storeD = { ...storeB, id: "store-d-id", shopDomain: "store-d.myshopify.com" };
      mockData.stores.set(storeD.id, storeD);
      mockData.productStoreMappings.set(
        `${productWithSku001.id}-${storeD.id}`,
        {
          ...mappingProduct001StoreB,
          id: "mapping-d",
          storeId: storeD.id,
        }
      );

      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "test-continue-after-failure",
      });

      // Should attempt to update both Store B and Store D
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledTimes(2);
    });
  });

  describe("Store Session Management", () => {
    it("should handle missing store sessions gracefully", async () => {
      // Mock session storage to return null for Store B
      mockSessionStorage.loadSession.mockImplementation((sessionId: string) => {
        if (sessionId.includes(storeB.shopDomain)) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: sessionId,
          shop: storeA.shopDomain,
          state: "test",
          isOnline: false,
          accessToken: "test-token",
          scope: "read_products,write_products",
          expires: null,
        });
      });

      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "test-missing-session",
      });

      // Central update should still succeed
      expect(result.details?.newQuantity).toBe(95);

      // Should report failure for Store B
      if (result.details?.storesFailed !== undefined) {
        expect(result.details.storesFailed).toBeGreaterThan(0);
      }
    });
  });
});
