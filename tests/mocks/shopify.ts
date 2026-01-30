/**
 * Shopify API Mocks
 *
 * Mock Shopify GraphQL client and authentication
 */

import { vi } from "vitest";

// Mock GraphQL responses
export const mockGraphQLResponses = {
  inventoryLevels: {
    inventoryItem: {
      id: "gid://shopify/InventoryItem/12345",
      inventoryLevels: {
        edges: [
          {
            node: {
              id: "gid://shopify/InventoryLevel/1",
              available: 100,
              location: {
                id: "gid://shopify/Location/1",
                name: "Main Location",
              },
            },
          },
        ],
      },
    },
  },

  inventorySetQuantities: {
    inventorySetQuantities: {
      inventoryAdjustmentGroup: {
        id: "gid://shopify/InventoryAdjustmentGroup/1",
      },
      userErrors: [],
    },
  },

  productVariantsBySku: {
    productVariants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/12345",
            sku: "TEST-SKU-001",
            price: "99.99",
            compareAtPrice: null,
            inventoryItem: {
              id: "gid://shopify/InventoryItem/12345",
              tracked: true,
            },
            product: {
              id: "gid://shopify/Product/1",
              title: "Test Product",
            },
          },
        },
      ],
    },
  },

  locations: {
    locations: {
      edges: [
        {
          node: {
            id: "gid://shopify/Location/1",
            name: "Main Location",
            isActive: true,
          },
        },
      ],
    },
  },
};

// Mock GraphQL client
export const createMockGraphQLClient = () => ({
  query: vi.fn((query: string, variables: any) => {
    // Return appropriate mock response based on query
    if (query.includes("inventoryItem(id:")) {
      return Promise.resolve(mockGraphQLResponses.inventoryLevels);
    }
    if (query.includes("inventorySetQuantities")) {
      return Promise.resolve(mockGraphQLResponses.inventorySetQuantities);
    }
    if (query.includes("productVariants")) {
      return Promise.resolve(mockGraphQLResponses.productVariantsBySku);
    }
    if (query.includes("locations")) {
      return Promise.resolve(mockGraphQLResponses.locations);
    }
    return Promise.resolve({});
  }),
});

// Mock session
export const createMockSession = (overrides = {}) => ({
  id: "offline_test-store.myshopify.com",
  shop: "test-store.myshopify.com",
  state: "test-state",
  isOnline: false,
  accessToken: "test-access-token",
  scope: "read_products,write_products,read_inventory,write_inventory",
  expires: null,
  ...overrides,
});

// Mock session storage
export const mockSessionStorage = {
  loadSession: vi.fn((sessionId: string) => {
    if (sessionId.includes("test-store")) {
      return Promise.resolve(createMockSession());
    }
    return Promise.resolve(null);
  }),
  storeSession: vi.fn(() => Promise.resolve(true)),
  deleteSession: vi.fn(() => Promise.resolve(true)),
};

// Mock authenticate.webhook
export const mockAuthenticateWebhook = vi.fn((request: Request) => {
  const topic = request.headers.get("X-Shopify-Topic") || "ORDERS_CREATE";
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "test-store.myshopify.com";

  return Promise.resolve({
    topic,
    shop,
    session: null,
    admin: null,
    payload: {},
  });
});

// Mock authenticate.admin
export const mockAuthenticateAdmin = vi.fn(() => {
  return Promise.resolve({
    session: createMockSession(),
    admin: {
      graphql: createMockGraphQLClient(),
    },
  });
});

// Mock Shopify app instance
export const mockShopify = {
  authenticate: {
    webhook: mockAuthenticateWebhook,
    admin: mockAuthenticateAdmin,
  },
  config: {
    apiKey: "test-api-key",
    apiSecretKey: "test-api-secret",
    scopes: ["read_products", "write_products", "read_inventory", "write_inventory"],
    hostName: "test-host.com",
    isEmbeddedApp: true,
  },
};

// Mock inventory API functions
export const mockInventoryAPI = {
  getInventoryLevels: vi.fn(() =>
    Promise.resolve([
      {
        id: "gid://shopify/InventoryLevel/1",
        available: 100,
        location: {
          id: "gid://shopify/Location/1",
          name: "Main Location",
        },
      },
    ])
  ),

  setInventoryQuantities: vi.fn(() =>
    Promise.resolve({
      inventoryAdjustmentGroup: {
        id: "gid://shopify/InventoryAdjustmentGroup/1",
      },
      userErrors: [],
    })
  ),

  getProductVariantsBySku: vi.fn((session: any, sku: string) =>
    Promise.resolve([
      {
        id: "gid://shopify/ProductVariant/12345",
        sku,
        price: "99.99",
        compareAtPrice: null,
        inventoryItem: {
          id: "gid://shopify/InventoryItem/12345",
          tracked: true,
        },
        product: {
          id: "gid://shopify/Product/1",
          title: "Test Product",
        },
      },
    ])
  ),

  getLocationIds: vi.fn(() =>
    Promise.resolve([
      {
        id: "gid://shopify/Location/1",
        name: "Main Location",
        isActive: true,
      },
    ])
  ),

  getPrimaryLocation: vi.fn(() =>
    Promise.resolve({
      id: "gid://shopify/Location/1",
      name: "Main Location",
      isActive: true,
    })
  ),

  updateInventoryLevel: vi.fn(() => Promise.resolve()),

  batchUpdateInventory: vi.fn(() => Promise.resolve()),
};
