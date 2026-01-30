/**
 * Shopify Inventory Management
 *
 * GraphQL operations for Shopify inventory management:
 * - Query inventory levels
 * - Set inventory quantities
 * - Find products by SKU
 * - Manage locations
 */

import { createGraphQLClient, withRetry } from "~/shopify.server";
import { logger } from "~/lib/logger.server";
import { gidToId, idToGid } from "~/lib/helpers";
import { prisma } from "~/db.server";
import {
  INVENTORY_LEVELS_QUERY,
  INVENTORY_LEVELS_WITH_QUANTITIES_QUERY,
  INVENTORY_SET_QUANTITIES_MUTATION,
  PRODUCT_VARIANTS_BY_SKU_QUERY,
  LOCATIONS_QUERY,
  INVENTORY_ITEM_QUERY,
  type GetInventoryLevelsResponse,
  type GetInventoryLevelsWithQuantitiesResponse,
  type InventoryLevelWithQuantities,
  type InventorySetQuantitiesResponse,
  type InventorySetQuantitiesInput,
  type GetProductVariantsBySkuResponse,
  type GetLocationsResponse,
  type InventoryLevel,
  type ProductVariant,
  type Location,
} from "./graphql-queries.server";

/**
 * Get inventory levels for an inventory item
 */
export async function getInventoryLevels(
  session: { shop: string; accessToken: string },
  inventoryItemId: string
): Promise<InventoryLevel[]> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    // Ensure inventoryItemId is in GID format
    const gid = inventoryItemId.startsWith("gid://")
      ? inventoryItemId
      : idToGid(inventoryItemId, "InventoryItem");

    const response = await withRetry<GetInventoryLevelsResponse>(
      () => client.query<GetInventoryLevelsResponse>(INVENTORY_LEVELS_QUERY, {
        inventoryItemId: gid,
      })
    );

    if (!response.inventoryItem) {
      logger.warn("Inventory item not found", { inventoryItemId: gid });
      return [];
    }

    const levels = response.inventoryItem.inventoryLevels.edges.map(
      (edge) => edge.node
    );

    logger.debug("Retrieved inventory levels", {
      inventoryItemId: gid,
      levelCount: levels.length,
    });

    return levels;
  } catch (error) {
    logger.error("Failed to get inventory levels", error, {
      shop: session.shop,
      inventoryItemId,
    });
    throw error;
  }
}

/**
 * Get inventory levels with full quantity breakdown (available, committed, incoming)
 * for a single inventory item. Used during catalog sync for per-location data.
 */
export async function getInventoryLevelsWithQuantities(
  session: { shop: string; accessToken: string },
  inventoryItemId: string
): Promise<InventoryLevelWithQuantities[]> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    const gid = inventoryItemId.startsWith("gid://")
      ? inventoryItemId
      : idToGid(inventoryItemId, "InventoryItem");

    const response = await withRetry<GetInventoryLevelsWithQuantitiesResponse>(
      () => client.query<GetInventoryLevelsWithQuantitiesResponse>(
        INVENTORY_LEVELS_WITH_QUANTITIES_QUERY,
        { inventoryItemId: gid }
      )
    );

    if (!response.inventoryItem) {
      logger.warn("Inventory item not found for quantities query", { inventoryItemId: gid });
      return [];
    }

    return response.inventoryItem.inventoryLevels.edges.map((edge) => edge.node);
  } catch (error) {
    logger.error("Failed to get inventory levels with quantities", error, {
      shop: session.shop,
      inventoryItemId,
    });
    throw error;
  }
}

/**
 * Set inventory quantities using inventorySetQuantities mutation
 */
export async function setInventoryQuantities(
  session: { shop: string; accessToken: string },
  input: InventorySetQuantitiesInput
): Promise<InventorySetQuantitiesResponse["inventorySetQuantities"]> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    // Convert all IDs to GID format
    const formattedInput = {
      ...input,
      quantities: input.quantities.map((q) => ({
        inventoryItemId: q.inventoryItemId.startsWith("gid://")
          ? q.inventoryItemId
          : idToGid(q.inventoryItemId, "InventoryItem"),
        locationId: q.locationId.startsWith("gid://")
          ? q.locationId
          : idToGid(q.locationId, "Location"),
        quantity: q.quantity,
      })),
    };

    const response = await withRetry<InventorySetQuantitiesResponse>(
      () => client.query<InventorySetQuantitiesResponse>(
        INVENTORY_SET_QUANTITIES_MUTATION,
        { input: formattedInput }
      ),
      3,
      2000 // Rate limit friendly
    );

    const result = response.inventorySetQuantities;

    if (result.userErrors && result.userErrors.length > 0) {
      const errors = result.userErrors.map((e) => e.message).join(", ");
      throw new Error(`Inventory update failed: ${errors}`);
    }

    logger.info("Inventory quantities updated", {
      shop: session.shop,
      reason: input.reason,
      quantityCount: input.quantities.length,
      adjustmentGroupId: result.inventoryAdjustmentGroup?.id,
    });

    return result;
  } catch (error) {
    logger.error("Failed to set inventory quantities", error, {
      shop: session.shop,
      input,
    });
    throw error;
  }
}

