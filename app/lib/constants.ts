/**
 * Application Constants
 *
 * Central location for all constant values used across the application
 */

/**
 * Sync configuration constants
 */
export const SYNC_CONFIG = {
  DEFAULT_BATCH_SIZE: parseInt(process.env.SYNC_BATCH_SIZE || "50"),
  DEFAULT_CONCURRENCY: parseInt(process.env.SYNC_CONCURRENCY || "5"),
  DEFAULT_RETRY_ATTEMPTS: parseInt(process.env.SYNC_RETRY_ATTEMPTS || "3"),
  DEFAULT_RETRY_DELAY: parseInt(process.env.SYNC_RETRY_DELAY || "5000"),
  MAX_BATCH_SIZE: 250,
  MIN_BATCH_SIZE: 1,
  MAX_CONCURRENCY: 10,
} as const;

/**
 * Shopify API configuration
 */
export const SHOPIFY_CONFIG = {
  API_VERSION: "2024-10",
  GRAPHQL_COST_LIMIT: 1000,
  REST_RATE_LIMIT: 40, // requests per second
  GRAPHQL_RATE_LIMIT: 1000, // cost points per second
  WEBHOOK_VERIFY_HEADER: "X-Shopify-Hmac-Sha256",
  WEBHOOK_TOPIC_HEADER: "X-Shopify-Topic",
  WEBHOOK_SHOP_HEADER: "X-Shopify-Shop-Domain",
  WEBHOOK_ID_HEADER: "X-Shopify-Webhook-Id",
  WEBHOOK_API_VERSION_HEADER: "X-Shopify-API-Version",
} as const;

/**
 * Redis cache TTL values (in seconds)
 */
export const CACHE_TTL = {
  STORE_DATA: 3600, // 1 hour
  PRODUCT_DATA: 1800, // 30 minutes
  INVENTORY_DATA: 300, // 5 minutes
  SYNC_STATUS: 60, // 1 minute
  QUEUE_STATS: 10, // 10 seconds
  SESSION: 86400, // 24 hours
} as const;

/**
 * Redis cache key prefixes
 */
export const CACHE_KEYS = {
  STORE: "store:",
  PRODUCT: "product:",
  INVENTORY: "inventory:",
  MAPPING: "mapping:",
  SYNC_OP: "sync:",
  WEBHOOK: "webhook:",
  RATE_LIMIT: "ratelimit:",
  LOCK: "lock:",
} as const;

/**
 * Queue configuration
 */
export const QUEUE_CONFIG = {
  DEFAULT_JOB_ATTEMPTS: 3,
  DEFAULT_BACKOFF_DELAY: 5000,
  DEFAULT_BACKOFF_TYPE: "exponential",
  JOB_TIMEOUT: 60000, // 1 minute
  COMPLETED_JOB_RETENTION: 86400, // 24 hours
  FAILED_JOB_RETENTION: 604800, // 7 days
  COMPLETED_JOB_COUNT: 1000,
  FAILED_JOB_COUNT: 5000,
} as const;

/**
 * Webhook topics
 */
export const WEBHOOK_TOPICS = {
  PRODUCTS_CREATE: "products/create",
  PRODUCTS_UPDATE: "products/update",
  PRODUCTS_DELETE: "products/delete",
  INVENTORY_LEVELS_UPDATE: "inventory_levels/update",
  ORDERS_CREATE: "orders/create",
  APP_UNINSTALLED: "app/uninstalled",
} as const;

/**
 * Conflict resolution strategies
 */
export const CONFLICT_STRATEGIES = {
  USE_LOWEST: "USE_LOWEST",
  USE_HIGHEST: "USE_HIGHEST",
  USE_DATABASE: "USE_DATABASE",
  USE_STORE: "USE_STORE",
  MANUAL: "MANUAL",
  AVERAGE: "AVERAGE",
} as const;

/**
 * Sync operation types
 */
export const SYNC_OPERATIONS = {
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  PRODUCT_CREATE: "PRODUCT_CREATE",
  PRODUCT_UPDATE: "PRODUCT_UPDATE",
  PRODUCT_DELETE: "PRODUCT_DELETE",
  PRICE_UPDATE: "PRICE_UPDATE",
  VARIANT_UPDATE: "VARIANT_UPDATE",
  BULK_SYNC: "BULK_SYNC",
  INITIAL_SYNC: "INITIAL_SYNC",
} as const;

/**
 * Sync statuses
 */
