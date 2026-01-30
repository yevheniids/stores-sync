/**
 * Workers Entry Point
 *
 * Initializes and runs all BullMQ workers as a separate process.
 * Workers process jobs from queues asynchronously from the main application.
 *
 * To run: node --loader tsx workers/index.ts
 * Or in production: npm run workers
 */

import { createWebhookProcessorWorker } from "../app/lib/queue/workers/webhook-processor.worker";
import { logger } from "../app/lib/logger.server";
import type { Worker } from "bullmq";
import http from "http";

/**
 * Active workers
 */
const workers: Worker[] = [];

/**
 * Initialize all workers
 */
async function startWorkers(): Promise<void> {
  logger.info("Starting BullMQ workers...");

  try {
    // Initialize webhook processor worker
    const webhookWorker = createWebhookProcessorWorker();
    workers.push(webhookWorker);

    logger.info("All workers started successfully", {
      workerCount: workers.length,
      workers: ["webhook-processing"],
    });

    // Display worker status
    displayWorkerStatus();
  } catch (error) {
    logger.error("Failed to start workers", error);
    process.exit(1);
  }
}

/**
 * Display worker status
 */
function displayWorkerStatus(): void {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Workers Running");
  console.log("=".repeat(60));
  console.log(`Total Workers: ${workers.length}`);
  console.log("\nActive Queues:");
  console.log("  • webhook-processing (concurrency: 5)");
  console.log("\nPress Ctrl+C to gracefully shutdown");
  console.log("=".repeat(60) + "\n");
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} signal, shutting down workers...`);

  try {
    // Close all workers
    await Promise.all(
      workers.map(async (worker) => {
        logger.info(`Closing worker: ${worker.name}`);
        await worker.close();
      })
    );

    logger.info("All workers closed successfully");

    // Close database connections
    const { prisma } = await import("../app/db.server");
    await prisma.$disconnect();
    logger.info("Database connections closed");

    // Close Redis connections
    const { redis } = await import("../app/lib/redis.server");
    await redis.quit();
    logger.info("Redis connections closed");

    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", error);
    process.exit(1);
  }
}

/**
 * Handle uncaught errors
 */
process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught exception in worker process", error);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  logger.error("Unhandled rejection in worker process", reason, {
    promise: promise.toString(),
  });
  shutdown("unhandledRejection");
});

/**
 * Handle shutdown signals
 */
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * Health check endpoint (optional)
 * Can be used by orchestration tools to monitor worker health
 */
function setupHealthCheck(): void {
  const port = process.env.WORKER_HEALTH_PORT || 3001;

  const server = http.createServer((req: any, res: any) => {
    if (req.url === "/health") {
      const activeWorkers = workers.filter((w) => !w.closing);
      const isHealthy = activeWorkers.length === workers.length;

      res.writeHead(isHealthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: isHealthy ? "healthy" : "unhealthy",
          workers: {
            total: workers.length,
            active: activeWorkers.length,
          },
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    logger.info(`Worker health check endpoint available at http://localhost:${port}/health`);
  });
}

/**
 * Worker metrics (optional)
 * Log worker statistics periodically
 */
async function logWorkerMetrics(): Promise<void> {
  const { getAllQueueStats } = await import("../app/lib/queue.server");

  setInterval(async () => {
    try {
      const stats = await getAllQueueStats();

      logger.info("Worker metrics", {
        webhookProcessing: stats.webhookProcessing,
        inventorySync: stats.inventorySync,
        productSync: stats.productSync,
        batchOperations: stats.batchOperations,
        conflictResolution: stats.conflictResolution,
        scheduledSync: stats.scheduledSync,
      });
    } catch (error) {
      logger.error("Failed to log worker metrics", error);
    }
  }, 60000); // Every minute
}

/**
 * Cleanup old webhook events periodically
 */
async function scheduleWebhookCleanup(): Promise<void> {
  const { cleanupOldEvents } = await import("../app/lib/utils/idempotency.server");

  // Run cleanup every 6 hours
  setInterval(async () => {
    try {
      logger.info("Running scheduled webhook event cleanup...");
      const deletedCount = await cleanupOldEvents();
      logger.info(`Webhook cleanup completed: ${deletedCount} events deleted`);
    } catch (error) {
      logger.error("Webhook cleanup failed", error);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours

  // Run immediately on startup
  try {
    const deletedCount = await cleanupOldEvents();
    if (deletedCount > 0) {
      logger.info(`Initial webhook cleanup: ${deletedCount} events deleted`);
    }
  } catch (error) {
    logger.error("Initial webhook cleanup failed", error);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("🔧 Initializing worker process...\n");

  // Validate environment
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    logger.error("Redis configuration missing. Set REDIS_URL or REDIS_HOST");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    logger.error("Database configuration missing. Set DATABASE_URL");
    process.exit(1);
  }

  // Start workers
  await startWorkers();

  // Setup health check endpoint
  if (process.env.ENABLE_WORKER_HEALTH_CHECK !== "false") {
    setupHealthCheck();
  }

  // Enable metrics logging
  if (process.env.ENABLE_WORKER_METRICS !== "false") {
    await logWorkerMetrics();
  }

  // Schedule periodic cleanup
  await scheduleWebhookCleanup();

  logger.info("Worker process fully initialized and ready");
}

// Start the worker process
main().catch((error) => {
  logger.error("Fatal error in worker process", error);
  process.exit(1);
});
