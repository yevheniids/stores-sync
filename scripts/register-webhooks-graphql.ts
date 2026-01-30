/**
 * Register webhooks via Shopify GraphQL Admin API
 *
 * Usage: WEBHOOK_URL=https://your-tunnel-url.trycloudflare.com npx tsx scripts/register-webhooks-graphql.ts
 */
import { prisma } from "../app/db.server";
import { createGraphQLClient } from "../app/shopify.server";

const WEBHOOK_TOPICS = [
  { topic: "ORDERS_CREATE", path: "/webhooks" },
  { topic: "PRODUCTS_CREATE", path: "/webhooks" },
  { topic: "PRODUCTS_UPDATE", path: "/webhooks" },
  { topic: "PRODUCTS_DELETE", path: "/webhooks" },
  { topic: "INVENTORY_LEVELS_UPDATE", path: "/webhooks" },
  { topic: "APP_UNINSTALLED", path: "/webhooks" },
];

const DELETE_MUTATION = `
  mutation webhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
      }
    }
  }
`;

const LIST_QUERY = `
  query { webhookSubscriptions(first: 100) { edges { node { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } } }
`;

const REGISTER_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        endpoint {
          ... on WebhookHttpEndpoint {
            callbackUrl
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

async function cleanOldWebhooks(
  store: { shopDomain: string; accessToken: string },
  keepUrl: string
) {
  const client = createGraphQLClient(store.shopDomain, store.accessToken);
  const result: any = await client.query(LIST_QUERY);
  const webhooks = result.webhookSubscriptions.edges;

  let deleted = 0;
  for (const edge of webhooks) {
    const url = edge.node.endpoint?.callbackUrl || "";
    // Delete webhooks that point to a different tunnel URL
    if (url && !url.startsWith(keepUrl)) {
      try {
        await client.query(DELETE_MUTATION, { id: edge.node.id });
        deleted++;
      } catch (err: any) {
        console.log(`    Failed to delete ${edge.node.id}: ${err.message}`);
      }
    }
  }

  console.log(`  Cleaned ${deleted} old webhook(s) (kept ${webhooks.length - deleted})`);
}

async function registerWebhooksForStore(
  store: { shopDomain: string; accessToken: string },
  webhookBaseUrl: string
) {
  console.log(`\n--- ${store.shopDomain} ---`);

  const client = createGraphQLClient(store.shopDomain, store.accessToken);

  // Clean old webhooks from previous tunnels
  await cleanOldWebhooks(store, webhookBaseUrl);

  let registered = 0;
  let errors = 0;

  for (const wh of WEBHOOK_TOPICS) {
    const callbackUrl = `${webhookBaseUrl}${wh.path}`;

    try {
      const result: any = await client.query(REGISTER_MUTATION, {
        topic: wh.topic,
        webhookSubscription: {
          callbackUrl,
          format: "JSON",
        },
      });

      const data = result.webhookSubscriptionCreate;
      if (data.userErrors && data.userErrors.length > 0) {
        console.log(`  WARN ${wh.topic}: ${data.userErrors.map((e: any) => e.message).join(", ")}`);
        errors++;
      } else {
        console.log(`  OK ${wh.topic} -> ${callbackUrl}`);
        registered++;
      }
    } catch (err: any) {
      console.error(`  FAIL ${wh.topic}: ${err.message}`);
      errors++;
    }
  }

  console.log(`  Result: ${registered} registered, ${errors} errors`);

  // Verify
  const check: any = await client.query(`
    query { webhookSubscriptions(first: 25) { edges { node { topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } } }
  `);
  console.log(`  Active webhooks: ${check.webhookSubscriptions.edges.length}`);
  check.webhookSubscriptions.edges.forEach((s: any) => {
    console.log(`    ${s.node.topic} -> ${s.node.endpoint?.callbackUrl}`);
  });

  return { registered, errors };
}

async function main() {
  const webhookBaseUrl = process.env.WEBHOOK_URL;
  if (!webhookBaseUrl) {
    console.error("Missing WEBHOOK_URL env var.");
    console.error("Usage: WEBHOOK_URL=https://your-tunnel.trycloudflare.com npx tsx scripts/register-webhooks-graphql.ts");
    console.error("\nOptional: SHOP_DOMAIN=store.myshopify.com to register for a single store.");
    process.exit(1);
  }

  const shopDomain = process.env.SHOP_DOMAIN;

  let stores;
  if (shopDomain) {
    // Register for a specific store
    const store = await prisma.store.findUnique({ where: { shopDomain } });
    if (!store) {
      console.error(`Store not found: ${shopDomain}`);
      process.exit(1);
    }
    stores = [store];
  } else {
    // Register for all active stores
    stores = await prisma.store.findMany({ where: { isActive: true } });
  }

  if (stores.length === 0) {
    console.log("No active stores found.");
    process.exit(1);
  }

  console.log(`Webhook URL base: ${webhookBaseUrl}`);
  console.log(`Stores to register: ${stores.length}`);

  let totalRegistered = 0;
  let totalErrors = 0;

  for (const store of stores) {
    const result = await registerWebhooksForStore(store, webhookBaseUrl);
    totalRegistered += result.registered;
    totalErrors += result.errors;
  }

  console.log(`\n=== Total: ${totalRegistered} registered, ${totalErrors} errors across ${stores.length} store(s) ===`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
