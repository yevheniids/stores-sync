# Test Suite for Shopify Inventory Sync App

This directory contains the complete test suite for the multi-store inventory synchronization application.

## Test Structure

```
tests/
├── setup.ts                           # Global test setup
├── mocks/                             # Test mocks and fixtures
│   ├── prisma.ts                      # Prisma client mock
│   ├── shopify.ts                     # Shopify API mocks
│   ├── queue.ts                       # BullMQ queue mocks
│   └── fixtures.ts                    # Test data fixtures
├── unit/                              # Unit tests
│   ├── sync-engine.test.ts
│   ├── conflict-resolver.test.ts
│   ├── product-mapper.test.ts
│   ├── idempotency.test.ts
│   └── inventory-queries.test.ts
├── integration/                       # Integration tests
│   ├── webhook-processing.test.ts
│   └── full-sync.test.ts
└── e2e/                              # End-to-end tests
    └── sync-cycle.test.ts
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### E2E Tests Only
```bash
npm run test:e2e
```

### Coverage Report
```bash
npm run test:coverage
```

### Interactive UI
```bash
npm run test:ui
```

### Watch Mode (for development)
```bash
npm test -- --watch
```

## Test Categories

### Unit Tests
Unit tests focus on individual functions and modules in isolation. They use mocks for all external dependencies (database, Shopify API, queues).

**Coverage:**
- `sync-engine.test.ts`: Core sync engine logic
- `conflict-resolver.test.ts`: Conflict detection and resolution
- `product-mapper.test.ts`: SKU-based product mapping
- `idempotency.test.ts`: Webhook idempotency handling
- `inventory-queries.test.ts`: Database query functions

**Key Features:**
- Fast execution (no external dependencies)
- Comprehensive edge case coverage
- Isolated testing of business logic

### Integration Tests
Integration tests verify that multiple components work together correctly. They still use mocks but test more complex workflows.

**Coverage:**
- `webhook-processing.test.ts`: Full webhook processing pipeline
  - Order created webhook flow
  - Order cancelled webhook flow
  - Refund created webhook flow
  - Inventory update webhook flow
  - HMAC validation
  - Idempotency checks
  - Error handling and retries

- `full-sync.test.ts`: Multi-store synchronization
  - Discrepancy detection and correction
  - Multiple store coordination
  - Sync operation recording
  - Concurrent operations
  - Partial failure handling

**Key Features:**
- Tests component interactions
- Verifies data flow between modules
- Tests error propagation and recovery

### E2E Tests (Skeleton)
End-to-end tests verify the complete system behavior from webhook reception to final state. These tests require a real test database and Redis instance.

**Coverage (TODO):**
- Complete order lifecycle
- Manual inventory adjustments
- Conflict detection and resolution
- Multi-store synchronization
- Webhook idempotency
- Product discovery
- Performance and scalability
- Error recovery
- Store lifecycle
- Data integrity
- Audit trail

**Setup Required:**
1. Test PostgreSQL database
2. Test Redis instance
3. Test Shopify stores or API mocks

**Environment Variables:**
```bash
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/test_db
TEST_REDIS_URL=redis://localhost:6379
TEST_SHOPIFY_STORE_A=test-store-a.myshopify.com
TEST_SHOPIFY_STORE_B=test-store-b.myshopify.com
```

## Test Mocks

### Prisma Mock (`tests/mocks/prisma.ts`)
Provides an in-memory mock of the Prisma client with full CRUD operations for all models.

**Features:**
- Typed mock functions
- In-memory data stores
- Transaction support
- Relation handling
- Realistic query behavior

**Usage:**
```typescript
import { mockPrisma, mockData, resetMockData } from "../mocks/prisma";

beforeEach(() => {
  resetMockData();
  mockData.products.set(product.id, product);
});
```

### Shopify Mock (`tests/mocks/shopify.ts`)
Mocks Shopify GraphQL API and authentication.

**Features:**
- GraphQL client mock
- Session management
- Authentication mocks
- Inventory API mocks
- Configurable responses

**Usage:**
```typescript
import { mockInventoryAPI, mockSessionStorage } from "../mocks/shopify";

mockInventoryAPI.updateInventoryLevel.mockResolvedValue(undefined);
```

### Queue Mock (`tests/mocks/queue.ts`)
Mocks BullMQ queues and workers.

**Features:**
- Job enqueueing
- Worker simulation
- Job lifecycle
- Event handlers

**Usage:**
```typescript
import { mockQueues, resetMockQueues } from "../mocks/queue";

const job = await mockQueues.webhookProcessing.add("job-name", data);
```

### Fixtures (`tests/mocks/fixtures.ts`)
Provides reusable test data for consistent testing.

**Includes:**
- Sample stores (Store A, Store B, Store C)
- Sample products with SKUs
- Inventory records
- Product-store mappings
- Webhook payloads (orders, refunds, inventory updates)
- Sync operations
- Conflicts

**Usage:**
```typescript
import { storeA, productWithSku001, orderCreatedPayload } from "../mocks/fixtures";

mockData.stores.set(storeA.id, storeA);
```

## Writing New Tests

### Unit Test Template
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { functionToTest } from "~/lib/module.server";
import { mockPrisma, resetMockData } from "../mocks/prisma";

vi.mock("~/db.server", () => ({ prisma: mockPrisma }));

describe("Module Name", () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();
  });

  describe("functionToTest", () => {
    it("should handle happy path", async () => {
      // Arrange
      const input = { /* test data */ };

      // Act
      const result = await functionToTest(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("should handle error case", async () => {
      // Test error scenarios
    });
  });
});
```

### Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Reset**: Always reset mocks and data in `beforeEach`
3. **Clear Names**: Use descriptive test names that explain expected behavior
4. **AAA Pattern**: Arrange, Act, Assert
5. **Edge Cases**: Test both happy paths and error scenarios
6. **Async**: Use async/await consistently
7. **Mocking**: Mock external dependencies (database, API, queues)
8. **Fixtures**: Use fixtures for consistent test data

## Coverage Goals

- **Unit Tests**: >90% code coverage
- **Integration Tests**: >80% workflow coverage
- **E2E Tests**: All critical user journeys

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Scheduled nightly runs (E2E tests)

## Debugging Tests

### Run specific test file
```bash
npm test tests/unit/sync-engine.test.ts
```

### Run specific test case
```bash
npm test -t "should correctly update central inventory"
```

### Enable verbose logging
```bash
npm test -- --reporter=verbose
```

### Debug with breakpoints
```bash
node --inspect-brk node_modules/.bin/vitest run
```

## Common Issues

### "Module not found" errors
- Check that tsconfig paths are configured correctly
- Verify vitest.config.ts resolve.alias matches tsconfig paths

### Mock not working
- Ensure vi.mock() is called before importing the module
- Check that mock path matches import path exactly

### Async test timeout
- Increase timeout: `it("test", async () => { ... }, 10000)`
- Check for unresolved promises

### Flaky tests
- Ensure proper cleanup in afterEach
- Avoid relying on timing (use proper async patterns)
- Reset all mocks between tests

## Future Enhancements

- [ ] Add snapshot testing for complex objects
- [ ] Implement E2E test infrastructure
- [ ] Add performance benchmarks
- [ ] Visual regression tests for UI components
- [ ] Contract tests for Shopify API
- [ ] Chaos testing for resilience
