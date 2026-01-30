/**
 * Initial Product Sync Script
 *
 * Fetches all products from the Shopify store and imports them into
 * the central database (Products, ProductStoreMappings, Inventory).
 *
 * Usage: npx tsx scripts/initial-sync.ts
 *
 * This must be run AFTER the app has been installed in the store
 * (so a Session and Store record exist in the database).
 */

import { prisma } from "../app/db.server";
import { createGraphQLClient, apiVersion } from "../app/shopify.server";
import { sessionStorage } from "../app/shopify.server";

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const BATCH_SIZE = 50;

/**
 * GraphQL query to fetch products with variants and inventory
 */
const PRODUCTS_WITH_INVENTORY_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 100) {
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
                }
                inventoryPolicy
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

interface ProductNode {
  id: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  images: { edges: Array<{ node: { url: string } }> };
  variants: {
    edges: Array<{
      node: {
        id: string;
        sku: string;
        price: string;
        compareAtPrice: string | null;
        barcode: string | null;
        inventoryItem: {
          id: string;
          tracked: boolean;
        };
        inventoryPolicy: string;
        inventoryQuantity: number;
      };
    }>;
  };
}

interface ProductsResponse {
  products: {
    edges: Array<{ node: ProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

/**
 * Extract numeric ID from Shopify GID
 */
function gidToId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

async function syncStore(shopDomain: string) {
  console.log(`\n--- Syncing: ${shopDomain} ---`);
  console.log(`API Version: ${apiVersion}\n`);

  // 1. Get session
  const sessionId = `offline_${shopDomain}`;
  let session = await sessionStorage.loadSession(sessionId);

  if (!session) {
    console.log("Session not found in session storage, checking Store table...");
    const storeRecord = await prisma.store.findUnique({
      where: { shopDomain },
    });

    if (!storeRecord || !storeRecord.accessToken) {
      console.error(
        `No session or store found for ${shopDomain}.\n` +
          `Install the app first by running: npm run dev:tunnel\n` +
          `Then open the app in Shopify Admin.`
      );
      return { shopDomain, success: false };
    }

    session = {
      id: sessionId,
      shop: shopDomain,
      state: "active",
      isOnline: false,
      scope: storeRecord.scope,
      accessToken: storeRecord.accessToken,
    } as any;

    console.log("Using access token from Store table.");
  } else {
    console.log("Session found in session storage.");
  }

  const accessToken = (session as any).accessToken;
  if (!accessToken) {
    console.error("No access token available. Re-install the app.");
    return { shopDomain, success: false };
  }

  // 2. Get or create store record
  let store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    store = await prisma.store.create({
      data: {
        shopDomain,
        shopName: shopDomain,
        accessToken,
        scope: (session as any).scope || "",
        isActive: true,
        syncEnabled: true,
      },
    });
    console.log("Store record created.");
  }

  // 3. Fetch all products with pagination
  const client = createGraphQLClient(shopDomain, accessToken);

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  console.log("Fetching products from Shopify...\n");

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: BATCH_SIZE };
    if (cursor) {
      variables.after = cursor;
    }

    let response: ProductsResponse;
    try {
      response = await client.query<ProductsResponse>(
        PRODUCTS_WITH_INVENTORY_QUERY,
        variables
      );
    } catch (error: any) {
      console.error(`GraphQL query failed: ${error.message}`);
      if (error.message.includes("quantities")) {
        console.log("Retrying without inventory quantities...");
      }
      break;
    }

    const products = response.products.edges.map((e) => e.node);
    hasNextPage = response.products.pageInfo.hasNextPage;
    cursor = response.products.pageInfo.endCursor;

    for (const shopifyProduct of products) {
      totalFetched++;

      for (const variantEdge of shopifyProduct.variants.edges) {
        const variant = variantEdge.node;
        const sku = variant.sku;

        if (!sku) {
          totalSkipped++;
          console.log(
            `  SKIP: "${shopifyProduct.title}" variant ${gidToId(variant.id)} - no SKU`
          );
          continue;
        }

        try {
          // Upsert central product
          const product = await prisma.product.upsert({
            where: { sku },
            create: {
              sku,
              title: shopifyProduct.title,
              description: shopifyProduct.descriptionHtml || undefined,
              vendor: shopifyProduct.vendor || undefined,
              productType: shopifyProduct.productType || undefined,
              tags: shopifyProduct.tags || [],
              imageUrl:
                shopifyProduct.images.edges[0]?.node.url || undefined,
              weightUnit: "g",
              inventoryPolicy:
                variant.inventoryPolicy === "CONTINUE"
                  ? "CONTINUE"
                  : "DENY",
              tracksInventory: variant.inventoryItem.tracked,
            },
            update: {
              title: shopifyProduct.title,
              description: shopifyProduct.descriptionHtml || undefined,
              vendor: shopifyProduct.vendor || undefined,
              productType: shopifyProduct.productType || undefined,
              tags: shopifyProduct.tags || [],
              imageUrl:
                shopifyProduct.images.edges[0]?.node.url || undefined,
            },
          });

          // Upsert store mapping
          await prisma.productStoreMapping.upsert({
            where: {
              productId_storeId: {
                productId: product.id,
                storeId: store.id,
              },
            },
            create: {
              productId: product.id,
              storeId: store.id,
              shopifyProductId: shopifyProduct.id,
              shopifyVariantId: variant.id,
              shopifyInventoryItemId: variant.inventoryItem.id,
              price: variant.price ? parseFloat(variant.price) : undefined,
              compareAtPrice: variant.compareAtPrice
                ? parseFloat(variant.compareAtPrice)
                : undefined,
              storeSku: sku,
              barcode: variant.barcode || undefined,
              syncStatus: "COMPLETED",
              lastSyncedAt: new Date(),
            },
            update: {
              shopifyProductId: shopifyProduct.id,
              shopifyVariantId: variant.id,
              shopifyInventoryItemId: variant.inventoryItem.id,
              price: variant.price ? parseFloat(variant.price) : undefined,
              compareAtPrice: variant.compareAtPrice
                ? parseFloat(variant.compareAtPrice)
                : undefined,
              barcode: variant.barcode || undefined,
              lastSyncedAt: new Date(),
            },
          });

          // Upsert inventory
          if (variant.inventoryItem.tracked) {
            const availableQty = variant.inventoryQuantity || 0;

            await prisma.inventory.upsert({
              where: { productId: product.id },
              create: {
                productId: product.id,
                availableQuantity: availableQty,
                committedQuantity: 0,
                incomingQuantity: 0,
                lastAdjustedAt: new Date(),
                lastAdjustedBy: "initial-sync",
              },
              update: {
                availableQuantity: availableQty,
                lastAdjustedAt: new Date(),
                lastAdjustedBy: "initial-sync",
              },
            });
          }

          // Check if this was a create or update
          const existingProduct = await prisma.product.findUnique({
            where: { sku },
          });
          if (existingProduct?.createdAt.getTime() === existingProduct?.updatedAt.getTime()) {
            totalCreated++;
          } else {
            totalUpdated++;
          }

          console.log(
            `  OK: "${shopifyProduct.title}" [${sku}] - qty: ${variant.inventoryQuantity || 0}`
          );
        } catch (error: any) {
          totalErrors++;
          console.error(
            `  ERROR: "${shopifyProduct.title}" [${sku}] - ${error.message}`
          );
        }
      }
    }

    console.log(
      `\n  Page complete. Fetched: ${totalFetched} products so far.`
    );

    // Rate limit: small delay between pages
    if (hasNextPage) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // 4. Record sync operation
  await prisma.syncOperation.create({
    data: {
      operationType: "INITIAL_SYNC",
      direction: "STORE_TO_CENTRAL",
      storeId: store.id,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      triggeredBy: "script-initial-sync",
      newValue: {
        totalFetched,
        totalCreated,
        totalUpdated,
        totalSkipped,
        totalErrors,
      },
    },
  });

  // 5. Print summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Sync Complete: ${shopDomain}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Products fetched:  ${totalFetched}`);
  console.log(`  Variants created:  ${totalCreated}`);
  console.log(`  Variants updated:  ${totalUpdated}`);
  console.log(`  Skipped (no SKU):  ${totalSkipped}`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`${"=".repeat(50)}\n`);

  return { shopDomain, success: true, totalFetched, totalCreated, totalUpdated, totalSkipped, totalErrors };
}

async function main() {
  console.log(`\n=== Initial Product Sync ===\n`);

  let storeDomains: string[];

  if (SHOP_DOMAIN) {
    // Sync a specific store
    storeDomains = [SHOP_DOMAIN];
  } else {
    // Sync all active stores
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      select: { shopDomain: true },
    });

    if (stores.length === 0) {
      console.error(
        "No active stores found.\n" +
          "Install the app first by running: npm run dev:tunnel\n" +
          "Or specify a store: SHOP_DOMAIN=store.myshopify.com npm run initial-sync"
      );
      process.exit(1);
    }

    storeDomains = stores.map((s) => s.shopDomain);
    console.log(`Found ${storeDomains.length} active store(s): ${storeDomains.join(", ")}`);
  }

  const results = [];
  for (const domain of storeDomains) {
    const result = await syncStore(domain);
    results.push(result);
  }

  // Overall summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`All Stores Sync Summary`);
  console.log(`${"=".repeat(50)}`);
  for (const r of results) {
    console.log(`  ${r.shopDomain}: ${r.success ? "OK" : "FAILED"}`);
  }

  // Verify DB state
  const productCount = await prisma.product.count();
  const mappingCount = await prisma.productStoreMapping.count();
  const inventoryCount = await prisma.inventory.count();

  console.log(`\nDatabase state:`);
  console.log(`  Products:     ${productCount}`);
  console.log(`  Mappings:     ${mappingCount}`);
  console.log(`  Inventory:    ${inventoryCount}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await prisma.$disconnect();
  process.exit(1);
});
