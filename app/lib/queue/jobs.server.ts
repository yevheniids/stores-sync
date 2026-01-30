/**
 * Job Queue Functions
 *
 * Functions to enqueue different types of jobs for async processing.
 * Each function wraps the job data and enqueues it to the appropriate queue.
 */

import { queues, type WebhookProcessingJob, type BatchOperationJob } from "~/lib/queue.server";
import type { Job, JobsOptions } from "bullmq";
import { logger } from "~/lib/logger.server";
import type { ShopifyOrder, ShopifyInventoryLevel } from "~/types";

/**
 * Base job options with retry configuration
 */
const baseJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5 seconds
  },
  removeOnComplete: {
    age: 86400, // 24 hours
    count: 1000,
  },
  removeOnFail: {
    age: 604800, // 7 days
    count: 5000,
  },
};

/**
 * Webhook job types
 */
export enum WebhookJobType {
  ORDER_CREATED = "ORDER_CREATED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  REFUND_CREATED = "REFUND_CREATED",
  INVENTORY_UPDATE = "INVENTORY_UPDATE",
}

/**
 * Order created webhook data
 */
export interface OrderCreatedJobData {
  eventId: string;
  shopDomain: string;
  order: ShopifyOrder;
  timestamp: string;
}

/**
 * Order cancelled webhook data
 */
export interface OrderCancelledJobData {
  eventId: string;
  shopDomain: string;
  order: ShopifyOrder;
  timestamp: string;
}

/**
 * Refund created webhook data
 */
export interface RefundCreatedJobData {
  eventId: string;
  shopDomain: string;
  refund: {
    id: number;
    order_id: number;
    refund_line_items: Array<{
      id: number;
      line_item_id: number;
      quantity: number;
      restock_type: "return" | "cancel" | "no_restock";
      line_item: {
        id: number;
        variant_id: number;
        sku: string;
        quantity: number;
      };
    }>;
  };
  timestamp: string;
}

/**
 * Inventory update webhook data
 */
export interface InventoryUpdateJobData {
  eventId: string;
  shopDomain: string;
  inventoryLevel: ShopifyInventoryLevel;
  timestamp: string;
}

/**
 * Enqueue order created job
 * Decreases inventory for each line item in the order
 */
export async function enqueueOrderCreated(
  data: OrderCreatedJobData,
  options?: JobsOptions
): Promise<Job<WebhookProcessingJob>> {
  try {
    const jobData: WebhookProcessingJob = {
      webhookEventId: data.eventId,
      topic: "orders/create",
      shopDomain: data.shopDomain,
      payload: {
        type: WebhookJobType.ORDER_CREATED,
        ...data,
      },
    };

    const job = await queues.webhookProcessing.add(
      "process-order-created",
      jobData,
      {
        ...baseJobOptions,
        ...options,
        priority: 1, // High priority for order processing
        jobId: data.eventId, // Use event ID for idempotency
      }
    );

    logger.job("process-order-created", job.id!, "enqueued", {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
      orderId: data.order.id,
      lineItemCount: data.order.line_items.length,
    });

    return job;
  } catch (error) {
    logger.error("Failed to enqueue order created job", error, {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
    });
    throw error;
  }
}

/**
 * Enqueue order cancelled job
 * Restores inventory for cancelled orders
 */
export async function enqueueOrderCancelled(
  data: OrderCancelledJobData,
  options?: JobsOptions
): Promise<Job<WebhookProcessingJob>> {
  try {
    const jobData: WebhookProcessingJob = {
      webhookEventId: data.eventId,
      topic: "orders/cancelled",
      shopDomain: data.shopDomain,
      payload: {
        type: WebhookJobType.ORDER_CANCELLED,
        ...data,
      },
    };

    const job = await queues.webhookProcessing.add(
      "process-order-cancelled",
      jobData,
      {
        ...baseJobOptions,
        ...options,
        priority: 1, // High priority
        jobId: data.eventId,
      }
    );

    logger.job("process-order-cancelled", job.id!, "enqueued", {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
      orderId: data.order.id,
      lineItemCount: data.order.line_items.length,
    });

    return job;
  } catch (error) {
    logger.error("Failed to enqueue order cancelled job", error, {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
    });
    throw error;
  }
}

/**
 * Enqueue refund created job
 * Restores inventory only for restocked items
 */
export async function enqueueRefundCreated(
  data: RefundCreatedJobData,
  options?: JobsOptions
): Promise<Job<WebhookProcessingJob>> {
  try {
    const jobData: WebhookProcessingJob = {
      webhookEventId: data.eventId,
      topic: "refunds/create",
      shopDomain: data.shopDomain,
      payload: {
        type: WebhookJobType.REFUND_CREATED,
        ...data,
      },
    };

    const job = await queues.webhookProcessing.add(
      "process-refund-created",
      jobData,
      {
        ...baseJobOptions,
        ...options,
        priority: 2, // Medium priority
        jobId: data.eventId,
      }
    );

    logger.job("process-refund-created", job.id!, "enqueued", {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
      refundId: data.refund.id,
      orderId: data.refund.order_id,
      refundLineItemCount: data.refund.refund_line_items.length,
    });

    return job;
  } catch (error) {
    logger.error("Failed to enqueue refund created job", error, {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
    });
    throw error;
  }
}

