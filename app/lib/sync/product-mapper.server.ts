/**
 * Product Mapper
 *
 * SKU-based product mapping between stores
 * Manages the central product registry and store-specific mappings
 */

import { prisma, executeTransaction } from "~/db.server";
import { logger } from "~/lib/logger.server";
import { gidToId } from "~/lib/helpers";
import type { Product, ProductStoreMapping, Store } from "@prisma/client";
import type { ProductWithRelations } from "~/types";
import { getProductVariantsBySku, syncStoreLocations, getOrCreateLocation } from "~/lib/shopify/inventory.server";
import { unifiedInventoryUpdate, recalculateAggregateInventory } from "~/lib/db/inventory-queries.server";
import { sessionStorage as storage } from "~/shopify.server";

/**
 * Store variant information for mapping
 */
export interface StoreVariant {
  storeId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  shopifyInventoryItemId: string;
  price?: number;
  compareAtPrice?: number;
  barcode?: string;
}

/**
 * Map a product to stores by creating/updating mappings
 */
export async function mapProductToStores(
  sku: string,
  storeVariants: StoreVariant[]
): Promise<ProductStoreMapping[]> {
  try {
    return await executeTransaction(async (tx) => {
      // Find or create central product
      let product = await tx.product.findUnique({
        where: { sku },
      });

      if (!product) {
        logger.warn("Product not found for mapping, creating placeholder", { sku });
        product = await tx.product.create({
          data: {
            sku,
            title: `Product ${sku}`,
            tracksInventory: true,
            inventoryPolicy: "DENY",
          },
        });
      }

      // Create or update mappings for each store
      const mappings: ProductStoreMapping[] = [];

      for (const variant of storeVariants) {
        const mapping = await tx.productStoreMapping.upsert({
          where: {
            productId_storeId: {
              productId: product.id,
              storeId: variant.storeId,
            },
          },
          create: {
            productId: product.id,
            storeId: variant.storeId,
            shopifyProductId: variant.shopifyProductId,
            shopifyVariantId: variant.shopifyVariantId,
            shopifyInventoryItemId: variant.shopifyInventoryItemId,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            barcode: variant.barcode,
            storeSku: sku,
            syncStatus: "PENDING",
          },
          update: {
            shopifyProductId: variant.shopifyProductId,
            shopifyVariantId: variant.shopifyVariantId,
            shopifyInventoryItemId: variant.shopifyInventoryItemId,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            barcode: variant.barcode,
            lastSyncedAt: new Date(),
          },
        });

        mappings.push(mapping);
      }

      logger.info("Product mapped to stores", {
        sku,
        productId: product.id,
        storeCount: mappings.length,
      });

      return mappings;
    });
  } catch (error) {
    logger.error("Failed to map product to stores", error, { sku, storeVariants });
    throw error;
  }
}

/**
 * Get store mapping for a specific product and store
 */
export async function getStoreMapping(
  sku: string,
  shopDomain: string
): Promise<(ProductStoreMapping & { product: Product; store: Store }) | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { sku },
    });

    if (!product) {
      return null;
    }

    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) {
      return null;
    }

    const mapping = await prisma.productStoreMapping.findUnique({
      where: {
        productId_storeId: {
          productId: product.id,
          storeId: store.id,
        },
      },
      include: {
        product: true,
        store: true,
      },
    });

    return mapping;
  } catch (error) {
    logger.error("Failed to get store mapping", error, { sku, shopDomain });
    throw error;
  }
}

/**
 * Get all store mappings for a product
 */
export async function getAllMappings(
  sku: string
): Promise<(ProductStoreMapping & { store: Store })[]> {
  try {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: {
        storeMappings: {
          include: {
            store: true,
          },
        },
      },
    });

    if (!product) {
      return [];
    }

    return product.storeMappings;
  } catch (error) {
    logger.error("Failed to get all mappings", error, { sku });
    throw error;
  }
}

/**
 * Sync product catalog from a store
 * Discovers products and creates mappings
 */
