/**
 * Validation Utilities
 *
 * Provides validation functions for common data types and business logic
 */

import { REGEX } from "./constants";
import type { ConflictResolutionStrategy } from "@prisma/client";

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Create validation result
 */
function createValidationResult(
  isValid: boolean,
  errors: string[] = []
): ValidationResult {
  return { isValid, errors };
}

/**
 * SKU validation
 */
export function validateSKU(sku: string): ValidationResult {
  const errors: string[] = [];

  if (!sku || typeof sku !== "string") {
    errors.push("SKU is required and must be a string");
  } else {
    if (sku.length < 1 || sku.length > 100) {
      errors.push("SKU must be between 1 and 100 characters");
    }

    if (!REGEX.SKU.test(sku)) {
      errors.push("SKU can only contain letters, numbers, hyphens, and underscores");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Shop domain validation
 */
export function validateShopDomain(domain: string): ValidationResult {
  const errors: string[] = [];

  if (!domain || typeof domain !== "string") {
    errors.push("Shop domain is required and must be a string");
  } else {
    if (!REGEX.SHOP_DOMAIN.test(domain)) {
      errors.push("Shop domain must be in format: storename.myshopify.com");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Email validation
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];

  if (!email || typeof email !== "string") {
    errors.push("Email is required and must be a string");
  } else {
    if (!REGEX.EMAIL.test(email)) {
      errors.push("Email format is invalid");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Quantity validation
 */
export function validateQuantity(quantity: number): ValidationResult {
  const errors: string[] = [];

  if (typeof quantity !== "number") {
    errors.push("Quantity must be a number");
  } else {
    if (!Number.isInteger(quantity)) {
      errors.push("Quantity must be an integer");
    }

    if (quantity < 0) {
      errors.push("Quantity cannot be negative");
    }

    if (quantity > 1000000) {
      errors.push("Quantity exceeds maximum allowed value");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Price validation
 */
export function validatePrice(price: number): ValidationResult {
  const errors: string[] = [];

  if (typeof price !== "number") {
    errors.push("Price must be a number");
  } else {
    if (price < 0) {
      errors.push("Price cannot be negative");
    }

    if (price > 1000000) {
      errors.push("Price exceeds maximum allowed value");
    }

    // Check for max 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(price.toString())) {
      errors.push("Price can have at most 2 decimal places");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Product data validation
 */
export interface ProductData {
  sku: string;
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
}

export function validateProductData(data: ProductData): ValidationResult {
  const errors: string[] = [];

  // Validate SKU
  const skuValidation = validateSKU(data.sku);
  if (!skuValidation.isValid) {
    errors.push(...skuValidation.errors);
  }

  // Validate title
  if (!data.title || typeof data.title !== "string") {
    errors.push("Title is required and must be a string");
  } else if (data.title.length < 1 || data.title.length > 255) {
    errors.push("Title must be between 1 and 255 characters");
  }

  // Validate description (optional)
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== "string") {
      errors.push("Description must be a string");
    } else if (data.description.length > 5000) {
      errors.push("Description cannot exceed 5000 characters");
    }
  }

  // Validate vendor (optional)
  if (data.vendor !== undefined && data.vendor !== null) {
    if (typeof data.vendor !== "string") {
      errors.push("Vendor must be a string");
    } else if (data.vendor.length > 255) {
      errors.push("Vendor cannot exceed 255 characters");
    }
  }

  // Validate product type (optional)
  if (data.productType !== undefined && data.productType !== null) {
    if (typeof data.productType !== "string") {
      errors.push("Product type must be a string");
    } else if (data.productType.length > 255) {
      errors.push("Product type cannot exceed 255 characters");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Inventory data validation
 */
export interface InventoryData {
  availableQuantity: number;
  committedQuantity?: number;
  incomingQuantity?: number;
  lowStockThreshold?: number;
}

export function validateInventoryData(data: InventoryData): ValidationResult {
  const errors: string[] = [];

  // Validate available quantity
  const availableValidation = validateQuantity(data.availableQuantity);
  if (!availableValidation.isValid) {
    errors.push(...availableValidation.errors.map(e => `Available quantity: ${e}`));
  }

  // Validate committed quantity (optional)
  if (data.committedQuantity !== undefined) {
    const committedValidation = validateQuantity(data.committedQuantity);
    if (!committedValidation.isValid) {
      errors.push(...committedValidation.errors.map(e => `Committed quantity: ${e}`));
    }
  }

  // Validate incoming quantity (optional)
  if (data.incomingQuantity !== undefined) {
    const incomingValidation = validateQuantity(data.incomingQuantity);
    if (!incomingValidation.isValid) {
      errors.push(...incomingValidation.errors.map(e => `Incoming quantity: ${e}`));
    }
  }

  // Validate low stock threshold (optional)
  if (data.lowStockThreshold !== undefined) {
    const thresholdValidation = validateQuantity(data.lowStockThreshold);
    if (!thresholdValidation.isValid) {
      errors.push(...thresholdValidation.errors.map(e => `Low stock threshold: ${e}`));
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Store configuration validation
 */
export interface StoreConfigData {
  shopDomain: string;
  syncEnabled: boolean;
  autoSyncInterval?: number;
  conflictResolution?: ConflictResolutionStrategy;
}

export function validateStoreConfig(data: StoreConfigData): ValidationResult {
  const errors: string[] = [];

  // Validate shop domain
  const domainValidation = validateShopDomain(data.shopDomain);
  if (!domainValidation.isValid) {
    errors.push(...domainValidation.errors);
  }

  // Validate sync enabled
  if (typeof data.syncEnabled !== "boolean") {
    errors.push("Sync enabled must be a boolean");
  }

  // Validate auto sync interval (optional)
  if (data.autoSyncInterval !== undefined) {
    if (typeof data.autoSyncInterval !== "number") {
      errors.push("Auto sync interval must be a number");
    } else if (data.autoSyncInterval < 60 || data.autoSyncInterval > 86400) {
      errors.push("Auto sync interval must be between 60 and 86400 seconds");
    }
  }

  // Validate conflict resolution (optional)
  if (data.conflictResolution !== undefined) {
    const validStrategies = [
      "USE_LOWEST",
      "USE_HIGHEST",
      "USE_DATABASE",
      "USE_STORE",
      "MANUAL",
      "AVERAGE",
    ];
    if (!validStrategies.includes(data.conflictResolution)) {
      errors.push(`Invalid conflict resolution strategy: ${data.conflictResolution}`);
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Pagination validation
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export function validatePagination(params: PaginationParams): ValidationResult {
  const errors: string[] = [];

  if (params.page !== undefined) {
    if (typeof params.page !== "number" || !Number.isInteger(params.page)) {
      errors.push("Page must be an integer");
    } else if (params.page < 1) {
      errors.push("Page must be greater than 0");
    }
  }

  if (params.pageSize !== undefined) {
    if (typeof params.pageSize !== "number" || !Number.isInteger(params.pageSize)) {
      errors.push("Page size must be an integer");
    } else if (params.pageSize < 1 || params.pageSize > 100) {
      errors.push("Page size must be between 1 and 100");
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Webhook payload validation
 */
export function validateWebhookPayload(payload: any): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object") {
    errors.push("Webhook payload must be an object");
    return createValidationResult(false, errors);
  }

  // Basic structure validation - can be extended based on specific webhook types
  if (payload.id === undefined) {
    errors.push("Webhook payload must contain an id field");
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Shopify ID validation (numeric ID or GID format)
 */
export function validateShopifyId(id: string | number): ValidationResult {
  const errors: string[] = [];

  if (typeof id === "number") {
    if (!Number.isInteger(id) || id <= 0) {
      errors.push("Shopify ID must be a positive integer");
    }
  } else if (typeof id === "string") {
    // Check if it's a numeric string or GID format
    const isNumeric = REGEX.NUMERIC_ID.test(id);
    const isGID = id.startsWith("gid://shopify/");

    if (!isNumeric && !isGID) {
      errors.push("Shopify ID must be numeric or in GID format (gid://shopify/...)");
    }
  } else {
    errors.push("Shopify ID must be a string or number");
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Batch size validation
 */
export function validateBatchSize(size: number): ValidationResult {
  const errors: string[] = [];

  if (typeof size !== "number" || !Number.isInteger(size)) {
    errors.push("Batch size must be an integer");
  } else if (size < 1 || size > 250) {
    errors.push("Batch size must be between 1 and 250");
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Generic required field validation
 */
export function validateRequiredFields<T extends Record<string, any>>(
  data: T,
  requiredFields: (keyof T)[]
): ValidationResult {
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      errors.push(`Field '${String(field)}' is required`);
    }
  }

  return createValidationResult(errors.length === 0, errors);
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string, maxLength?: number): string {
  let sanitized = input.trim();

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, "");

  // Limit length if specified
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitize SKU
 */
export function sanitizeSKU(sku: string): string {
  return sku
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, "");
}

export default {
  validateSKU,
  validateShopDomain,
  validateEmail,
  validateQuantity,
  validatePrice,
  validateProductData,
  validateInventoryData,
  validateStoreConfig,
  validatePagination,
  validateWebhookPayload,
  validateShopifyId,
  validateBatchSize,
  validateRequiredFields,
  sanitizeString,
  sanitizeSKU,
};
