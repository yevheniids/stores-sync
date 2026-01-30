/**
 * Test Data Fixtures
 *
 * Reusable test data for consistent testing
 */

import type { Store, Product, Inventory, ProductStoreMapping, SyncOperation, Conflict } from "@prisma/client";

// Sample Stores
export const storeA: Store = {
  id: "store-a-id",
  shopDomain: "store-a.myshopify.com",
  accessToken: "access-token-a",
  scope: "read_products,write_products,read_inventory,write_inventory",
  isActive: true,
  syncEnabled: true,
  installedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const storeB: Store = {
  id: "store-b-id",
  shopDomain: "store-b.myshopify.com",
  accessToken: "access-token-b",
  scope: "read_products,write_products,read_inventory,write_inventory",
  isActive: true,
  syncEnabled: true,
  installedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const storeC: Store = {
  id: "store-c-id",
  shopDomain: "store-c.myshopify.com",
  accessToken: "access-token-c",
  scope: "read_products,write_products,read_inventory,write_inventory",
  isActive: true,
  syncEnabled: false, // Sync disabled
  installedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// Sample Products
export const productWithSku001: Product = {
  id: "product-001-id",
  sku: "TEST-SKU-001",
  title: "Test Product 001",
  description: "A test product for unit testing",
  vendor: "Test Vendor",
  productType: "Test Type",
  tags: ["test", "sample"],
  imageUrl: "https://example.com/image.jpg",
  weight: 100,
  weightUnit: "g",
  inventoryPolicy: "DENY",
  tracksInventory: true,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const productWithSku002: Product = {
  id: "product-002-id",
  sku: "TEST-SKU-002",
  title: "Test Product 002",
  description: "Another test product",
  vendor: "Test Vendor",
  productType: "Test Type",
  tags: ["test"],
  imageUrl: null,
  weight: 200,
  weightUnit: "g",
  inventoryPolicy: "DENY",
  tracksInventory: true,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// Sample Inventory Records
export const inventoryFor001: Inventory = {
  id: "inventory-001-id",
  productId: "product-001-id",
  availableQuantity: 100,
  committedQuantity: 10,
  incomingQuantity: 0,
  lowStockThreshold: 20,
  lastAdjustedAt: new Date("2024-01-01"),
  lastAdjustedBy: "system",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const inventoryFor002: Inventory = {
  id: "inventory-002-id",
  productId: "product-002-id",
  availableQuantity: 50,
  committedQuantity: 5,
  incomingQuantity: 0,
  lowStockThreshold: 10,
  lastAdjustedAt: new Date("2024-01-01"),
  lastAdjustedBy: "system",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// Sample Product-Store Mappings
export const mappingProduct001StoreA: ProductStoreMapping = {
  id: "mapping-001-a-id",
  productId: "product-001-id",
  storeId: "store-a-id",
  shopifyProductId: "gid://shopify/Product/1001",
  shopifyVariantId: "gid://shopify/ProductVariant/2001",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/3001",
  storeSku: "TEST-SKU-001",
  price: 99.99,
  compareAtPrice: null,
  barcode: null,
  syncStatus: "COMPLETED",
  lastSyncedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const mappingProduct001StoreB: ProductStoreMapping = {
  id: "mapping-001-b-id",
  productId: "product-001-id",
  storeId: "store-b-id",
  shopifyProductId: "gid://shopify/Product/1002",
  shopifyVariantId: "gid://shopify/ProductVariant/2002",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/3002",
  storeSku: "TEST-SKU-001",
  price: 99.99,
  compareAtPrice: null,
  barcode: null,
  syncStatus: "COMPLETED",
  lastSyncedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const mappingProduct002StoreA: ProductStoreMapping = {
  id: "mapping-002-a-id",
  productId: "product-002-id",
  storeId: "store-a-id",
  shopifyProductId: "gid://shopify/Product/1003",
  shopifyVariantId: "gid://shopify/ProductVariant/2003",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/3003",
  storeSku: "TEST-SKU-002",
  price: 149.99,
  compareAtPrice: null,
  barcode: null,
  syncStatus: "COMPLETED",
  lastSyncedAt: new Date("2024-01-01"),
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// Sample Webhook Payloads
export const orderCreatedPayload = {
  id: 12345678,
  name: "#1001",
  created_at: "2024-01-01T10:00:00Z",
  line_items: [
    {
      id: 11111,
      variant_id: 2001,
      sku: "TEST-SKU-001",
      quantity: 2,
      price: "99.99",
      title: "Test Product 001",
    },
    {
      id: 11112,
      variant_id: 2003,
      sku: "TEST-SKU-002",
      quantity: 1,
      price: "149.99",
      title: "Test Product 002",
    },
  ],
};

export const orderCancelledPayload = {
  id: 12345678,
  name: "#1001",
  cancelled_at: "2024-01-01T11:00:00Z",
  line_items: [
    {
      id: 11111,
      variant_id: 2001,
      sku: "TEST-SKU-001",
      quantity: 2,
      price: "99.99",
      title: "Test Product 001",
    },
  ],
};

export const refundCreatedPayload = {
  id: 99999,
  order_id: 12345678,
  created_at: "2024-01-01T12:00:00Z",
  refund_line_items: [
    {
      id: 22222,
      line_item_id: 11111,
      quantity: 1,
      restock_type: "return",
      line_item: {
        id: 11111,
        variant_id: 2001,
        sku: "TEST-SKU-001",
        quantity: 2,
      },
    },
    {
      id: 22223,
      line_item_id: 11112,
      quantity: 1,
      restock_type: "no_restock",
      line_item: {
        id: 11112,
        variant_id: 2003,
        sku: "TEST-SKU-002",
        quantity: 1,
      },
    },
  ],
};

export const inventoryLevelUpdatePayload = {
  inventory_item_id: 3001,
  location_id: 5001,
  available: 95,
  updated_at: "2024-01-01T13:00:00Z",
};

// Sample Sync Operations
export const syncOperationInventoryUpdate: SyncOperation = {
  id: "sync-001-id",
  operationType: "INVENTORY_UPDATE",
  direction: "STORE_TO_CENTRAL",
  productId: "product-001-id",
  storeId: "store-a-id",
  status: "COMPLETED",
  previousValue: { available: 100 },
  newValue: { available: 98 },
  errorMessage: null,
  startedAt: new Date("2024-01-01T10:00:00Z"),
  completedAt: new Date("2024-01-01T10:00:01Z"),
  triggeredBy: "webhook-12345",
  userId: null,
  createdAt: new Date("2024-01-01T10:00:00Z"),
};

export const syncOperationFailed: SyncOperation = {
  id: "sync-002-id",
  operationType: "INVENTORY_UPDATE",
  direction: "CENTRAL_TO_STORE",
  productId: "product-001-id",
  storeId: "store-b-id",
  status: "FAILED",
  previousValue: { available: 100 },
  newValue: { available: 98 },
  errorMessage: "Connection timeout",
  startedAt: new Date("2024-01-01T10:00:00Z"),
  completedAt: new Date("2024-01-01T10:00:05Z"),
  triggeredBy: "sync-001-id",
  userId: null,
  createdAt: new Date("2024-01-01T10:00:00Z"),
};

// Sample Conflicts
export const conflictSyncCollision: Conflict = {
  id: "conflict-001-id",
  conflictType: "SYNC_COLLISION",
  productId: "product-001-id",
  storeId: "store-a-id",
  centralValue: { available: 100 },
  storeValue: { available: 95 },
  resolutionStrategy: "USE_LOWEST",
  resolved: false,
  resolvedAt: null,
  resolvedBy: null,
  resolvedValue: null,
  notes: "Simultaneous updates detected",
  detectedAt: new Date("2024-01-01T14:00:00Z"),
};

export const conflictInventoryMismatch: Conflict = {
  id: "conflict-002-id",
  conflictType: "INVENTORY_MISMATCH",
  productId: "product-002-id",
  storeId: "store-b-id",
  centralValue: { available: 50 },
  storeValue: { available: 45 },
  resolutionStrategy: "USE_DATABASE",
  resolved: true,
  resolvedAt: new Date("2024-01-01T15:00:00Z"),
  resolvedBy: "auto-resolution",
  resolvedValue: { available: 50 },
  notes: "Resolved using database value",
  detectedAt: new Date("2024-01-01T14:30:00Z"),
};

// Helper function to create a complete product with relations
export const createProductWithRelations = (overrides = {}) => ({
  ...productWithSku001,
  inventory: inventoryFor001,
  storeMappings: [
    { ...mappingProduct001StoreA, store: storeA },
    { ...mappingProduct001StoreB, store: storeB },
  ],
  ...overrides,
});

// Helper function to create webhook event data
export const createWebhookEventData = (topic: string, eventId = "webhook-event-001") => ({
  eventId,
  topic,
  shopDomain: "store-a.myshopify.com",
  payload: {},
  processed: false,
  processedAt: null,
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  receivedAt: new Date(),
});