export async function syncProductCatalog(
  shopDomain: string,
  options?: {
    /** Raw access token override (e.g. from adminSession.accessToken). Prefer token over request-bound client for serverless. */
    accessToken?: string;
  }
): Promise<{
  total: number;
  created: number;
  updated: number;
  errors: number;
  createdSkus: string[];
  updatedSkus: string[];
  /** Set when sync could not run (e.g. 401); caller should record FAILED. */
  errorMessage?: string;
}> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) {
      throw new Error(`Store not found: ${shopDomain}`);
    }

    // Resolve a real access token first. On serverless (e.g. Vercel), request-bound
    // admin.graphql() can yield 401 or "Missing access token"; using a stored token
    // with createGraphQLClient is reliable.
    let accessToken: string;
    let tokenSource: string;

    let resolvedToken: string | undefined = options?.accessToken;
    tokenSource = resolvedToken ? "override" : "";

    if (!resolvedToken) {
      const sessionId = `offline_${shopDomain}`;
      const session = await storage.loadSession(sessionId);
      if (session?.accessToken) {
        resolvedToken = session.accessToken;
        tokenSource = "offline_session";
      }
    }

    if (!resolvedToken && store.accessToken) {
      resolvedToken = store.accessToken;
      tokenSource = tokenSource || "store_record";
    }

    if (!resolvedToken) {
      throw new Error(
        `No access token found for store: ${shopDomain}. ` +
        `The store merchant must open the app at least once to generate a valid token.`
      );
    }

    accessToken = resolvedToken;
    const { createGraphQLClient } = await import("~/shopify.server");
    const client = createGraphQLClient(shopDomain, accessToken);

    console.log(`[SYNC] Starting catalog sync for ${shopDomain}, tokenSource=${tokenSource}, tokenPrefix=${accessToken.substring(0, 10)}...`);
    logger.info("Starting product catalog sync", {
      shopDomain,
      tokenSource,
      hasAccessToken: true,
      accessTokenPrefix: accessToken.substring(0, 8) + "...",
    });

    // Sync store locations and build lookup map for per-location inventory
    const locationLookup = new Map<string, string>();
    try {
      const storeLocations = await syncStoreLocations(
        { shop: shopDomain, accessToken },
        store.id
      );
      for (const loc of storeLocations) {
        locationLookup.set(loc.shopifyLocationId, loc.id);
      }
      console.log(`[SYNC] Locations synced: ${locationLookup.size}`);
    } catch (locErr: any) {
      // Non-fatal: locations will be created on-demand below
      console.log(`[SYNC] Location sync failed (non-fatal): ${locErr instanceof Error ? locErr.message : locErr}`);
    }

    let created = 0;
    let updated = 0;
    let errors = 0;
    let total = 0;
    const createdSkus: string[] = [];
    const updatedSkus: string[] = [];

    let hasNextPage = true;
    let cursor: string | undefined;

    const PRODUCTS_QUERY = `
      query GetProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              title
              vendor
              productType
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    price
                    compareAtPrice
                    barcode
                    inventoryItem {
                      id
                      tracked
                      inventoryLevels(first: 5) {
                        edges {
                          node {
                            location { id }
                            quantities(names: ["available", "committed", "incoming"]) {
                              name
                              quantity
                            }
                          }
                        }
                      }
                    }
                    inventoryPolicy
                    inventoryQuantity
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const variables: Record<string, unknown> = { first: 25 };
      if (cursor) variables.after = cursor;

      let response: any;
      try {
        response = await client.query(PRODUCTS_QUERY, variables);
      } catch (err: any) {
        const isAuthError = err?.status === 401 || (err?.message && String(err.message).includes("Access token expired or invalid"));
        if (isAuthError) {
          logger.warn("Store token expired or invalid; skipping product sync. Open the app from this store to re-authenticate.", {
            shopDomain,
          });
          return {
            total: 0,
            created: 0,
            updated: 0,
            errors: 1,
            createdSkus: [],
            updatedSkus: [],
            errorMessage: err?.message ?? "Access token expired or invalid. Open the app from this store in Shopify Admin to re-authenticate.",
          };
        }
        logger.error("GraphQL products query failed", err, { shopDomain });
        throw new Error(
          `GraphQL query failed for ${shopDomain}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const products = response.products.edges.map((e: any) => e.node);
      hasNextPage = response.products.pageInfo.hasNextPage;
      cursor = response.products.pageInfo.endCursor;

      console.log(`[SYNC] Got ${products.length} products from Shopify (hasNextPage=${hasNextPage})`);

      for (const shopifyProduct of products) {
        total++;
        const variantSkus = shopifyProduct.variants.edges.map((e: any) => e.node.sku).filter(Boolean);
        console.log(`[SYNC] Product "${shopifyProduct.title}" — ${shopifyProduct.variants.edges.length} variants, SKUs: [${variantSkus.join(", ")}]`);

        for (const variantEdge of shopifyProduct.variants.edges) {
          const variant = variantEdge.node;
          if (!variant.sku) continue;

          try {
            const product = await prisma.product.upsert({
              where: { sku: variant.sku },
              create: {
                sku: variant.sku,
                title: shopifyProduct.title,
                vendor: shopifyProduct.vendor || undefined,
                productType: shopifyProduct.productType || undefined,
                inventoryPolicy: variant.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY",
                tracksInventory: variant.inventoryItem.tracked,
              },
              update: {
                title: shopifyProduct.title,
                vendor: shopifyProduct.vendor || undefined,
                productType: shopifyProduct.productType || undefined,
              },
            });

            const existing = await prisma.productStoreMapping.findUnique({
              where: { productId_storeId: { productId: product.id, storeId: store.id } },
            });

            await prisma.productStoreMapping.upsert({
              where: { productId_storeId: { productId: product.id, storeId: store.id } },
              create: {
                productId: product.id,
                storeId: store.id,
                shopifyProductId: shopifyProduct.id,
                shopifyVariantId: variant.id,
                shopifyInventoryItemId: variant.inventoryItem.id,
                price: variant.price ? parseFloat(variant.price) : undefined,
                compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : undefined,
                storeSku: variant.sku,
                barcode: variant.barcode || undefined,
                syncStatus: "COMPLETED",
                lastSyncedAt: new Date(),
              },
              update: {
                shopifyProductId: shopifyProduct.id,
                shopifyVariantId: variant.id,
                shopifyInventoryItemId: variant.inventoryItem.id,
                price: variant.price ? parseFloat(variant.price) : undefined,
                compareAtPrice: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : undefined,
                barcode: variant.barcode || undefined,
                lastSyncedAt: new Date(),
              },
            });

            // Write per-location inventory from the inline GraphQL data (no extra API calls).
            if (variant.inventoryItem.tracked) {
              const levels = variant.inventoryItem.inventoryLevels?.edges || [];

              for (const levelEdge of levels) {
                const level = levelEdge.node;
                const locationGid = level.location.id;
                let storeLocationId = locationLookup.get(locationGid);

                if (!storeLocationId) {
                  try {
                    const storeLocation = await getOrCreateLocation(
                      { shop: shopDomain, accessToken },
                      store.id,
                      locationGid
                    );
                    if (storeLocation?.id) {
                      storeLocationId = storeLocation.id;
                      locationLookup.set(locationGid, storeLocation.id);
                    }
                  } catch {
                    // skip this level if location can't be resolved
                    continue;
                  }
                }

                if (!storeLocationId) continue;

                const quantities = level.quantities || [];
                const available = quantities.find((q: any) => q.name === "available")?.quantity ?? 0;
                const committed = quantities.find((q: any) => q.name === "committed")?.quantity ?? 0;
                const incoming = quantities.find((q: any) => q.name === "incoming")?.quantity ?? 0;

                await unifiedInventoryUpdate({
                  sku: variant.sku,
                  productId: product.id,
                  adjustedBy: "catalog-sync",
                  absolute: {
                    availableQuantity: available,
                    committedQuantity: committed,
                    incomingQuantity: incoming,
                    storeLocationId,
                    skipRecalculation: true, // batch: recalculate once after loop
                  },
                });
              }

              // Recalculate aggregate from location rows, or use inventoryQuantity as fallback
              if (levels.length > 0) {
                await recalculateAggregateInventory(product.id);
              } else {
                await unifiedInventoryUpdate({
                  sku: variant.sku,
                  productId: product.id,
                  adjustedBy: "catalog-sync",
                  setAggregate: {
                    availableQuantity: variant.inventoryQuantity || 0,
                    committedQuantity: 0,
                    incomingQuantity: 0,
                  },
                });
              }
            }

            if (existing) {
              updated++;
              updatedSkus.push(variant.sku);
              console.log(`[SYNC] Updated SKU=${variant.sku} productId=${product.id} qty=${variant.inventoryQuantity}`);
            } else {
              created++;
              createdSkus.push(variant.sku);
              console.log(`[SYNC] Created SKU=${variant.sku} productId=${product.id} qty=${variant.inventoryQuantity}`);
            }
          } catch (err) {
            errors++;
            console.error(`[SYNC] FAILED SKU=${variant.sku}:`, err instanceof Error ? err.message : err);
            logger.error("Failed to sync product variant", err, {
              shopDomain,
              sku: variant.sku,
            });
          }
        }
      }

      // Rate limit delay between pages
      if (hasNextPage) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const stats = { total, created, updated, errors, createdSkus, updatedSkus };
    console.log(`[SYNC] DONE ${shopDomain}: total=${total} created=${created} updated=${updated} errors=${errors}`);
    logger.info("Product catalog sync completed", { shopDomain, total, created, updated, errors });
    return stats;
  } catch (error) {
    logger.error("Failed to sync product catalog", error, { shopDomain });
    throw error;
  }
}

