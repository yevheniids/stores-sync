/**
 * Prisma Mock
 *
 * Mock Prisma client for testing database operations
 */

import { vi } from "vitest";

// Mock data stores
export const mockData = {
  stores: new Map(),
  products: new Map(),
  inventory: new Map(),
  productStoreMappings: new Map(),
  webhookEvents: new Map(),
  syncOperations: new Map(),
  conflicts: new Map(),
};

// Helper to reset all mock data
export const resetMockData = () => {
  mockData.stores.clear();
  mockData.products.clear();
  mockData.inventory.clear();
  mockData.productStoreMappings.clear();
  mockData.webhookEvents.clear();
  mockData.syncOperations.clear();
  mockData.conflicts.clear();
};

// Create mock Prisma client
export const createMockPrismaClient = () => ({
  store: {
    findUnique: vi.fn(({ where }) => {
      if (where.id) return mockData.stores.get(where.id) || null;
      if (where.shopDomain) {
        return (
          Array.from(mockData.stores.values()).find(
            (s: any) => s.shopDomain === where.shopDomain
          ) || null
        );
      }
      return null;
    }),
    findMany: vi.fn(() => Array.from(mockData.stores.values())),
    create: vi.fn(({ data }) => {
      const store = { ...data, id: `store-${Date.now()}`, createdAt: new Date(), updatedAt: new Date() };
      mockData.stores.set(store.id, store);
      return store;
    }),
    update: vi.fn(({ where, data }) => {
      const store = mockData.stores.get(where.id);
      if (!store) throw new Error("Store not found");
      const updated = { ...store, ...data, updatedAt: new Date() };
      mockData.stores.set(where.id, updated);
      return updated;
    }),
    count: vi.fn(() => mockData.stores.size),
  },

  product: {
    findUnique: vi.fn(({ where, include }) => {
      let product = where.id ? mockData.products.get(where.id) : null;
      if (where.sku) {
        product = Array.from(mockData.products.values()).find((p: any) => p.sku === where.sku) || null;
      }
      if (!product) return null;

      // Add relations if requested
      if (include) {
        const result = { ...product };
        if (include.inventory) {
          result.inventory = Array.from(mockData.inventory.values()).find(
            (inv: any) => inv.productId === product.id
          ) || null;
        }
        if (include.storeMappings) {
          result.storeMappings = Array.from(mockData.productStoreMappings.values()).filter(
            (m: any) => m.productId === product.id
          );
          if (include.storeMappings.include?.store) {
            result.storeMappings = result.storeMappings.map((m: any) => ({
              ...m,
              store: mockData.stores.get(m.storeId),
            }));
          }
        }
        return result;
      }
      return product;
    }),
    findMany: vi.fn(() => Array.from(mockData.products.values())),
    create: vi.fn(({ data }) => {
      const product = {
        ...data,
        id: `product-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockData.products.set(product.id, product);
      return product;
    }),
    upsert: vi.fn(({ where, create, update }) => {
      let product = where.sku
        ? Array.from(mockData.products.values()).find((p: any) => p.sku === where.sku)
        : null;

      if (product) {
        product = { ...product, ...update, updatedAt: new Date() };
        mockData.products.set(product.id, product);
      } else {
        product = {
          ...create,
          id: `product-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockData.products.set(product.id, product);
      }
      return product;
    }),
    count: vi.fn(() => mockData.products.size),
  },

  inventory: {
    findUnique: vi.fn(({ where }) => {
      return mockData.inventory.get(where.id || where.productId) || null;
    }),
    create: vi.fn(({ data }) => {
      const inventory = {
        ...data,
        id: `inventory-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockData.inventory.set(inventory.id, inventory);
      return inventory;
    }),
    update: vi.fn(({ where, data }) => {
      const inventory = mockData.inventory.get(where.id);
      if (!inventory) throw new Error("Inventory not found");
      const updated = { ...inventory, ...data, updatedAt: new Date() };
      mockData.inventory.set(where.id, updated);
      return updated;
    }),
    upsert: vi.fn(({ where, create, update }) => {
      let inventory = mockData.inventory.get(where.productId);

      if (inventory) {
        inventory = { ...inventory, ...update, updatedAt: new Date() };
        mockData.inventory.set(inventory.id, inventory);
      } else {
        inventory = {
          ...create,
          id: `inventory-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockData.inventory.set(inventory.id, inventory);
      }
      return inventory;
    }),
  },

  productStoreMapping: {
    findUnique: vi.fn(({ where, include }) => {
      const key = `${where.productId_storeId?.productId}-${where.productId_storeId?.storeId}`;
      const mapping = mockData.productStoreMappings.get(key) || null;

      if (!mapping) return null;

      if (include) {
        const result = { ...mapping };
        if (include.product) {
          result.product = mockData.products.get(mapping.productId);
        }
        if (include.store) {
          result.store = mockData.stores.get(mapping.storeId);
        }
        return result;
      }
      return mapping;
    }),
    findFirst: vi.fn(({ where, include }) => {
      const mappings = Array.from(mockData.productStoreMappings.values()).filter((m: any) => {
        if (where.storeId && m.storeId !== where.storeId) return false;
        if (where.productId && m.productId !== where.productId) return false;
        if (where.shopifyInventoryItemId && m.shopifyInventoryItemId !== where.shopifyInventoryItemId) return false;
        return true;
      });

      const mapping = mappings[0] || null;
      if (!mapping) return null;

      if (include) {
        const result = { ...mapping };
        if (include.product) {
          result.product = mockData.products.get(mapping.productId);
          if (include.product.include?.inventory) {
            result.product.inventory = Array.from(mockData.inventory.values()).find(
              (inv: any) => inv.productId === mapping.productId
            );
          }
        }
        return result;
      }
      return mapping;
    }),
    findMany: vi.fn(({ where, include }) => {
      let mappings = Array.from(mockData.productStoreMappings.values());
      if (where?.productId) {
        mappings = mappings.filter((m: any) => m.productId === where.productId);
      }

      if (include) {
        return mappings.map((m: any) => {
          const result = { ...m };
          if (include.store) {
            result.store = mockData.stores.get(m.storeId);
          }
          if (include.product) {
            result.product = mockData.products.get(m.productId);
          }
          return result;
        });
      }
      return mappings;
    }),
    create: vi.fn(({ data }) => {
      const mapping = {
        ...data,
        id: `mapping-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const key = `${data.productId}-${data.storeId}`;
      mockData.productStoreMappings.set(key, mapping);
      return mapping;
    }),
    upsert: vi.fn(({ where, create, update }) => {
      const key = `${where.productId_storeId.productId}-${where.productId_storeId.storeId}`;
      let mapping = mockData.productStoreMappings.get(key);

      if (mapping) {
        mapping = { ...mapping, ...update, updatedAt: new Date() };
      } else {
        mapping = {
          ...create,
          id: `mapping-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      mockData.productStoreMappings.set(key, mapping);
      return mapping;
    }),
  },

  webhookEvent: {
    findUnique: vi.fn(({ where }) => {
      return (
        Array.from(mockData.webhookEvents.values()).find((e: any) => e.eventId === where.eventId) || null
      );
    }),
    create: vi.fn(({ data }) => {
      const event = {
        ...data,
        id: `webhook-${Date.now()}`,
        receivedAt: new Date(),
        createdAt: new Date(),
        maxRetries: data.maxRetries || 3,
      };
      mockData.webhookEvents.set(event.id, event);
      return event;
    }),
    upsert: vi.fn(({ where, create, update }) => {
      let event = Array.from(mockData.webhookEvents.values()).find(
        (e: any) => e.eventId === where.eventId
      );

      if (event) {
        event = { ...event, ...update };
        mockData.webhookEvents.set(event.id, event);
      } else {
        event = {
          ...create,
          id: `webhook-${Date.now()}`,
          receivedAt: new Date(),
          createdAt: new Date(),
          maxRetries: create.maxRetries || 3,
        };
        mockData.webhookEvents.set(event.id, event);
      }
      return event;
    }),
    update: vi.fn(({ where, data }) => {
      const event = mockData.webhookEvents.get(where.eventId);
      if (!event) throw new Error("Webhook event not found");
      const updated = { ...event, ...data };
      mockData.webhookEvents.set(where.eventId, updated);
      return updated;
    }),
    deleteMany: vi.fn(({ where }) => {
      const oldCount = mockData.webhookEvents.size;
      const entries = Array.from(mockData.webhookEvents.entries());
      entries.forEach(([id, event]: [any, any]) => {
        if (where.processed === true && event.processed === true) {
          if (where.receivedAt?.lt && event.receivedAt < where.receivedAt.lt) {
            mockData.webhookEvents.delete(id);
          }
        }
      });
      return { count: oldCount - mockData.webhookEvents.size };
    }),
    count: vi.fn(() => mockData.webhookEvents.size),
  },

  syncOperation: {
    findFirst: vi.fn(({ where, orderBy }) => {
      const ops = Array.from(mockData.syncOperations.values()).filter((op: any) => {
        if (where.productId && op.productId !== where.productId) return false;
        if (where.storeId && op.storeId !== where.storeId) return false;
        if (where.status && op.status !== where.status) return false;
        if (where.operationType && op.operationType !== where.operationType) return false;
        if (where.completedAt?.gte && op.completedAt < where.completedAt.gte) return false;
        return true;
      });

      if (orderBy?.completedAt === "desc") {
        ops.sort((a: any, b: any) => b.completedAt - a.completedAt);
      }

      return ops[0] || null;
    }),
    findMany: vi.fn(({ where, orderBy, take, include }) => {
      let ops = Array.from(mockData.syncOperations.values()).filter((op: any) => {
        if (where?.productId && op.productId !== where.productId) return false;
        if (where?.storeId && op.storeId !== where.storeId) return false;
        if (where?.status && op.status !== where.status) return false;
        if (where?.completedAt?.gte && op.completedAt < where.completedAt.gte) return false;
        return true;
      });

      if (orderBy?.startedAt === "desc") {
        ops.sort((a: any, b: any) => b.startedAt - a.startedAt);
      }

      if (take) {
        ops = ops.slice(0, take);
      }

      if (include) {
        return ops.map((op: any) => {
          const result = { ...op };
          if (include.product) result.product = mockData.products.get(op.productId);
          if (include.store) result.store = mockData.stores.get(op.storeId);
          return result;
        });
      }

      return ops;
    }),
    create: vi.fn(({ data }) => {
      const op = {
        ...data,
        id: `sync-${Date.now()}`,
        createdAt: new Date(),
      };
      mockData.syncOperations.set(op.id, op);
      return op;
    }),
    update: vi.fn(({ where, data }) => {
      const op = mockData.syncOperations.get(where.id);
      if (!op) throw new Error("Sync operation not found");
      const updated = { ...op, ...data };
      mockData.syncOperations.set(where.id, updated);
      return updated;
    }),
    count: vi.fn(({ where }) => {
      if (!where) return mockData.syncOperations.size;
      return Array.from(mockData.syncOperations.values()).filter((op: any) => {
        if (where.storeId && op.storeId !== where.storeId) return false;
        if (where.status && op.status !== where.status) return false;
        return true;
      }).length;
    }),
  },

  conflict: {
    findUnique: vi.fn(({ where, include }) => {
      const conflict = mockData.conflicts.get(where.id) || null;
      if (!conflict) return null;

      if (include) {
        const result = { ...conflict };
        if (include.product) {
          result.product = mockData.products.get(conflict.productId);
          if (include.product.include?.inventory) {
            result.product.inventory = Array.from(mockData.inventory.values()).find(
              (inv: any) => inv.productId === conflict.productId
            );
          }
        }
        if (include.store) {
          result.store = mockData.stores.get(conflict.storeId);
        }
        return result;
      }
      return conflict;
    }),
    findMany: vi.fn(({ where, orderBy, include }) => {
      let conflicts = Array.from(mockData.conflicts.values()).filter((c: any) => {
        if (where?.resolved !== undefined && c.resolved !== where.resolved) return false;
        if (where?.productId && c.productId !== where.productId) return false;
        if (where?.storeId && c.storeId !== where.storeId) return false;
        if (where?.conflictType && c.conflictType !== where.conflictType) return false;
        return true;
      });

      if (orderBy?.detectedAt === "desc") {
        conflicts.sort((a: any, b: any) => b.detectedAt - a.detectedAt);
      }

      if (include) {
        return conflicts.map((c: any) => {
          const result = { ...c };
          if (include.product) result.product = mockData.products.get(c.productId);
          if (include.store) result.store = mockData.stores.get(c.storeId);
          return result;
        });
      }

      return conflicts;
    }),
    create: vi.fn(({ data }) => {
      const conflict = {
        ...data,
        id: `conflict-${Date.now()}`,
        detectedAt: new Date(),
        resolved: data.resolved || false,
      };
      mockData.conflicts.set(conflict.id, conflict);
      return conflict;
    }),
    update: vi.fn(({ where, data }) => {
      const conflict = mockData.conflicts.get(where.id);
      if (!conflict) throw new Error("Conflict not found");
      const updated = { ...conflict, ...data };
      mockData.conflicts.set(where.id, updated);
      return updated;
    }),
    count: vi.fn(({ where }) => {
      if (!where) return mockData.conflicts.size;
      return Array.from(mockData.conflicts.values()).filter((c: any) => {
        if (where.resolved !== undefined && c.resolved !== where.resolved) return false;
        if (where.productId && c.productId !== where.productId) return false;
        if (where.storeId && c.storeId !== where.storeId) return false;
        return true;
      }).length;
    }),
  },

  $transaction: vi.fn(async (callback) => {
    // Simple transaction mock - just execute the callback with the mock client
    return callback(createMockPrismaClient());
  }),
});

export const mockPrisma = createMockPrismaClient();
