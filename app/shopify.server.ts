/**
 * Shopify App Configuration
 *
 * This module initializes and configures the Shopify app with:
 * - OAuth authentication
 * - Session storage (Prisma-backed)
 * - Webhook handling
 * - API clients
 */

import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-10";
import { prisma } from "./db.server";

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

validateEnvironment();

/**
 * Initialize Prisma session storage
 */
const sessionStorage = new PrismaSessionStorage(prisma);

/**
 * Configure and initialize Shopify app
 */
export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(",") || [
    "write_products",
    "read_products",
    "write_inventory",
    "read_inventory",
    "write_orders",
    "read_orders",
    "read_locations",
  ],
  appUrl: process.env.SHOPIFY_APP_URL || process.env.HOST || "",
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
  restResources,
  isEmbeddedApp: true,

  /**
   * Webhook configuration
   */
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/app/uninstalled",
      callback: async (topic, shop, body, webhookId) => {
        console.log(`App uninstalled from shop: ${shop}`);
        // Webhook handler will be implemented in webhook routes
      },
    },
    PRODUCTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/products/create",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/products/update",
    },
    PRODUCTS_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/products/delete",
    },
    INVENTORY_LEVELS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/inventory/update",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/orders/create",
    },
  },

  hooks: {
    afterAuth: async ({ session }) => {
      console.log(`afterAuth: shop=${session.shop}, token=${session.accessToken ? "yes" : "no"}`);

      // Store installation in database
      try {
        await prisma.store.upsert({
          where: { shopDomain: session.shop },
          create: {
            shopDomain: session.shop,
            shopName: session.shop,
            accessToken: session.accessToken,
            scope: session.scope || "",
            isActive: true,
            syncEnabled: true,
          },
          update: {
            accessToken: session.accessToken,
            scope: session.scope || "",
            isActive: true,
            updatedAt: new Date(),
          },
        });
        console.log(`Store record saved for ${session.shop}`);
      } catch (error) {
        console.error(`Failed to save store for ${session.shop}:`, error);
      }

      // Register webhooks
      try {
        shopify.registerWebhooks({ session });
        console.log(`Webhooks registered for ${session.shop}`);
      } catch (error) {
        console.error(`Failed to register webhooks for ${session.shop}:`, error);
      }
    },
  },

  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

/**
 * Export utility functions
 */
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export { sessionStorage };

/**
 * Helper function to get admin API client for a shop
 */
export async function getAdminClient(shop: string) {
  const session = await sessionStorage.loadSession(shop);

  if (!session) {
    throw new Error(`No session found for shop: ${shop}`);
  }

  return shopify.authenticatedFetch(session);
}

/**
 * Common GraphQL client interface used across the app
 */
export interface GraphQLClient {
  query: <T = unknown>(query: string, variables?: Record<string, unknown>) => Promise<T>;
}

/**
 * Helper function to create GraphQL client using raw fetch + access token
 */
export function createGraphQLClient(shop: string, accessToken: string): GraphQLClient {
  return {
    query: async <T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      const response = await fetch(
        `https://${shop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ query, variables }),
        }
      );

      if (!response.ok) {
        const status = response.status;
        const message =
          status === 401
            ? `Access token expired or invalid for ${shop}. Open the app from that store in Shopify Admin to re-authenticate.`
            : `GraphQL request failed: ${response.statusText}`;
        const error = new Error(message);
        (error as any).status = status;
        throw error;
      }

      const result = await response.json();

      if (result.errors) {
        const error = new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        (error as any).graphqlErrors = result.errors;
        throw error;
      }

      return result.data;
    },
  };
}

/**
 * Wrap the authenticated admin.graphql() from authenticate.admin()
 * into our standard GraphQLClient interface.
 * This is the recommended approach for Shopify Remix apps —
 * it uses the library's built-in token management (token exchange).
 */
export function wrapAdminGraphQL(admin: { graphql: Function }): GraphQLClient {
  return {
    query: async <T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      const response = await admin.graphql(query, { variables });
      const result = await response.json();

      if (result.errors) {
        const error = new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        (error as any).graphqlErrors = result.errors;
        throw error;
      }

      return result.data;
    },
  };
}

/**
 * Rate limiting helper with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      if (error.response?.status === 429) {
        const retryAfter =
          parseInt(error.response.headers.get("Retry-After") || "0") * 1000;
        const delay = retryAfter || baseDelay * Math.pow(2, attempt);

        console.log(`Rate limited. Retrying after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, throw immediately
      throw error;
    }
  }

  throw lastError!;
}

/**
 * Batch GraphQL query helper
 */
export async function batchGraphQLQuery<T>(
  shop: string,
  accessToken: string,
  queries: string[],
  batchSize: number = 10
): Promise<T[]> {
  const client = createGraphQLClient(shop, accessToken);
  const results: T[] = [];

  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchPromises = batch.map((query) => client.query<T>(query));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

export default shopify;