/**
 * Find product by SKU in central registry
 */
export async function findProductBySku(sku: string): Promise<ProductWithRelations | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { sku },
      include: {
        inventory: true,
        storeMappings: {
          include: {
            store: true,
          },
        },
      },
    });

    return product;
  } catch (error) {
    logger.error("Failed to find product by SKU", error, { sku });
    throw error;
  }
}

/**
 * Create or update product in central registry
 */
export async function createOrUpdateProduct(data: {
  sku: string;
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  imageUrl?: string;
  weight?: number;
  weightUnit?: string;
  inventoryPolicy?: "DENY" | "CONTINUE";
  tracksInventory?: boolean;
}): Promise<Product> {
  try {
    const product = await prisma.product.upsert({
      where: { sku: data.sku },
      create: {
        sku: data.sku,
        title: data.title,
        description: data.description,
        vendor: data.vendor,
        productType: data.productType,
        tags: data.tags || [],
        imageUrl: data.imageUrl,
        weight: data.weight,
        weightUnit: data.weightUnit || "g",
        inventoryPolicy: data.inventoryPolicy || "DENY",
        tracksInventory: data.tracksInventory !== false,
      },
      update: {
        title: data.title,
        description: data.description,
        vendor: data.vendor,
        productType: data.productType,
        tags: data.tags,
        imageUrl: data.imageUrl,
        weight: data.weight,
        weightUnit: data.weightUnit,
        inventoryPolicy: data.inventoryPolicy,
        tracksInventory: data.tracksInventory,
      },
    });

    logger.database("upsert", "product", {
      sku: product.sku,
      id: product.id,
    });

    return product;
  } catch (error) {
    logger.error("Failed to create or update product", error, data);
    throw error;
  }
}

