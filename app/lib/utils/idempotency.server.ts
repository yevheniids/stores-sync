/**
 * Idempotency Utilities
 *
 * Ensures webhook events are only processed once using the WebhookEvent table.
 * Prevents duplicate processing when Shopify retries webhook deliveries.
 */

import { prisma } from "~/db.server";
import { logger } from "~/lib/logger.server";

/**
 * Check if a webhook event has already been processed
 */
export async function isProcessed(eventId: string): Promise<boolean> {
  try {
    const event = await prisma.webhookEvent.findUnique({
      where: { eventId },
      select: { processed: true },
    });

    return event?.processed ?? false;
  } catch (error) {
    logger.error("Failed to check webhook event processing status", error, {
      eventId,
    });
    // Fail open - assume not processed to avoid missing events
    return false;
  }
}

/**
 * Mark a webhook event as processed
 */
export async function markProcessed(
  eventId: string,
  topic: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  try {
    await prisma.webhookEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        topic,
        shopDomain,
        payload,
        processed: true,
        processedAt: new Date(),
        retryCount: 0,
      },
      update: {
        processed: true,
        processedAt: new Date(),
      },
    });

    logger.debug("Webhook event marked as processed", { eventId, topic, shopDomain });
  } catch (error) {
    logger.error("Failed to mark webhook event as processed", error, {
      eventId,
      topic,
      shopDomain,
    });
    throw error;
  }
}

/**
 * Mark a webhook event as failed
 */
export async function markFailed(
  eventId: string,
  errorMessage: string
): Promise<void> {
  try {
    const event = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (!event) {
      logger.warn("Attempted to mark non-existent webhook event as failed", {
        eventId,
      });
      return;
    }

    const newRetryCount = event.retryCount + 1;
    const shouldGiveUp = newRetryCount >= event.maxRetries;

    await prisma.webhookEvent.update({
      where: { eventId },
      data: {
        errorMessage,
        retryCount: newRetryCount,
        processed: shouldGiveUp, // Mark as processed if we've exhausted retries
        processedAt: shouldGiveUp ? new Date() : null,
      },
    });

    if (shouldGiveUp) {
      logger.error("Webhook event failed after max retries", undefined, {
        eventId,
        retryCount: newRetryCount,
        maxRetries: event.maxRetries,
        errorMessage,
      });
    } else {
      logger.warn("Webhook event processing failed, will retry", {
        eventId,
        retryCount: newRetryCount,
        maxRetries: event.maxRetries,
        errorMessage,
      });
    }
  } catch (error) {
    logger.error("Failed to mark webhook event as failed", error, {
      eventId,
      errorMessage,
    });
    throw error;
  }
}

/**
 * Create a webhook event record for tracking
 */
export async function createWebhookEvent(
  eventId: string,
  topic: string,
  shopDomain: string,
  payload: any
): Promise<void> {
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId,
        topic,
        shopDomain,
        payload,
        processed: false,
        retryCount: 0,
      },
    });

    logger.debug("Webhook event record created", { eventId, topic, shopDomain });
  } catch (error) {
    // Ignore unique constraint violations (duplicate webhook deliveries)
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      logger.debug("Duplicate webhook event received", { eventId, topic, shopDomain });
      return;
    }

    logger.error("Failed to create webhook event record", error, {
      eventId,
      topic,
      shopDomain,
    });
    throw error;
  }
}

/**
 * Get retry count for a webhook event
 */
export async function getRetryCount(eventId: string): Promise<number> {
  try {
    const event = await prisma.webhookEvent.findUnique({
      where: { eventId },
      select: { retryCount: true },
    });

    return event?.retryCount ?? 0;
  } catch (error) {
    logger.error("Failed to get webhook event retry count", error, { eventId });
    return 0;
  }
}

/**
 * Check if a webhook event should be retried
 */
export async function shouldRetry(eventId: string): Promise<boolean> {
  try {
    const event = await prisma.webhookEvent.findUnique({
      where: { eventId },
      select: { retryCount: true, maxRetries: true, processed: true },
    });

    if (!event) {
      return true; // First attempt
    }

    if (event.processed) {
      return false; // Already processed successfully or gave up
    }

    return event.retryCount < event.maxRetries;
  } catch (error) {
    logger.error("Failed to check if webhook event should retry", error, {
      eventId,
    });
    return true; // Fail open - allow retry
  }
}

/**
 * Cleanup old webhook events (older than 7 days)
 * This should be run periodically to prevent table bloat
 */
export async function cleanupOldEvents(): Promise<number> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await prisma.webhookEvent.deleteMany({
      where: {
        receivedAt: {
          lt: sevenDaysAgo,
        },
        processed: true,
      },
    });

    logger.info(`Cleaned up ${result.count} old webhook events`, {
      olderThan: sevenDaysAgo.toISOString(),
      count: result.count,
    });

    return result.count;
  } catch (error) {
    logger.error("Failed to cleanup old webhook events", error);
    return 0;
  }
}

/**
 * Get webhook event statistics
 */
export async function getWebhookStats() {
  try {
    const [total, processed, failed, pending] = await Promise.all([
      prisma.webhookEvent.count(),
      prisma.webhookEvent.count({ where: { processed: true } }),
      prisma.webhookEvent.count({
        where: {
          processed: false,
          retryCount: { gte: prisma.webhookEvent.fields.maxRetries },
        },
      }),
      prisma.webhookEvent.count({
        where: { processed: false },
      }),
    ]);

    return {
      total,
      processed,
      failed,
      pending,
      successRate: total > 0 ? ((processed / total) * 100).toFixed(2) : "0.00",
    };
  } catch (error) {
    logger.error("Failed to get webhook statistics", error);
    return {
      total: 0,
      processed: 0,
      failed: 0,
      pending: 0,
      successRate: "0.00",
    };
  }
}

export default {
  isProcessed,
  markProcessed,
  markFailed,
  createWebhookEvent,
  getRetryCount,
  shouldRetry,
  cleanupOldEvents,
  getWebhookStats,
};
