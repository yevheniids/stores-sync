/**
 * BullMQ Queue Configuration
 *
 * Manages job queues for:
 * - Inventory synchronization
 * - Product updates
 * - Webhook processing
 * - Batch operations
 * - Conflict resolution
 */

import { Queue, Worker, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { createBullMQConnection } from "./redis.server";

/**
 * Queue names
 */
export enum QueueName {
  INVENTORY_SYNC = "inventory-sync",
  PRODUCT_SYNC = "product-sync",
  WEBHOOK_PROCESSING = "webhook-processing",
  BATCH_OPERATIONS = "batch-operations",
  CONFLICT_RESOLUTION = "conflict-resolution",
  SCHEDULED_SYNC = "scheduled-sync",
}

/**
 * Job types for each queue
 */
export interface InventorySyncJob {
  productId: string;
  storeIds?: string[]; // If empty, sync to all stores
  triggeredBy: string;
}

export interface ProductSyncJob {
  productId: string;
  storeId: string;
  operation: "create" | "update" | "delete";
  data?: any;
}

export interface WebhookProcessingJob {
  webhookEventId: string;
  topic: string;
  shopDomain: string;
  payload: any;
}

export interface BatchOperationJob {
  operationType: "bulk_inventory_update" | "bulk_product_sync" | "initial_sync";
  storeId?: string;
  productIds?: string[];
  data?: any;
}

export interface ConflictResolutionJob {
  conflictId: string;
  strategy: "USE_LOWEST" | "USE_HIGHEST" | "USE_DATABASE" | "USE_STORE";
}

export interface ScheduledSyncJob {
  storeId: string;
  syncType: "full" | "incremental";
}

/**
 * Default job options
 */
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: {
    age: 86400, // Keep completed jobs for 24 hours
    count: 1000,
  },
  removeOnFail: {
    age: 604800, // Keep failed jobs for 7 days
    count: 5000,
  },
};

/**
 * Create queue connection
 */
function createQueue<T = any>(name: QueueName): Queue<T> {
  return new Queue<T>(name, {
    connection: createBullMQConnection(),
    defaultJobOptions,
  });
}

/**
 * Queue instances
 */
export const queues = {
  inventorySync: createQueue<InventorySyncJob>(QueueName.INVENTORY_SYNC),
  productSync: createQueue<ProductSyncJob>(QueueName.PRODUCT_SYNC),
  webhookProcessing: createQueue<WebhookProcessingJob>(
    QueueName.WEBHOOK_PROCESSING
  ),
  batchOperations: createQueue<BatchOperationJob>(QueueName.BATCH_OPERATIONS),
  conflictResolution: createQueue<ConflictResolutionJob>(
    QueueName.CONFLICT_RESOLUTION
  ),
  scheduledSync: createQueue<ScheduledSyncJob>(QueueName.SCHEDULED_SYNC),
};

/**
 * Queue Events for monitoring
 */
export const queueEvents = {
  inventorySync: new QueueEvents(QueueName.INVENTORY_SYNC, {
    connection: createBullMQConnection(),
  }),
  productSync: new QueueEvents(QueueName.PRODUCT_SYNC, {
    connection: createBullMQConnection(),
  }),
  webhookProcessing: new QueueEvents(QueueName.WEBHOOK_PROCESSING, {
    connection: createBullMQConnection(),
  }),
  batchOperations: new QueueEvents(QueueName.BATCH_OPERATIONS, {
    connection: createBullMQConnection(),
  }),
  conflictResolution: new QueueEvents(QueueName.CONFLICT_RESOLUTION, {
    connection: createBullMQConnection(),
  }),
  scheduledSync: new QueueEvents(QueueName.SCHEDULED_SYNC, {
    connection: createBullMQConnection(),
  }),
};

/**
 * Add job to queue with custom options
 */
export async function addJob<T>(
  queue: Queue<T>,
  jobName: string,
  data: T,
  options?: JobsOptions
): Promise<Job<T>> {
  return await queue.add(jobName, data, {
    ...defaultJobOptions,
    ...options,
  });
}

/**
 * Add inventory sync job
 */
export async function addInventorySyncJob(
  data: InventorySyncJob,
  options?: JobsOptions
): Promise<Job<InventorySyncJob>> {
  return await addJob(
    queues.inventorySync,
    "sync-inventory",
    data,
    {
      ...options,
      // Prevent duplicate jobs for the same product
      jobId: `inventory-sync-${data.productId}-${Date.now()}`,
    }
  );
}

/**
 * Add product sync job
 */