/**
 * Discover and map a product from a store by SKU
 */
export async function discoverAndMapProduct(
  shopDomain: string,
  sku: string
): Promise<ProductStoreMapping | null> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!store) {
      throw new Error(`Store not found: ${shopDomain}`);
    }

    // Resolve access token: offline session > Store.accessToken
    let accessToken: string | undefined;
    const sessionId = `offline_${shopDomain}`;
    const session = await storage.loadSession(sessionId);
    if (session?.accessToken) {
      accessToken = session.accessToken;
    } else if (store.accessToken) {
      accessToken = store.accessToken;
    }

    if (!accessToken) {
      throw new Error(`No access token found for store: ${shopDomain}`);
    }

    // Find variant in Shopify by SKU
    const variants = await getProductVariantsBySku(
      { shop: shopDomain, accessToken },
      sku
    );

    if (variants.length === 0) {
      logger.warn("No variant found for SKU in store", { shopDomain, sku });
      return null;
    }

    // Use first matching variant
    const variant = variants[0];

    // Create or update product in central registry
    const product = await createOrUpdateProduct({
      sku,
      title: variant.product?.title || `Product ${sku}`,
      tracksInventory: variant.inventoryItem.tracked,
    });

    // Create mapping
    const mapping = await prisma.productStoreMapping.upsert({
      where: {
        productId_storeId: {
          productId: product.id,
          storeId: store.id,
        },
      },
      create: {
        productId: product.id,
        storeId: store.id,
        shopifyProductId: variant.product?.id || "",
        shopifyVariantId: variant.id,
        shopifyInventoryItemId: variant.inventoryItem.id,
        price: variant.price ? parseFloat(variant.price) : undefined,
        compareAtPrice: variant.compareAtPrice
          ? parseFloat(variant.compareAtPrice)
          : undefined,
        storeSku: sku,
        syncStatus: "COMPLETED",
        lastSyncedAt: new Date(),
      },
      update: {
        shopifyProductId: variant.product?.id || "",
        shopifyVariantId: variant.id,
        shopifyInventoryItemId: variant.inventoryItem.id,
        price: variant.price ? parseFloat(variant.price) : undefined,
        compareAtPrice: variant.compareAtPrice
          ? parseFloat(variant.compareAtPrice)
          : undefined,
        lastSyncedAt: new Date(),
      },
    });

    logger.info("Product discovered and mapped", {
      shopDomain,
      sku,
      productId: product.id,
      variantId: gidToId(variant.id),
    });

    return mapping;
  } catch (error) {
    logger.error("Failed to discover and map product", error, { shopDomain, sku });
    throw error;
  }
}