/**
 * Find product variants by SKU
 */
export async function getProductVariantsBySku(
  session: { shop: string; accessToken: string },
  sku: string
): Promise<ProductVariant[]> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    // Format SKU query for Shopify search
    const skuQuery = `sku:${sku}`;

    const response = await withRetry<GetProductVariantsBySkuResponse>(
      () => client.query<GetProductVariantsBySkuResponse>(
        PRODUCT_VARIANTS_BY_SKU_QUERY,
        { sku: skuQuery }
      )
    );

    const variants = response.productVariants.edges.map((edge) => edge.node);

    logger.debug("Found product variants by SKU", {
      sku,
      variantCount: variants.length,
    });

    return variants;
  } catch (error) {
    logger.error("Failed to get product variants by SKU", error, {
      shop: session.shop,
      sku,
    });
    throw error;
  }
}

/**
 * Get all location IDs for a store
 */
export async function getLocationIds(
  session: { shop: string; accessToken: string }
): Promise<Location[]> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    const response = await withRetry<GetLocationsResponse>(
      () => client.query<GetLocationsResponse>(LOCATIONS_QUERY, { first: 50 })
    );

    const locations = response.locations.edges.map((edge) => edge.node);

    // Filter to only active locations
    const activeLocations = locations.filter((loc) => loc.isActive);

    logger.debug("Retrieved store locations", {
      shop: session.shop,
      totalLocations: locations.length,
      activeLocations: activeLocations.length,
    });

    return activeLocations;
  } catch (error: any) {
    // Check if error is related to missing access scope
    const errorMessage = error?.message || String(error);
    const graphqlErrors = error?.graphqlErrors || [];
    
    // Check both error message and GraphQL errors array
    // According to Shopify docs, access scope errors can appear in:
    // 1. error.message containing "read_locations", "read_markets_home", "access scope", "requiredAccess"
    // 2. graphqlErrors[].message containing scope-related text
    // 3. graphqlErrors[].extensions.code === "ACCESS_DENIED"
    // 4. graphqlErrors[].extensions.requiredAccess containing scope info
    // 5. graphqlErrors[].extensions.requiredAccess as a string or object
    const isAccessScopeError = 
      errorMessage.includes("read_locations") ||
      errorMessage.includes("read_markets_home") ||
      errorMessage.includes("access scope") ||
      errorMessage.includes("requiredAccess") ||
      errorMessage.includes("ACCESS_DENIED") ||
      graphqlErrors.some((err: any) => {
        const errMsg = err?.message || "";
        const extensions = err?.extensions || {};
        
        return (
          errMsg.includes("read_locations") ||
          errMsg.includes("read_markets_home") ||
          errMsg.includes("access scope") ||
          errMsg.includes("requiredAccess") ||
          extensions.code === "ACCESS_DENIED" ||
          extensions.requiredAccess !== undefined ||
          (typeof extensions.requiredAccess === "string" && 
           (extensions.requiredAccess.includes("read_locations") || 
            extensions.requiredAccess.includes("read_markets_home")))
        );
      });

    if (isAccessScopeError) {
      logger.warn("Cannot access locations - missing required scope. App needs 'read_locations' scope (requires 'read_inventory' or 'write_inventory'). Please reinstall the app or use scope expansion API to grant the required permissions.", {
        shop: session.shop,
        error: errorMessage,
        graphqlErrors,
        hint: "For existing installations, use request_granular_access_scopes endpoint to add read_locations scope",
      });
      // Return empty array instead of throwing - allows sync to continue without per-location inventory
      return [];
    }

    logger.error("Failed to get location IDs", error, {
      shop: session.shop,
    });
    throw error;
  }
}

/**
 * Get primary location for a store.
 * Checks the DB first (store_locations); falls back to the Shopify API.
 */
