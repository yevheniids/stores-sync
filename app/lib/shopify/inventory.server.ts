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
import {
  INVENTORY_LEVELS_QUERY,
  INVENTORY_SET_QUANTITIES_MUTATION,
  PRODUCT_VARIANTS_BY_SKU_QUERY,
  LOCATIONS_QUERY,
  INVENTORY_ITEM_QUERY,
  type GetInventoryLevelsResponse,
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
  } catch (error) {
    logger.error("Failed to get location IDs", error, {
      shop: session.shop,
    });
    throw error;
  }
}

/**
 * Get primary location for a store (first active location)
 */
export async function getPrimaryLocation(
  session: { shop: string; accessToken: string }
): Promise<Location | null> {
  const locations = await getLocationIds(session);
  return locations.length > 0 ? locations[0] : null;
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
  setInventoryQuantities,
  getProductVariantsBySku,
  getLocationIds,
  getPrimaryLocation,
  getInventoryItem,
  updateInventoryLevel,
  batchUpdateInventory,
  extractId,
  formatGid,
};
