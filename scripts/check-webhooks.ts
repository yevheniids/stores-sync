/**
 * Check registered webhooks in Shopify
 */
import { prisma } from "../app/db.server";
import { createGraphQLClient } from "../app/shopify.server";

async function main() {
  const store = await prisma.store.findFirst({ where: { isActive: true } });
  if (!store) {
    console.log("No active store found");
    process.exit(1);
  }

  console.log("Store:", store.shopDomain);

  const client = createGraphQLClient(store.shopDomain, store.accessToken);
  const result: any = await client.query(`
    query {
      webhookSubscriptions(first: 25) {
        edges {
          node {
            id
            topic
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `);

  const subs = result.webhookSubscriptions.edges;
  console.log(`\nRegistered webhooks: ${subs.length}\n`);

  if (subs.length === 0) {
    console.log("No webhooks registered! Webhooks need to be registered.");
    console.log("Open the app in Shopify Admin to trigger afterAuth registration.");
  } else {
    subs.forEach((s: any) => {
      console.log(`  ${s.node.topic} -> ${s.node.endpoint?.callbackUrl || "N/A"}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