/**
 * Enqueue inventory update job
 * Handles manual inventory adjustments from Shopify admin
 */
export async function enqueueInventoryUpdate(
  data: InventoryUpdateJobData,
  options?: JobsOptions
): Promise<Job<WebhookProcessingJob>> {
  try {
    const jobData: WebhookProcessingJob = {
      webhookEventId: data.eventId,
      topic: "inventory_levels/update",
      shopDomain: data.shopDomain,
      payload: {
        type: WebhookJobType.INVENTORY_UPDATE,
        ...data,
      },
    };

    const job = await queues.webhookProcessing.add(
      "process-inventory-update",
      jobData,
      {
        ...baseJobOptions,
        ...options,
        priority: 2, // Medium priority
        jobId: data.eventId,
      }
    );

    logger.job("process-inventory-update", job.id!, "enqueued", {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
      inventoryItemId: data.inventoryLevel.inventory_item_id,
      available: data.inventoryLevel.available,
    });

    return job;
  } catch (error) {
    logger.error("Failed to enqueue inventory update job", error, {
      eventId: data.eventId,
      shopDomain: data.shopDomain,
    });
    throw error;
  }
}

/**
 * Enqueue batch sync job
 * For bulk synchronization operations
 */
export async function enqueueBatchSync(
  data: {
    storeId?: string;
    productIds?: string[];
    operationType: "bulk_inventory_update" | "bulk_product_sync" | "initial_sync";
    triggeredBy?: string;
  },
  options?: JobsOptions
): Promise<Job<BatchOperationJob>> {
  try {
    const jobData: BatchOperationJob = {
      operationType: data.operationType,
      storeId: data.storeId,
      productIds: data.productIds,
      data: {
        triggeredBy: data.triggeredBy || "system",
        timestamp: new Date().toISOString(),
      },
    };

    const job = await queues.batchOperations.add(
      "batch-sync",
      jobData,
      {
        ...baseJobOptions,
        ...options,
        priority: 5, // Lower priority than real-time operations
        attempts: 5, // More retries for batch operations
      }
    );

    logger.job("batch-sync", job.id!, "enqueued", {
      operationType: data.operationType,
      storeId: data.storeId,
      productCount: data.productIds?.length,
    });

    return job;
  } catch (error) {
    logger.error("Failed to enqueue batch sync job", error, {
      operationType: data.operationType,
      storeId: data.storeId,
    });
    throw error;
  }
}

/**
 * Get job by ID from any queue
 */
export async function getJobById(
  jobId: string,
  queueName?: string
): Promise<Job | null> {
  try {
    if (queueName === "webhook-processing") {
      return await queues.webhookProcessing.getJob(jobId);
    } else if (queueName === "batch-operations") {
      return await queues.batchOperations.getJob(jobId);
    }

    // Try all queues if queue name not specified
    const job =
      (await queues.webhookProcessing.getJob(jobId)) ||
      (await queues.batchOperations.getJob(jobId)) ||
      (await queues.inventorySync.getJob(jobId)) ||
      (await queues.productSync.getJob(jobId));

    return job || null;
  } catch (error) {
    logger.error("Failed to get job by ID", error, { jobId, queueName });
    return null;
  }
}

/**
 * Cancel a job by ID
 */
export async function cancelJob(jobId: string, queueName?: string): Promise<boolean> {
  try {
    const job = await getJobById(jobId, queueName);

    if (!job) {
      logger.warn("Job not found for cancellation", { jobId, queueName });
      return false;
    }

    await job.remove();
    logger.info("Job cancelled successfully", { jobId, queueName });
    return true;
  } catch (error) {
    logger.error("Failed to cancel job", error, { jobId, queueName });
    return false;
  }
}

/**
 * Retry a failed job
 */
export async function retryJob(jobId: string, queueName?: string): Promise<boolean> {
  try {
    const job = await getJobById(jobId, queueName);

    if (!job) {
      logger.warn("Job not found for retry", { jobId, queueName });
      return false;
    }

    await job.retry();
    logger.info("Job retry initiated", { jobId, queueName });
    return true;
  } catch (error) {
    logger.error("Failed to retry job", error, { jobId, queueName });
    return false;
  }
}

export default {
  enqueueOrderCreated,
  enqueueOrderCancelled,
  enqueueRefundCreated,
  enqueueInventoryUpdate,
  enqueueBatchSync,
  getJobById,
  cancelJob,
  retryJob,
};
