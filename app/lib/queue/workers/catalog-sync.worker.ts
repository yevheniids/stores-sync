/**
 * Catalog Sync Worker
 *
 * Processes "catalog sync all" jobs from batch-operations queue.
 * Runs syncProductCatalog for each active store so the HTTP request can return immediately (202).
 */

import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "~/lib/redis.server";
import { logger } from "~/lib/logger.server";
import { prisma } from "~/db.server";
import { syncProductCatalog } from "~/lib/sync/product-mapper.server";
import type { BatchOperationJob } from "~/lib/queue.server";

async function processCatalogSyncJob(job: Job<BatchOperationJob>): Promise<void> {
  const { operationType, data } = job.data;

  if (operationType !== "initial_sync") {
    logger.job("catalog-sync", job.id!, "skipped", { operationType, reason: "not initial_sync" });
    return;
  }

  logger.job("catalog-sync", job.id!, "processing", { triggeredBy: data?.triggeredBy ?? "background" });

  const stores = await prisma.store.findMany({ where: { isActive: true } });

  if (stores.length === 0) {
    logger.job("catalog-sync", job.id!, "completed", { reason: "no active stores" });
    return;
  }

  const triggeredBy = (data?.triggeredBy as string) ?? "background";

  for (const store of stores) {
    const startedAt = new Date();
    try {
      const stats = await syncProductCatalog(store.shopDomain, {});
      if (stats.errorMessage) {
        await prisma.syncOperation.create({
          data: {
            operationType: "BULK_SYNC",
            direction: "STORE_TO_CENTRAL",
            storeId: store.id,
            status: "FAILED",
            startedAt,
            completedAt: new Date(),
            errorMessage: stats.errorMessage,
            triggeredBy,
          },
        });
        logger.warn("Catalog sync skipped for store (token expired/invalid)", {
          shopDomain: store.shopDomain,
          message: stats.errorMessage,
        });
      } else {
        await prisma.syncOperation.create({
          data: {
            operationType: "BULK_SYNC",
            direction: "STORE_TO_CENTRAL",
            storeId: store.id,
            status: "COMPLETED",
            startedAt,
            completedAt: new Date(),
            newValue: { created: stats.created, updated: stats.updated, total: stats.total },
            triggeredBy,
          },
        });
        logger.info("Catalog sync completed for store", { shopDomain: store.shopDomain, ...stats });
      }
    } catch (error) {
      await prisma.syncOperation.create({
        data: {
          operationType: "BULK_SYNC",
          direction: "STORE_TO_CENTRAL",
          storeId: store.id,
          status: "FAILED",
          startedAt,
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : "Sync failed",
          triggeredBy,
        },
      });
      logger.error("Catalog sync failed for store", error, { shopDomain: store.shopDomain });
      // Continue with other stores
    }
  }

  logger.job("catalog-sync", job.id!, "completed", { storeCount: stores.length });
}

export function createCatalogSyncWorker(): Worker {
  const worker = new Worker<BatchOperationJob>(
    "batch-operations",
    async (job: Job<BatchOperationJob>) => {
      const isCatalogSync =
        job.name === "catalog-sync" ||
        (job.name === "batch-sync" && job.data.operationType === "initial_sync");
      if (isCatalogSync) {
        await processCatalogSyncJob(job);
      }
    },
    {
      connection: createBullMQConnection(),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    logger.job("catalog-sync", job.id!, "completed", { duration: Date.now() - job.timestamp });
  });

  worker.on("failed", (job, error) => {
    logger.error("Catalog sync job failed", error, { jobId: job?.id });
  });

  return worker;
}
