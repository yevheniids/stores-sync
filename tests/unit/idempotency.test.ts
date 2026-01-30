/**
 * Idempotency Unit Tests
 *
 * Tests for webhook idempotency handling
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isProcessed,
  markProcessed,
  markFailed,
  cleanupOldEvents,
} from "~/lib/utils/idempotency.server";
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";

// Mock modules
vi.mock("~/db.server", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/lib/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Idempotency", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();
  });

  describe("isProcessed", () => {
    it("should return false for new events", async () => {
      const result = await isProcessed("new-event-001");

      expect(result).toBe(false);
    });

    it("should return true for already processed events", async () => {
      const event = {
        id: "webhook-001",
        eventId: "processed-event-001",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: true,
        processedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        receivedAt: new Date(),
        createdAt: new Date(),
      };
      mockData.webhookEvents.set(event.id, event);

      const result = await isProcessed("processed-event-001");

      expect(result).toBe(true);
    });

    it("should return false for unprocessed events", async () => {
      const event = {
        id: "webhook-002",
        eventId: "unprocessed-event-001",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: false,
        processedAt: null,
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        receivedAt: new Date(),
        createdAt: new Date(),
      };
      mockData.webhookEvents.set(event.id, event);

      const result = await isProcessed("unprocessed-event-001");

      expect(result).toBe(false);
    });
  });

  describe("markProcessed", () => {
    it("should record event correctly", async () => {
      await markProcessed("event-001", "orders/create", "test-store.myshopify.com", { order_id: 123 });

      const events = Array.from(mockData.webhookEvents.values());
      const event = events.find((e: any) => e.eventId === "event-001");

      expect(event).toBeDefined();
      expect(event.processed).toBe(true);
      expect(event.topic).toBe("orders/create");
      expect(event.shopDomain).toBe("test-store.myshopify.com");
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    it("should update existing event if called twice", async () => {
      // First call
      await markProcessed("event-002", "orders/create", "test-store.myshopify.com", {});

      // Second call
      await markProcessed("event-002", "orders/create", "test-store.myshopify.com", {});

      const events = Array.from(mockData.webhookEvents.values());
      const matchingEvents = events.filter((e: any) => e.eventId === "event-002");

      // Should only have one event (upsert behavior)
      expect(matchingEvents).toHaveLength(1);
      expect(matchingEvents[0].processed).toBe(true);
    });
  });

  describe("markFailed", () => {
    beforeEach(() => {
      const event = {
        id: "webhook-fail",
        eventId: "fail-event-001",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: false,
        processedAt: null,
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        receivedAt: new Date(),
        createdAt: new Date(),
      };
      mockData.webhookEvents.set("webhook-fail", event);
    });

    it("should update status correctly", async () => {
      await markFailed("fail-event-001", "Connection timeout");

      const event = Array.from(mockData.webhookEvents.values()).find(
        (e: any) => e.eventId === "fail-event-001"
      );

      expect(event.errorMessage).toBe("Connection timeout");
      expect(event.retryCount).toBe(1);
      expect(event.processed).toBe(false); // Should not mark as processed yet
    });

    it("should mark as processed after max retries", async () => {
      // Simulate multiple failures
      await markFailed("fail-event-001", "Error 1");
      await markFailed("fail-event-001", "Error 2");
      await markFailed("fail-event-001", "Error 3");

      const event = Array.from(mockData.webhookEvents.values()).find(
        (e: any) => e.eventId === "fail-event-001"
      );

      expect(event.retryCount).toBe(3);
      expect(event.processed).toBe(true); // Should give up after max retries
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    it("should handle non-existent events gracefully", async () => {
      await expect(markFailed("non-existent", "Error")).resolves.not.toThrow();
    });
  });

  describe("cleanupOldEvents", () => {
    it("should remove events older than 7 days", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      // Add old processed event
      const oldEvent = {
        id: "webhook-old",
        eventId: "old-event-001",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: true,
        processedAt: oldDate,
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        receivedAt: oldDate,
        createdAt: oldDate,
      };
      mockData.webhookEvents.set("webhook-old", oldEvent);

      // Add recent processed event
      const recentEvent = {
        id: "webhook-recent",
        eventId: "recent-event-001",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: true,
        processedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        receivedAt: new Date(),
        createdAt: new Date(),
      };
      mockData.webhookEvents.set("webhook-recent", recentEvent);

      const count = await cleanupOldEvents();

      expect(count).toBe(1);
      expect(mockData.webhookEvents.has("webhook-old")).toBe(false);
      expect(mockData.webhookEvents.has("webhook-recent")).toBe(true);
    });

    it("should not remove unprocessed events", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const unprocessedOldEvent = {
        id: "webhook-unprocessed",
        eventId: "unprocessed-old-event",
        topic: "orders/create",
        shopDomain: "test-store.myshopify.com",
        payload: {},
        processed: false,
        processedAt: null,
        retryCount: 2,
        maxRetries: 3,
        errorMessage: "Still retrying",
        receivedAt: oldDate,
        createdAt: oldDate,
      };
      mockData.webhookEvents.set("webhook-unprocessed", unprocessedOldEvent);

      await cleanupOldEvents();

      // Should not delete unprocessed events
      expect(mockData.webhookEvents.has("webhook-unprocessed")).toBe(true);
    });

    it("should return 0 if no events to cleanup", async () => {
      const count = await cleanupOldEvents();

      expect(count).toBe(0);
    });
  });
});
