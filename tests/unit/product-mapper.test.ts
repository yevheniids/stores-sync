/**
 * Product Mapper Unit Tests
 *
 * Tests for SKU-based product mapping
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mapProductToStores,
  getStoreMapping,
  findProductBySku,
  createOrUpdateProduct,
} from "~/lib/sync/product-mapper.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";
import {
  storeA,
  storeB,
  productWithSku001,
  mappingProduct001StoreA,
  mappingProduct001StoreB,
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

describe("Product Mapper", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();

    // Setup test data
    mockData.stores.set(storeA.id, storeA);
    mockData.stores.set(storeB.id, storeB);
  });

  describe("mapProductToStores", () => {
    it("should create correct mappings", async () => {
      mockData.products.set(productWithSku001.id, productWithSku001);

      const storeVariants = [
        {
          storeId: storeA.id,
          shopifyProductId: "gid://shopify/Product/1001",
          shopifyVariantId: "gid://shopify/ProductVariant/2001",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/3001",
          price: 99.99,
        },
        {
          storeId: storeB.id,
          shopifyProductId: "gid://shopify/Product/1002",
          shopifyVariantId: "gid://shopify/ProductVariant/2002",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/3002",
          price: 99.99,
        },
      ];

      const mappings = await mapProductToStores(productWithSku001.sku, storeVariants);

      expect(mappings).toHaveLength(2);
      expect(mappings[0].productId).toBe(productWithSku001.id);
      expect(mappings[0].storeId).toBe(storeA.id);
      expect(mappings[1].storeId).toBe(storeB.id);
    });

    it("should create placeholder product if not exists", async () => {
      const storeVariants = [
        {
          storeId: storeA.id,
          shopifyProductId: "gid://shopify/Product/1001",
          shopifyVariantId: "gid://shopify/ProductVariant/2001",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/3001",
        },
      ];

      const mappings = await mapProductToStores("NEW-SKU-001", storeVariants);

      expect(mappings).toHaveLength(1);
      // Product should be created
      const createdProducts = Array.from(mockData.products.values());
      const newProduct = createdProducts.find((p: any) => p.sku === "NEW-SKU-001");
      expect(newProduct).toBeDefined();
    });

    it("should update existing mappings", async () => {
      mockData.products.set(productWithSku001.id, productWithSku001);
      mockData.productStoreMappings.set(
        `${productWithSku001.id}-${storeA.id}`,
        { ...mappingProduct001StoreA, price: 89.99 }
      );

      const storeVariants = [
        {
          storeId: storeA.id,
          shopifyProductId: "gid://shopify/Product/1001",
          shopifyVariantId: "gid://shopify/ProductVariant/2001",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/3001",
          price: 99.99, // Updated price
        },
      ];

      const mappings = await mapProductToStores(productWithSku001.sku, storeVariants);

      expect(mappings[0].price).toBe(99.99);
    });
  });

  describe("getStoreMapping", () => {
    beforeEach(() => {
      mockData.products.set(productWithSku001.id, productWithSku001);
      mockData.productStoreMappings.set(`${productWithSku001.id}-${storeA.id}`, mappingProduct001StoreA);
    });

    it("should return correct variant ID", async () => {
      const mapping = await getStoreMapping(productWithSku001.sku, storeA.shopDomain);

      expect(mapping).toBeDefined();
      expect(mapping?.shopifyVariantId).toBe("gid://shopify/ProductVariant/2001");
    });

    it("should return null for missing product", async () => {
      const mapping = await getStoreMapping("NON-EXISTENT", storeA.shopDomain);

      expect(mapping).toBeNull();
    });

    it("should return null for missing store", async () => {
      const mapping = await getStoreMapping(productWithSku001.sku, "non-existent.myshopify.com");

      expect(mapping).toBeNull();
    });

    it("should include product and store relations", async () => {
      const mapping = await getStoreMapping(productWithSku001.sku, storeA.shopDomain);

      expect(mapping?.product).toBeDefined();
      expect(mapping?.product.sku).toBe(productWithSku001.sku);
      expect(mapping?.store).toBeDefined();
      expect(mapping?.store.shopDomain).toBe(storeA.shopDomain);
    });
  });

  describe("findProductBySku", () => {
    it("should handle missing products", async () => {
      const product = await findProductBySku("NON-EXISTENT");

      expect(product).toBeNull();
    });

    it("should return product with relations", async () => {
      mockData.products.set(productWithSku001.id, productWithSku001);
      mockData.inventory.set("inv-001", {
        id: "inv-001",
        productId: productWithSku001.id,
        availableQuantity: 100,
        committedQuantity: 0,
        incomingQuantity: 0,
        lowStockThreshold: 20,
        lastAdjustedAt: new Date(),
        lastAdjustedBy: "system",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockData.productStoreMappings.set(`${productWithSku001.id}-${storeA.id}`, mappingProduct001StoreA);

      const product = await findProductBySku(productWithSku001.sku);

      expect(product).toBeDefined();
      expect(product?.inventory).toBeDefined();
      expect(product?.storeMappings).toBeDefined();
      expect(product?.storeMappings).toHaveLength(1);
    });
  });

  describe("createOrUpdateProduct", () => {
    it("should create new product with correct data", async () => {
      const productData = {
        sku: "NEW-SKU-002",
        title: "New Test Product",
        description: "Test description",
        vendor: "Test Vendor",
        productType: "Test Type",
        tags: ["tag1", "tag2"],
        weight: 150,
        weightUnit: "g",
        inventoryPolicy: "DENY" as const,
        tracksInventory: true,
      };

      const product = await createOrUpdateProduct(productData);

      expect(product.sku).toBe("NEW-SKU-002");
      expect(product.title).toBe("New Test Product");
      expect(product.vendor).toBe("Test Vendor");
      expect(product.tags).toEqual(["tag1", "tag2"]);
    });

    it("should update existing product", async () => {
      mockData.products.set(productWithSku001.id, {
        ...productWithSku001,
        title: "Old Title",
      });

      const product = await createOrUpdateProduct({
        sku: productWithSku001.sku,
        title: "Updated Title",
      });

      expect(product.title).toBe("Updated Title");
      expect(product.sku).toBe(productWithSku001.sku);
    });

    it("should set default values", async () => {
      const product = await createOrUpdateProduct({
        sku: "MINIMAL-SKU",
        title: "Minimal Product",
      });

      expect(product.inventoryPolicy).toBe("DENY");
      expect(product.tracksInventory).toBe(true);
      expect(product.weightUnit).toBe("g");
      expect(product.tags).toEqual([]);
    });
  });
});
