/**
 * Global Test Setup
 *
 * Runs before all tests to configure the test environment
 */

import { beforeAll, afterAll, afterEach, vi } from "vitest";
import "@testing-library/jest-dom";

// Mock environment variables
process.env.NODE_ENV = "test";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

// Global test setup
beforeAll(() => {
  // Mock console methods to reduce noise in test output
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});

  // Allow console.error and console.warn for debugging
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Global test teardown
afterAll(() => {
  vi.restoreAllMocks();
});
