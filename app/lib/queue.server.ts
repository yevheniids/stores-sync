/**
 * BullMQ Queue Configuration
 *
 * Manages job queues for:
 * - Inventory synchronization
 * - Product updates
 * - Webhook processing
 * - Batch operations
 * - Conflict resolution
 *
 * Lazy-initialized to avoid crashes in serverless environments (e.g. Vercel)
 * where Redis may not be available.
 */

import { Queue, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { createBullMQConnection, isRedisAvailable } from "./redis.server";

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
  storeIds?: string[];
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
    age: 86400,
    count: 1000,
  },
  removeOnFail: {
    age: 604800,
    count: 5000,
  },
};

/**
 * Lazy queue factory — only creates the queue when first accessed
 */
function lazyQueue<T = any>(name: QueueName): Queue<T> {
  let _queue: Queue<T> | null = null;
  return new Proxy({} as Queue<T>, {
    get(_target, prop, receiver) {
      if (!_queue) {
        _queue = new Queue<T>(name, {
          connection: createBullMQConnection(),
          defaultJobOptions,
        });
      }
      return Reflect.get(_queue, prop, receiver);
    },
  });
}

/**
 * Queue instances (lazy-initialized)
 */
export const queues = {
  inventorySync: lazyQueue<InventorySyncJob>(QueueName.INVENTORY_SYNC),
  productSync: lazyQueue<ProductSyncJob>(QueueName.PRODUCT_SYNC),
  webhookProcessing: lazyQueue<WebhookProcessingJob>(QueueName.WEBHOOK_PROCESSING),
  batchOperations: lazyQueue<BatchOperationJob>(QueueName.BATCH_OPERATIONS),
  conflictResolution: lazyQueue<ConflictResolutionJob>(QueueName.CONFLICT_RESOLUTION),
  scheduledSync: lazyQueue<ScheduledSyncJob>(QueueName.SCHEDULED_SYNC),
};

/**
 * Lazy queue events factory
 */
function lazyQueueEvents(name: QueueName): QueueEvents {
  let _events: QueueEvents | null = null;
  return new Proxy({} as QueueEvents, {
    get(_target, prop, receiver) {
      if (!_events) {
        _events = new QueueEvents(name, {
          connection: createBullMQConnection(),
        });
      }
      return Reflect.get(_events, prop, receiver);
    },
  });
}

/**
 * Queue Events for monitoring (lazy-initialized)
 */
export const queueEvents = {
  inventorySync: lazyQueueEvents(QueueName.INVENTORY_SYNC),
  productSync: lazyQueueEvents(QueueName.PRODUCT_SYNC),
  webhookProcessing: lazyQueueEvents(QueueName.WEBHOOK_PROCESSING),
  batchOperations: lazyQueueEvents(QueueName.BATCH_OPERATIONS),
  conflictResolution: lazyQueueEvents(QueueName.CONFLICT_RESOLUTION),
  scheduledSync: lazyQueueEvents(QueueName.SCHEDULED_SYNC),
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
      priority: 1,
      jobId: data.webhookEventId,
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
      priority: 5,
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
        every: intervalMinutes * 60 * 1000,
      },
      jobId: `scheduled-sync-${data.storeId}`,
    }
  );
}

/**
 * Get queue statistics
 */
export async function getQueueStats(queue: Queue) {
  if (!isRedisAvailable) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
  }
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
  if (!isRedisAvailable) {
    const empty = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
    return {
      inventorySync: empty,
      productSync: empty,
      webhookProcessing: empty,
      batchOperations: empty,
      conflictResolution: empty,
      scheduledSync: empty,
    };
  }

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
  if (!isRedisAvailable) return;

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

process.on("SIGINT", async () => {
  await shutdownQueues();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownQueues();
  process.exit(0);
});

export default queues;