export async function getPrimaryLocation(
  session: { shop: string; accessToken: string },
  storeId?: string
): Promise<Location | null> {
  // Try DB first when storeId is available
  if (storeId) {
    const dbLocation = await prisma.storeLocation.findFirst({
      where: { storeId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (dbLocation) {
      return {
        id: dbLocation.shopifyLocationId,
        name: dbLocation.name,
        isActive: dbLocation.isActive,
        address: {
          address1: dbLocation.address1 ?? undefined,
          city: dbLocation.city ?? undefined,
          province: dbLocation.province ?? undefined,
          country: dbLocation.country ?? undefined,
        },
      };
    }
  }

  // Fallback to API
  const locations = await getLocationIds(session);
  return locations.length > 0 ? locations[0] : null;
}

/**
 * Fetch all locations from Shopify and upsert into store_locations table.
 * Returns the upserted StoreLocation records.
 */
export async function syncStoreLocations(
  session: { shop: string; accessToken: string },
  storeId: string
): Promise<any[]> {
  try {
    console.log("[syncStoreLocations] Fetching locations for", session.shop, "storeId:", storeId);
    const locations = await getLocationIds(session);
    console.log("[syncStoreLocations] Got locations from API:", locations.length, JSON.stringify(locations.map(l => ({ id: l.id, name: l.name }))));

    const upserted = [];
    for (const loc of locations) {
      console.log("[syncStoreLocations] Upserting location:", loc.id, loc.name);
      const record = await prisma.storeLocation.upsert({
        where: {
          storeId_shopifyLocationId: {
            storeId,
            shopifyLocationId: loc.id,
          },
        },
        create: {
          storeId,
          shopifyLocationId: loc.id,
          name: loc.name,
          isActive: loc.isActive,
          address1: loc.address?.address1 ?? null,
          city: loc.address?.city ?? null,
          province: loc.address?.province ?? null,
          country: loc.address?.country ?? null,
        },
        update: {
          name: loc.name,
          isActive: loc.isActive,
          address1: loc.address?.address1 ?? null,
          city: loc.address?.city ?? null,
          province: loc.address?.province ?? null,
          country: loc.address?.country ?? null,
        },
      });
      upserted.push(record);
    }

    logger.info("Store locations synced", {
      shop: session.shop,
      storeId,
      locationCount: upserted.length,
    });

    return upserted;
  } catch (error) {
    logger.error("Failed to sync store locations", error, {
      shop: session.shop,
      storeId,
    });
    throw error;
  }
}

/**
 * Find or create a StoreLocation from a Shopify location ID (numeric REST ID).
 * Converts the REST numeric ID to GID format for storage.
 * If not found in DB, fetches from Shopify API and creates the record.
 */
export async function getOrCreateLocation(
  session: { shop: string; accessToken: string },
  storeId: string,
  shopifyLocationId: string | number
): Promise<any> {
  const locationGid = typeof shopifyLocationId === "string" && shopifyLocationId.startsWith("gid://")
    ? shopifyLocationId
    : idToGid(shopifyLocationId, "Location");

  // Check DB first
  const existing = await prisma.storeLocation.findUnique({
    where: {
      storeId_shopifyLocationId: {
        storeId,
        shopifyLocationId: locationGid,
      },
    },
  });

  if (existing) {
    return existing;
  }

  // Not found — fetch all locations from Shopify and sync
  const locations = await syncStoreLocations(session, storeId);
  const match = locations.find((l: any) => l.shopifyLocationId === locationGid);

  if (match) {
    return match;
  }

  // Still not found — create a placeholder
  logger.warn("Location not found in Shopify, creating placeholder", {
    storeId,
    shopifyLocationId: locationGid,
  });

  const placeholder = await prisma.storeLocation.create({
    data: {
      storeId,
      shopifyLocationId: locationGid,
      name: `Location ${gidToId(locationGid)}`,
      isActive: true,
    },
  });

  return placeholder;
}

/**
 * Get inventory item details
 */
export async function getInventoryItem(
  session: { shop: string; accessToken: string },
  inventoryItemId: string
): Promise<any> {
  try {
    const client = createGraphQLClient(session.shop, session.accessToken);

    const gid = inventoryItemId.startsWith("gid://")
      ? inventoryItemId
      : idToGid(inventoryItemId, "InventoryItem");

    const response = await withRetry(
      () => client.query(INVENTORY_ITEM_QUERY, { id: gid })
    );

    return response.inventoryItem;
  } catch (error) {
    logger.error("Failed to get inventory item", error, {
      shop: session.shop,
      inventoryItemId,
    });
    throw error;
  }
}

/**
 * Update inventory for a single item at a location
 */
export async function updateInventoryLevel(
  session: { shop: string; accessToken: string },
  inventoryItemId: string,
  locationId: string,
  quantity: number,
  reason: string
): Promise<void> {
  const input: InventorySetQuantitiesInput = {
    reason,
    name: `Sync from central inventory`,
    quantities: [
      {
        inventoryItemId,
        locationId,
        quantity,
      },
    ],
  };

  await setInventoryQuantities(session, input);
}

/**
 * Batch update inventory for multiple items
 */
export async function batchUpdateInventory(
  session: { shop: string; accessToken: string },
  updates: Array<{
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  }>,
  reason: string
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  // Shopify supports up to 100 quantities per mutation
  const BATCH_SIZE = 100;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    const input: InventorySetQuantitiesInput = {
      reason,
      name: `Batch sync from central inventory`,
      quantities: batch,
    };

    await setInventoryQuantities(session, input);

    // Small delay to respect rate limits
    if (i + BATCH_SIZE < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  logger.info("Batch inventory update completed", {
    shop: session.shop,
    totalUpdates: updates.length,
    batches: Math.ceil(updates.length / BATCH_SIZE),
  });
}

/**
 * Helper to extract numeric ID from GID
 */
export function extractId(gid: string): string {
  return gidToId(gid);
}

/**
 * Helper to format GID
 */
export function formatGid(id: string | number, resource: string): string {
  return idToGid(id, resource);
}

export default {
  getInventoryLevels,
  getInventoryLevelsWithQuantities,
  setInventoryQuantities,
  getProductVariantsBySku,
  getLocationIds,
  getPrimaryLocation,
  syncStoreLocations,
  getOrCreateLocation,
  getInventoryItem,
  updateInventoryLevel,
  batchUpdateInventory,
  extractId,
  formatGid,
};
