/**
 * Database Client Singleton
 *
 * This module provides a singleton Prisma client instance for database operations.
 * It ensures only one client is created in development (with hot reloading support)
 * and production environments.
 */

import { PrismaClient } from "@prisma/client";

// Extend global type to include prisma client
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Create and configure Prisma client
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    errorFormat: "pretty",
  });

  return client;
}

/**
 * Singleton Prisma client instance
 * In development, we store the client in global to prevent multiple instances
 * due to hot module reloading
 */
export const prisma = global.__prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

/**
 * Graceful shutdown handler
 */
async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log("Database connection closed");
}

// Handle process termination
process.on("SIGINT", async () => {
  await disconnectDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await disconnectDatabase();
  process.exit(0);
});

/**
 * Database health check
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database health check failed:", error);
    return false;
  }
}

/**
 * Transaction helper with automatic retry
 */
export async function executeTransaction<T>(
  callback: (tx: PrismaClient) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          return await callback(tx as PrismaClient);
        },
        {
          maxWait: 5000, // 5 seconds
          timeout: 10000, // 10 seconds
        }
      );
    } catch (error) {
      lastError = error as Error;
      console.error(`Transaction attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

/**
 * Batch operation helper
 */
export async function batchOperation<T, R>(
  items: T[],
  batchSize: number,
  operation: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await operation(batch);
    results.push(...batchResults);
  }

  return results;
}

export default prisma;
