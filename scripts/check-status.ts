/**
 * Diagnostic script to check system status
 */

import { prisma } from "../app/db.server";

async function checkStatus() {
  console.log("🔍 Checking system status...\n");

  try {
    // Check stores
    const stores = await prisma.store.findMany();
    console.log(`📦 Stores: ${stores.length}`);
    if (stores.length === 0) {
      console.log("   ⚠️  No stores found! App may not be installed.");
      console.log("   💡 Install app through Shopify Admin first.");
    } else {
      stores.forEach((s) => {
        console.log(`   ✅ ${s.shopDomain} (active: ${s.isActive})`);
      });
    }

    // Check products
    const products = await prisma.product.findMany();
    console.log(`\n📦 Products: ${products.length}`);
    if (products.length === 0) {
      console.log("   ⚠️  No products found in database.");
    } else {
      products.slice(0, 5).forEach((p) => {
        console.log(`   - ${p.sku}: ${p.title}`);
      });
      if (products.length > 5) {
        console.log(`   ... and ${products.length - 5} more`);
      }
    }

    // Check inventory
    const inventory = await prisma.inventory.findMany({
      include: { product: true },
    });
    console.log(`\n📊 Inventory records: ${inventory.length}`);
    if (inventory.length === 0) {
      console.log("   ⚠️  No inventory records found.");
    } else {
      inventory.slice(0, 5).forEach((i) => {
        console.log(
          `   - ${i.product.sku}: Available=${i.availableQuantity}, Committed=${i.committedQuantity}`
        );
      });
      if (inventory.length > 5) {
        console.log(`   ... and ${inventory.length - 5} more`);
      }
    }

    // Check webhook events
    const webhooks = await prisma.webhookEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    console.log(`\n📡 Recent webhook events: ${webhooks.length}`);
    if (webhooks.length === 0) {
      console.log("   ⚠️  No webhooks received yet.");
      console.log("   💡 Make sure:");
      console.log("      1. App is installed in Shopify");
      console.log("      2. Webhooks are registered");
      console.log("      3. Workers are running");
    } else {
      webhooks.forEach((w) => {
        const status = w.processed ? "✅" : "⏳";
        console.log(
          `   ${status} ${w.topic} (${w.processed ? "processed" : "pending"}) - ${w.createdAt.toISOString()}`
        );
      });
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📋 SUMMARY:");
    console.log(`   Stores: ${stores.length > 0 ? "✅" : "❌"}`);
    console.log(`   Products: ${products.length > 0 ? "✅" : "❌"}`);
    console.log(`   Inventory: ${inventory.length > 0 ? "✅" : "❌"}`);
    console.log(`   Webhooks received: ${webhooks.length > 0 ? "✅" : "❌"}`);
    console.log(`   Webhooks processed: ${webhooks.filter((w) => w.processed).length}/${webhooks.length}`);

    if (stores.length === 0) {
      console.log("\n⚠️  ACTION REQUIRED:");
      console.log("   1. Make sure ./start-dev.sh is running");
      console.log("   2. Install app through Shopify Admin:");
      console.log("      https://pros-cons-shop-test.myshopify.com/admin/apps");
    } else if (webhooks.length === 0) {
      console.log("\n⚠️  ACTION REQUIRED:");
      console.log("   1. Check if webhooks are registered in Shopify Admin");
      console.log("   2. Make sure workers are running: npm run workers:dev");
      console.log("   3. Create a test order in Shopify Admin");
    } else if (webhooks.some((w) => !w.processed)) {
      console.log("\n⚠️  ACTION REQUIRED:");
      console.log("   1. Make sure workers are running: npm run workers:dev");
      console.log("   2. Check worker logs: tail -f /tmp/workers.log");
    }
  } catch (error) {
    console.error("❌ Error checking status:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkStatus();
