/**
 * Queue Mocks
 *
 * Mock BullMQ Queue and Worker for testing
 */

import { vi } from "vitest";

// Mock job data
export const mockJobs = new Map();

// Mock job class
export class MockJob {
  id: string;
  data: any;
  opts: any;
  timestamp: number;
  attemptsMade: number;

  constructor(id: string, data: any, opts: any = {}) {
    this.id = id;
    this.data = data;
    this.opts = opts;
    this.timestamp = Date.now();
    this.attemptsMade = 0;
  }

  async remove() {
    mockJobs.delete(this.id);
  }

  async retry() {
    this.attemptsMade++;
  }
}

// Mock Queue class
export class MockQueue {
  name: string;
  handlers: Map<string, Function>;

  constructor(name: string) {
    this.name = name;
    this.handlers = new Map();
  }

  async add(jobName: string, data: any, opts: any = {}) {
    const jobId = opts.jobId || `job-${Date.now()}-${Math.random()}`;
    const job = new MockJob(jobId, data, opts);
    mockJobs.set(jobId, job);
    return job;
  }

  async getJob(jobId: string) {
    return mockJobs.get(jobId) || null;
  }

  async close() {
    // Mock close
  }

  on(event: string, handler: Function) {
    this.handlers.set(event, handler);
  }
}

// Mock Worker class
export class MockWorker {
  name: string;
  processor: Function;
  handlers: Map<string, Function>;
  concurrency: number;

  constructor(name: string, processor: Function, opts: any = {}) {
    this.name = name;
    this.processor = processor;
    this.handlers = new Map();
    this.concurrency = opts.concurrency || 1;
  }

  on(event: string, handler: Function) {
    this.handlers.set(event, handler);
    return this;
  }

  async close() {
    // Mock close
  }

  async processJob(job: MockJob) {
    try {
      await this.processor(job);
      const completedHandler = this.handlers.get("completed");
      if (completedHandler) {
        completedHandler(job);
      }
    } catch (error) {
      const failedHandler = this.handlers.get("failed");
      if (failedHandler) {
        failedHandler(job, error);
      }
      throw error;
    }
  }
}

// Mock queues
export const mockQueues = {
  webhookProcessing: new MockQueue("webhook-processing"),
  batchOperations: new MockQueue("batch-operations"),
  inventorySync: new MockQueue("inventory-sync"),
  productSync: new MockQueue("product-sync"),
};

// Mock queue functions
export const mockQueueFunctions = {
  enqueueOrderCreated: vi.fn((data: any) => mockQueues.webhookProcessing.add("process-order-created", data)),
  enqueueOrderCancelled: vi.fn((data: any) => mockQueues.webhookProcessing.add("process-order-cancelled", data)),
  enqueueRefundCreated: vi.fn((data: any) => mockQueues.webhookProcessing.add("process-refund-created", data)),
  enqueueInventoryUpdate: vi.fn((data: any) => mockQueues.webhookProcessing.add("process-inventory-update", data)),
  enqueueBatchSync: vi.fn((data: any) => mockQueues.batchOperations.add("batch-sync", data)),
};

// Helper to reset mock queues
export const resetMockQueues = () => {
  mockJobs.clear();
  Object.values(mockQueues).forEach((queue) => {
    queue.handlers.clear();
  });
};

// Helper to get all jobs from a queue
export const getQueueJobs = (queueName: string) => {
  return Array.from(mockJobs.values()).filter((job: any) => {
    // Match jobs to queues based on job name patterns
    if (queueName === "webhook-processing") {
      return job.data.topic || job.data.webhookEventId;
    }
    if (queueName === "batch-operations") {
      return job.data.operationType;
    }
    return false;
  });
};
