/**
 * Shopify GraphQL Query and Mutation Definitions
 *
 * Centralized GraphQL operations for inventory management
 */

/**
 * Query to get inventory levels for an inventory item
 */
export const INVENTORY_LEVELS_QUERY = `
  query GetInventoryLevels($inventoryItemId: ID!, $first: Int = 10) {
    inventoryItem(id: $inventoryItemId) {
      id
      sku
      tracked
      inventoryLevels(first: $first) {
        edges {
          node {
            id
            quantities(names: ["available"]) {
              name
              quantity
            }
            location {
              id
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to get product variants by SKU
 */
export const PRODUCT_VARIANTS_BY_SKU_QUERY = `
  query GetProductVariantsBySku($sku: String!) {
    productVariants(first: 10, query: $sku) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
            tracked
          }
          product {
            id
            title
          }
        }
      }
    }
  }
`;

/**
 * Query to get all locations for a store
 */
export const LOCATIONS_QUERY = `
  query GetLocations($first: Int = 50) {
    locations(first: $first) {
      edges {
        node {
          id
          name
          isActive
          address {
            address1
            city
            province
            country
          }
        }
      }
    }
  }
`;

/**
 * Query to get product by ID
 */
export const PRODUCT_BY_ID_QUERY = `
  query GetProductById($id: ID!) {
    product(id: $id) {
      id
      title
      description
      vendor
      productType
      tags
      variants(first: 100) {
        edges {
          node {
            id
            sku
            price
            compareAtPrice
            inventoryItem {
              id
              tracked
            }
            inventoryQuantity
          }
        }
      }
    }
  }
`;

/**
 * Mutation to set inventory quantities
 * Uses the new inventorySetQuantities mutation
 */
export const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        createdAt
        reason
        changes {
          name
          delta
          quantityAfterChange
          item {
            id
            sku
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Query to get inventory item by ID
 */
export const INVENTORY_ITEM_QUERY = `
  query GetInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      id
      sku
      tracked
      variant {
        id
        product {
          id
          title
        }
      }
      inventoryLevels(first: 10) {
        edges {
          node {
            id
            quantities(names: ["available"]) {
              name
              quantity
            }
            location {
              id
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to get multiple products with pagination
 */
export const PRODUCTS_QUERY = `
  query GetProducts($first: Int = 50, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          vendor
          productType
          tags
          variants(first: 100) {
            edges {
              node {
                id
                sku
                price
                inventoryItem {
                  id
                  tracked
                }
                inventoryQuantity
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Query to search products by title or SKU
 */
export const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!, $first: Int = 50) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          vendor
          variants(first: 10) {
            edges {
              node {
                id
                sku
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to get inventory levels for a specific location
 */
export const INVENTORY_LEVELS_BY_LOCATION_QUERY = `
  query GetInventoryLevelsByLocation($locationId: ID!, $first: Int = 50, $after: String) {
    location(id: $locationId) {
      id
      name
      inventoryLevels(first: $first, after: $after) {
        edges {
          node {
            id
            quantities(names: ["available"]) {
              name
              quantity
            }
            item {
              id
              sku
              variant {
                id
                product {
                  id
                  title
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/**
 * Query to get inventory levels with full quantity breakdown for a single inventory item.
 * Returns available, committed, and incoming quantities per location.
 * Used during catalog sync to populate per-location inventory.
 */
export const INVENTORY_LEVELS_WITH_QUANTITIES_QUERY = `
  query GetInventoryLevelsWithQuantities($inventoryItemId: ID!, $first: Int = 50) {
    inventoryItem(id: $inventoryItemId) {
      id
      inventoryLevels(first: $first) {
        edges {
          node {
            quantities(names: ["available", "committed", "incoming"]) {
              name
              quantity
            }
            location {
              id
            }
          }
        }
      }
    }
  }
`;

/**
 * TypeScript types for GraphQL responses
 */

export interface InventoryLevel {
  id: string;
  quantities: Array<{
    name: string;
    quantity: number;
  }>;
  location: {
    id: string;
    name: string;
  };
}

export interface InventoryItem {
  id: string;
  sku: string;
  tracked: boolean;
  inventoryLevels: {
    edges: Array<{
      node: InventoryLevel;
    }>;
  };
}

export interface ProductVariant {
  id: string;
  sku: string;
  price?: string;
  compareAtPrice?: string;
  inventoryItem: {
    id: string;
    tracked: boolean;
  };
  inventoryQuantity?: number;
  product?: {
    id: string;
    title: string;
  };
}

export interface Location {
  id: string;
  name: string;
  isActive: boolean;
  address?: {
    address1?: string;
    city?: string;
    province?: string;
    country?: string;
  };
}

export interface InventorySetQuantitiesInput {
  reason: string;
  name: string;
  ignoreCompareQuantity?: boolean;
  quantities: Array<{
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  }>;
}

export interface InventorySetQuantitiesResponse {
  inventorySetQuantities: {
    inventoryAdjustmentGroup?: {
      id: string;
      createdAt: string;
      reason: string;
      changes: Array<{
        name: string;
        delta: number;
        quantityAfterChange: number;
        item: {
          id: string;
          sku: string;
        };
        location: {
          id: string;
          name: string;
        };
      }>;
    };
    userErrors: Array<{
      field: string[];
      message: string;
    }>;
  };
}

export interface GetInventoryLevelsResponse {
  inventoryItem: InventoryItem;
}

export interface GetProductVariantsBySkuResponse {
  productVariants: {
    edges: Array<{
      node: ProductVariant;
    }>;
  };
}

export interface InventoryLevelWithQuantities {
  quantities: Array<{
    name: string;
    quantity: number;
  }>;
  location: {
    id: string;
  };
}

export interface GetInventoryLevelsWithQuantitiesResponse {
  inventoryItem: {
    id: string;
    inventoryLevels: {
      edges: Array<{
        node: InventoryLevelWithQuantities;
      }>;
    };
  };
}

export interface GetLocationsResponse {
  locations: {
    edges: Array<{
      node: Location;
    }>;
  };
}

export interface GetProductByIdResponse {
  product: {
    id: string;
    title: string;
    description: string;
    vendor: string;
    productType: string;
    tags: string[];
    variants: {
      edges: Array<{
        node: ProductVariant;
      }>;
    };
  };
}

export interface GetProductsResponse {
  products: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        vendor: string;
        productType: string;
        tags: string[];
        variants: {
          edges: Array<{
            node: ProductVariant;
          }>;
        };
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}
