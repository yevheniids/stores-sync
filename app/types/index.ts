/**
 * Shared TypeScript type definitions
 */

import type {
  Product,
  Store,
  Inventory,
  ProductStoreMapping,
  SyncOperation,
  Conflict,
  WebhookEvent,
  SyncStatus,
  ConflictResolutionStrategy,
  ConflictType,
  OperationType,
  SyncDirection,
} from "@prisma/client";

/**
 * Database model types with relations
 */
export type ProductWithRelations = Product & {
  inventory?: Inventory | null;
  storeMappings?: ProductStoreMapping[];
};

export type StoreWithRelations = Store & {
  productMappings?: ProductStoreMapping[];
};

export type InventoryWithProduct = Inventory & {
  product: Product;
};

export type ConflictWithRelations = Conflict & {
  product: Product;
  store: Store;
};

export type SyncOperationWithRelations = SyncOperation & {
  product?: Product | null;
  store?: Store | null;
};

/**
 * Shopify webhook payload types
 */
export interface ShopifyWebhookHeaders {
  "x-shopify-topic": string;
  "x-shopify-hmac-sha256": string;
  "x-shopify-shop-domain": string;
  "x-shopify-webhook-id": string;
  "x-shopify-api-version": string;
  "x-shopify-triggered-at": string;
}

export interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  status: "active" | "archived" | "draft";
  created_at: string;
  updated_at: string;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  position: number;
  inventory_policy: "deny" | "continue";
  compare_at_price: string | null;
  fulfillment_service: string;
  inventory_management: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode: string | null;
  grams: number;
  weight: number;
  weight_unit: string;
  inventory_item_id: number;
  inventory_quantity: number;
  old_inventory_quantity: number;
  requires_shipping: boolean;
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  src: string;
  width: number;
  height: number;
  variant_ids: number[];
}

export interface ShopifyOrder {
  id: number;
  email: string;
  created_at: string;
  updated_at: string;
  line_items: ShopifyLineItem[];
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
}

export interface ShopifyLineItem {
  id: number;
  variant_id: number;
  title: string;
  quantity: number;
  sku: string;
  price: string;
  product_id: number;
  fulfillment_status: string | null;
}

/**
 * GraphQL response types
 */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export interface InventoryLevelNode {
  id: string;
  available: number;
  item: {
    id: string;
    sku: string;
  };
  location: {
    id: string;
    name: string;
  };
}

/**
 * Sync operation types
 */
export interface SyncResult {
  success: boolean;
  productId: string;
  storeId?: string;
  operation: OperationType;
  error?: string;
  details?: any;
}

export interface BatchSyncResult {
  total: number;
  successful: number;
  failed: number;
  results: SyncResult[];
}

export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflictType?: ConflictType;
  centralValue?: any;
  storeValue?: any;
  recommendedStrategy?: ConflictResolutionStrategy;
}

/**
 * Queue job result types
 */
export interface JobResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  retryable?: boolean;
}

/**
 * API response types
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Configuration types
 */
export interface SyncConfig {
  batchSize: number;
  concurrency: number;
  retryAttempts: number;
  retryDelay: number;
  conflictResolutionStrategy: ConflictResolutionStrategy;
}

export interface StoreConfig {
  storeId: string;
  shopDomain: string;
  syncEnabled: boolean;
  autoSyncInterval?: number;
  conflictResolution?: ConflictResolutionStrategy;
}

/**
 * Dashboard statistics types
 */
export interface DashboardStats {
  totalStores: number;
  activeStores: number;
  totalProducts: number;
  syncedProducts: number;
  pendingOperations: number;
  failedOperations: number;
  unresolvedConflicts: number;
  lastSyncAt?: Date;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

/**
 * Export all Prisma enums for convenience
 */
export {
  SyncStatus,
  ConflictResolutionStrategy,
  ConflictType,
  OperationType,
  SyncDirection,
};

/**
 * Utility types
 */
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type ID = string;
export type Timestamp = Date | string;
