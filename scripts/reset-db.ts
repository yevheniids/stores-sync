/**
 * Reset database — deletes all data from all tables.
 * Sessions are preserved so you don't need to re-authenticate.
 *
 * Usage: npm run db:reset
 */
import { prisma } from "../app/db.server";

async function main() {
  console.log("Resetting database...\n");

  // Delete in order respecting foreign keys
  const conflict = await prisma.conflict.deleteMany();
  console.log(`  Conflicts:            ${conflict.count} deleted`);

  const syncOps = await prisma.syncOperation.deleteMany();
  console.log(`  Sync operations:      ${syncOps.count} deleted`);

  const webhookEvents = await prisma.webhookEvent.deleteMany();
  console.log(`  Webhook events:       ${webhookEvents.count} deleted`);

  const mappings = await prisma.productStoreMapping.deleteMany();
  console.log(`  Product mappings:     ${mappings.count} deleted`);

  const invLocations = await prisma.inventoryLocation.deleteMany();
  console.log(`  Inventory locations:  ${invLocations.count} deleted`);

  const inventory = await prisma.inventory.deleteMany();
  console.log(`  Inventory:            ${inventory.count} deleted`);

  const storeLocations = await prisma.storeLocation.deleteMany();
  console.log(`  Store locations:      ${storeLocations.count} deleted`);

  const products = await prisma.product.deleteMany();
  console.log(`  Products:             ${products.count} deleted`);

  const stores = await prisma.store.deleteMany();
  console.log(`  Stores:               ${stores.count} deleted`);

  const sessions = await prisma.session.deleteMany();
  console.log(`  Sessions:             ${sessions.count} deleted`);

  console.log("\nDatabase reset complete. All tables are empty.");
  console.log("NOTE: You will need to re-open the app in each store to re-create sessions and store records.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
