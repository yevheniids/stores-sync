/**
 * Script to manually register webhooks
 * 
 * Run this script to register all webhooks defined in shopify.server.ts
 * Usage: npx tsx scripts/register-webhooks.ts
 */

import { shopify, registerWebhooks } from "../app/shopify.server";
import { prisma } from "../app/db.server";

async function main() {
  const shopDomain = process.env.SHOP_DOMAIN || "pros-cons-shop-test.myshopify.com";
  
  console.log(`🔧 Registering webhooks for shop: ${shopDomain}`);
  
  try {
    // Try to get session from session storage first
    const sessionId = `offline_${shopDomain}`;
    let session = await shopify.sessionStorage.loadSession(sessionId);
    
    // If session not found, try to get from Store table and create session
    if (!session) {
      console.log(`⚠️  Session not found in session storage, checking Store table...`);
      
      const store = await prisma.store.findUnique({
        where: { shopDomain },
      });
      
      if (!store) {
        console.error(`❌ No store found for shop: ${shopDomain}`);
        console.error(`   Make sure the app is installed in the shop first.`);
        console.error(`   Install the app through Shopify Admin: https://${shopDomain}/admin/apps`);
        process.exit(1);
      }
      
      console.log(`✅ Store found in database`);
      
      // Create a session object from store data
      // Note: This is a workaround - ideally session should exist
      session = {
        id: sessionId,
        shop: shopDomain,
        state: "registered",
        isOnline: false,
        scope: store.scope,
        accessToken: store.accessToken,
        expires: null,
      } as any;
      
      console.log(`✅ Created session from store data`);
    } else {
      console.log(`✅ Session found in session storage`);
    }
    
    console.log(`📡 Registering webhooks...`);
    await registerWebhooks({ session });
    
    console.log(`✅ Webhooks registered successfully!`);
    console.log(`\n📋 Registered webhooks:`);
    console.log(`   - Order creation → /api/webhooks/orders/create`);
    console.log(`   - Inventory levels update → /api/webhooks/inventory/update`);
    console.log(`   - Product creation → /api/webhooks/products/create`);
    console.log(`   - Product update → /api/webhooks/products/update`);
    console.log(`   - Product deletion → /api/webhooks/products/delete`);
    console.log(`   - App uninstalled → /api/webhooks/app/uninstalled`);
    console.log(`\n💡 You can verify webhooks in Shopify Admin:`);
    console.log(`   https://${shopDomain}/admin/settings/notifications`);
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`❌ Failed to register webhooks:`, error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