export async function addProductSyncJob(
  data: ProductSyncJob,
  options?: JobsOptions
): Promise<Job<ProductSyncJob>> {
  return await addJob(
    queues.productSync,
    "sync-product",
    data,
    {
      ...options,
      jobId: `product-sync-${data.productId}-${data.storeId}-${Date.now()}`,
    }
  );
}

/**
 * Add webhook processing job with high priority
 */
export async function addWebhookJob(
  data: WebhookProcessingJob,
  options?: JobsOptions
): Promise<Job<WebhookProcessingJob>> {
  return await addJob(
    queues.webhookProcessing,
    "process-webhook",
    data,
    {
      ...options,
      priority: 1, // High priority
      jobId: data.webhookEventId, // Use webhook event ID for idempotency
    }
  );
}

/**
 * Add batch operation job
 */
export async function addBatchOperationJob(
  data: BatchOperationJob,
  options?: JobsOptions
): Promise<Job<BatchOperationJob>> {
  return await addJob(
    queues.batchOperations,
    "batch-operation",
    data,
    {
      ...options,
      priority: 5, // Lower priority than real-time syncs
    }
  );
}

/**
 * Add conflict resolution job
 */
export async function addConflictResolutionJob(
  data: ConflictResolutionJob,
  options?: JobsOptions
): Promise<Job<ConflictResolutionJob>> {
  return await addJob(
    queues.conflictResolution,
    "resolve-conflict",
    data,
    options
  );
}

/**
 * Add scheduled sync job (recurring)
 */
export async function addScheduledSyncJob(
  data: ScheduledSyncJob,
  intervalMinutes: number = 5
): Promise<Job<ScheduledSyncJob>> {
  return await queues.scheduledSync.add(
    "scheduled-sync",
    data,
    {
      repeat: {
        every: intervalMinutes * 60 * 1000, // Convert to milliseconds
      },
      jobId: `scheduled-sync-${data.storeId}`,
    }
  );
}

/**
 * Get queue statistics
 */
export async function getQueueStats(queue: Queue) {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Get all queue statistics
 */
export async function getAllQueueStats() {
  const stats = await Promise.all([
    getQueueStats(queues.inventorySync),
    getQueueStats(queues.productSync),
    getQueueStats(queues.webhookProcessing),
    getQueueStats(queues.batchOperations),
    getQueueStats(queues.conflictResolution),
    getQueueStats(queues.scheduledSync),
  ]);

  return {
    inventorySync: stats[0],
    productSync: stats[1],
    webhookProcessing: stats[2],
    batchOperations: stats[3],
    conflictResolution: stats[4],
    scheduledSync: stats[5],
  };
}

/**
 * Pause a queue
 */
export async function pauseQueue(queue: Queue): Promise<void> {
  await queue.pause();
}

/**
 * Resume a queue
 */
export async function resumeQueue(queue: Queue): Promise<void> {
  await queue.resume();
}

/**
 * Clear all jobs from a queue
 */
export async function clearQueue(queue: Queue): Promise<void> {
  await queue.drain();
  await queue.clean(0, 0, "completed");
  await queue.clean(0, 0, "failed");
}

/**
 * Retry all failed jobs in a queue
 */
export async function retryFailedJobs(queue: Queue): Promise<void> {
  const failedJobs = await queue.getFailed();
  await Promise.all(failedJobs.map((job) => job.retry()));
}

/**
 * Remove a job by ID
 */
export async function removeJob(queue: Queue, jobId: string): Promise<void> {
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

/**
 * Get job by ID
 */
export async function getJob<T>(
  queue: Queue<T>,
  jobId: string
): Promise<Job<T> | undefined> {
  return await queue.getJob(jobId);
}

/**
 * Graceful shutdown
 */
export async function shutdownQueues(): Promise<void> {
  console.log("Shutting down queues...");

  await Promise.all([
    queues.inventorySync.close(),
    queues.productSync.close(),
    queues.webhookProcessing.close(),
    queues.batchOperations.close(),
    queues.conflictResolution.close(),
    queues.scheduledSync.close(),
  ]);

  await Promise.all([
    queueEvents.inventorySync.close(),
    queueEvents.productSync.close(),
    queueEvents.webhookProcessing.close(),
    queueEvents.batchOperations.close(),
    queueEvents.conflictResolution.close(),
    queueEvents.scheduledSync.close(),
  ]);

  console.log("All queues closed");
}

// Handle process termination
process.on("SIGINT", async () => {
  await shutdownQueues();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownQueues();
  process.exit(0);
});

export default queues;
