/**
 * Sync Engine Unit Tests
 *
 * Tests for the core sync engine functionality
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { processInventoryChange, syncProductToStore } from "~/lib/sync/engine.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";
import {
  storeA,
  storeB,
  productWithSku001,
  inventoryFor001,
  mappingProduct001StoreA,
  mappingProduct001StoreB,
} from "../mocks/fixtures";
import { mockInventoryAPI, mockSessionStorage } from "../mocks/shopify";

// Mock modules
vi.mock("~/db.server", () => ({
  prisma: mockPrisma,
  executeTransaction: vi.fn(async (callback) => callback(mockPrisma)),
}));

vi.mock("~/shopify.server", () => ({
  storage: mockSessionStorage,
  createGraphQLClient: vi.fn(),
  withRetry: vi.fn((fn) => fn()),
}));

vi.mock("~/lib/shopify/inventory.server", () => mockInventoryAPI);

vi.mock("~/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    sync: vi.fn(),
    webhook: vi.fn(),
    job: vi.fn(),
    conflict: vi.fn(),
    database: vi.fn(),
  },
}));

vi.mock("~/lib/sync/product-mapper.server", () => ({
  findProductBySku: vi.fn((sku) => {
    const product = mockData.products.get(productWithSku001.id);
    if (!product) return null;
    return {
      ...product,
      inventory: mockData.inventory.get(inventoryFor001.id),
      storeMappings: [
        { ...mockData.productStoreMappings.get(`${productWithSku001.id}-${storeA.id}`), store: storeA },
        { ...mockData.productStoreMappings.get(`${productWithSku001.id}-${storeB.id}`), store: storeB },
      ],
    };
  }),
  getAllMappings: vi.fn(() => [
    { ...mockData.productStoreMappings.get(`${productWithSku001.id}-${storeA.id}`), store: storeA },
    { ...mockData.productStoreMappings.get(`${productWithSku001.id}-${storeB.id}`), store: storeB },
  ]),
  discoverAndMapProduct: vi.fn(),
}));

vi.mock("~/lib/db/inventory-queries.server", () => ({
  recordSyncOperation: vi.fn((data) => ({
    ...data,
    id: `sync-${Date.now()}`,
    createdAt: new Date(),
  })),
  updateSyncOperation: vi.fn((id, data) => ({ id, ...data })),
}));

describe("Sync Engine", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();

    // Setup test data
    mockData.stores.set(storeA.id, storeA);
    mockData.stores.set(storeB.id, storeB);
    mockData.products.set(productWithSku001.id, productWithSku001);
    mockData.inventory.set(inventoryFor001.id, { ...inventoryFor001 });
    mockData.productStoreMappings.set(`${productWithSku001.id}-${storeA.id}`, mappingProduct001StoreA);
    mockData.productStoreMappings.set(`${productWithSku001.id}-${storeB.id}`, mappingProduct001StoreB);
  });

  describe("processInventoryChange", () => {
    it("should correctly update central inventory", async () => {
      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
        sourceEventId: "webhook-001",
      });

      expect(result.success).toBe(true);
      expect(result.details?.previousQuantity).toBe(100);
      expect(result.details?.newQuantity).toBe(95);
      expect(result.details?.change).toBe(-5);
    });

    it("should push changes to other stores (not source)", async () => {
      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      // Verify updateInventoryLevel was called for Store B only
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledTimes(1);
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledWith(
        expect.objectContaining({ shop: storeB.shopDomain }),
        expect.any(String),
        expect.any(String),
        95, // New quantity
        expect.any(String)
      );
    });

    it("should handle missing products gracefully", async () => {
      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: "NON-EXISTENT-SKU",
        quantityChange: -5,
        reason: "order-created",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should record sync operations", async () => {
      const { recordSyncOperation } = await import("~/lib/db/inventory-queries.server");

      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      // Should record: 1 STORE_TO_CENTRAL + N CENTRAL_TO_STORE (for other stores)
      expect(recordSyncOperation).toHaveBeenCalled();
    });

    it("should prevent negative inventory", async () => {
      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -200, // More than available
        reason: "order-created",
      });

      expect(result.success).toBe(true);
      expect(result.details?.newQuantity).toBe(0); // Should not go negative
    });

    it("should skip inactive stores", async () => {
      // Add inactive store
      const inactiveStore = { ...storeB, id: "store-c-id", isActive: false };
      mockData.stores.set(inactiveStore.id, inactiveStore);
      mockData.productStoreMappings.set(
        `${productWithSku001.id}-${inactiveStore.id}`,
        { ...mappingProduct001StoreB, id: "mapping-c", storeId: inactiveStore.id }
      );

      const { getAllMappings } = await import("~/lib/sync/product-mapper.server");
      vi.mocked(getAllMappings).mockResolvedValue([
        { ...mappingProduct001StoreA, store: storeA },
        { ...mappingProduct001StoreB, store: storeB },
        { ...mappingProduct001StoreB, id: "mapping-c", storeId: inactiveStore.id, store: inactiveStore },
      ]);

      await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      // Should only update active store (Store B)
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalledTimes(1);
    });

    it("should handle sync failures to individual stores", async () => {
      // Make updateInventoryLevel fail
      mockInventoryAPI.updateInventoryLevel.mockRejectedValueOnce(new Error("Network error"));

      const result = await processInventoryChange({
        shopDomain: storeA.shopDomain,
        sku: productWithSku001.sku,
        quantityChange: -5,
        reason: "order-created",
      });

      // Should still succeed for central update but report failures
      expect(result.success).toBe(false); // Indicates partial failure
      expect(result.details?.storesFailed).toBeGreaterThan(0);
    });
  });

  describe("syncProductToStore", () => {
    it("should sync specific product to specific store", async () => {
      const result = await syncProductToStore(productWithSku001.sku, storeB.shopDomain);

      expect(result.success).toBe(true);
      expect(result.productId).toBe(productWithSku001.id);
      expect(mockInventoryAPI.updateInventoryLevel).toHaveBeenCalled();
    });

    it("should fail if product not found", async () => {
      const { findProductBySku } = await import("~/lib/sync/product-mapper.server");
      vi.mocked(findProductBySku).mockResolvedValueOnce(null);

      const result = await syncProductToStore("NON-EXISTENT", storeB.shopDomain);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail if store mapping not found", async () => {
      const result = await syncProductToStore(productWithSku001.sku, "non-existent-store.myshopify.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("mapping");
    });
  });
});