export const SYNC_STATUSES = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
  CANCELLED: "CANCELLED",
} as const;

/**
 * Conflict types
 */
export const CONFLICT_TYPES = {
  INVENTORY_MISMATCH: "INVENTORY_MISMATCH",
  PRICE_MISMATCH: "PRICE_MISMATCH",
  PRODUCT_DATA_MISMATCH: "PRODUCT_DATA_MISMATCH",
  VARIANT_MISSING: "VARIANT_MISSING",
  SKU_DUPLICATE: "SKU_DUPLICATE",
  SYNC_COLLISION: "SYNC_COLLISION",
} as const;

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  STORE_NOT_FOUND: "Store not found",
  PRODUCT_NOT_FOUND: "Product not found",
  INVENTORY_NOT_FOUND: "Inventory record not found",
  MAPPING_NOT_FOUND: "Product mapping not found",
  INVALID_SKU: "Invalid SKU format",
  DUPLICATE_SKU: "SKU already exists",
  SYNC_FAILED: "Synchronization failed",
  WEBHOOK_VERIFICATION_FAILED: "Webhook verification failed",
  RATE_LIMIT_EXCEEDED: "Rate limit exceeded",
  UNAUTHORIZED: "Unauthorized access",
  INVALID_REQUEST: "Invalid request parameters",
  DATABASE_ERROR: "Database operation failed",
  QUEUE_ERROR: "Queue operation failed",
  SHOPIFY_API_ERROR: "Shopify API request failed",
} as const;

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  STORE_CONNECTED: "Store connected successfully",
  STORE_DISCONNECTED: "Store disconnected successfully",
  PRODUCT_SYNCED: "Product synced successfully",
  INVENTORY_UPDATED: "Inventory updated successfully",
  CONFLICT_RESOLVED: "Conflict resolved successfully",
  SYNC_INITIATED: "Synchronization initiated",
  WEBHOOK_PROCESSED: "Webhook processed successfully",
} as const;

/**
 * Regular expressions
 */
export const REGEX = {
  SKU: /^[A-Za-z0-9-_]+$/,
  SHOP_DOMAIN: /^[a-z0-9-]+\.myshopify\.com$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  NUMERIC_ID: /^\d+$/,
} as const;

/**
 * Pagination defaults
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

/**
 * Date/Time formats
 */
export const DATE_FORMATS = {
  ISO: "YYYY-MM-DDTHH:mm:ss.SSSZ",
  DISPLAY: "MMM DD, YYYY HH:mm",
  DATE_ONLY: "YYYY-MM-DD",
  TIME_ONLY: "HH:mm:ss",
} as const;

/**
 * Inventory thresholds
 */
export const INVENTORY_THRESHOLDS = {
  LOW_STOCK: 10,
  OUT_OF_STOCK: 0,
  HIGH_STOCK: 100,
} as const;

/**
 * Feature flags
 */
export const FEATURES = {
  REAL_TIME_SYNC: true,
  CONFLICT_AUTO_RESOLUTION: true,
  BATCH_OPERATIONS: true,
  SCHEDULED_SYNC: true,
  ANALYTICS: false, // Coming in future phase
  NOTIFICATIONS: false, // Coming in future phase
} as const;

/**
 * Environment
 */
export const ENV = {
  IS_DEVELOPMENT: process.env.NODE_ENV === "development",
  IS_PRODUCTION: process.env.NODE_ENV === "production",
  IS_TEST: process.env.NODE_ENV === "test",
} as const;

/**
 * GraphQL query limits
 */
export const GRAPHQL_LIMITS = {
  MAX_PRODUCTS_PER_QUERY: 250,
  MAX_VARIANTS_PER_QUERY: 100,
  MAX_INVENTORY_ITEMS_PER_QUERY: 100,
} as const;

/**
 * Type exports for constants
 */
export type WebhookTopic = typeof WEBHOOK_TOPICS[keyof typeof WEBHOOK_TOPICS];
export type ConflictStrategy = typeof CONFLICT_STRATEGIES[keyof typeof CONFLICT_STRATEGIES];
export type SyncOperation = typeof SYNC_OPERATIONS[keyof typeof SYNC_OPERATIONS];
export type SyncStatus = typeof SYNC_STATUSES[keyof typeof SYNC_STATUSES];
export type ConflictType = typeof CONFLICT_TYPES[keyof typeof CONFLICT_TYPES];
export type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];