/**
 * Remove mapping for a store
 */
export async function removeStoreMapping(
  productId: string,
  storeId: string
): Promise<void> {
  try {
    await prisma.productStoreMapping.delete({
      where: {
        productId_storeId: {
          productId,
          storeId,
        },
      },
    });

    logger.database("delete", "product_store_mapping", {
      productId,
      storeId,
    });
  } catch (error) {
    logger.error("Failed to remove store mapping", error, { productId, storeId });
    throw error;
  }
}

/**
 * Get mapping statistics
 */
export async function getMappingStats(shopDomain?: string): Promise<{
  totalProducts: number;
  mappedProducts: number;
  unmappedProducts: number;
  storeCount: number;
}> {
  try {
    const [totalProducts, mappedProducts, storeCount] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({
        where: {
          storeMappings: {
            some: shopDomain
              ? {
                  store: {
                    shopDomain,
                  },
                }
              : {},
          },
        },
      }),
      prisma.store.count({
        where: {
          isActive: true,
        },
      }),
    ]);

    return {
      totalProducts,
      mappedProducts,
      unmappedProducts: totalProducts - mappedProducts,
      storeCount,
    };
  } catch (error) {
    logger.error("Failed to get mapping stats", error);
    throw error;
  }
}

export default {
  mapProductToStores,
  getStoreMapping,
  getAllMappings,
  syncProductCatalog,
  findProductBySku,
  createOrUpdateProduct,
  discoverAndMapProduct,
  removeStoreMapping,
  getMappingStats,
};
