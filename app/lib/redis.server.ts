/**
 * Redis Client Configuration
 *
 * Provides a singleton Redis client for:
 * - BullMQ job queues
 * - Caching
 * - Rate limiting
 * - Session management
 */

import Redis, { type RedisOptions } from "ioredis";

/**
 * Redis connection configuration
 */
const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || "0"),
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: true,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) {
      // Only reconnect when the error contains "READONLY"
      return true;
    }
    return false;
  },
};

/**
 * Create Redis client instance
 */
function createRedisClient(): Redis {
  const client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis(redisConfig);

  client.on("connect", () => {
    console.log("Redis client connected");
  });

  client.on("error", (error) => {
    console.error("Redis client error:", error);
  });

  client.on("ready", () => {
    console.log("Redis client ready");
  });

  client.on("close", () => {
    console.log("Redis connection closed");
  });

  return client;
}

/**
 * Singleton Redis client for general use
 */
export const redis = createRedisClient();

/**
 * Create separate Redis connections for BullMQ
 * BullMQ requires dedicated connections for different purposes
 */
export function createBullMQConnection(): Redis {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return new Redis({ ...redisConfig, maxRetriesPerRequest: null });
}

/**
 * Redis health check
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch (error) {
    console.error("Redis health check failed:", error);
    return false;
  }
}

/**
 * Cache helpers
 */
export const cache = {
  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  },

  /**
   * Set a cached value with optional TTL (in seconds)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  },

  /**
   * Delete a cached value
   */
  async delete(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  },

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  },

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists check error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * Increment a counter
   */
  async increment(key: string, by: number = 1): Promise<number> {
    try {
      return await redis.incrby(key, by);
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  },

  /**
   * Set expiration on a key
   */
  async expire(key: string, seconds: number): Promise<void> {
    try {
      await redis.expire(key, seconds);
    } catch (error) {
      console.error(`Cache expire error for key ${key}:`, error);
    }
  },
};

/**
 * Rate limiting helper using Redis
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  try {
    // Use Redis transaction for atomic operations
    const multi = redis.multi();

    // Remove old entries outside the window
    multi.zremrangebyscore(key, 0, now - windowMs);

    // Count requests in the current window
    multi.zcard(key);

    // Add current request
    multi.zadd(key, now, `${now}`);

    // Set expiration
    multi.expire(key, windowSeconds);

    const results = await multi.exec();

    if (!results) {
      throw new Error("Redis transaction failed");
    }

    const count = (results[1][1] as number) || 0;
    const allowed = count < limit;
    const remaining = Math.max(0, limit - count - 1);
    const resetAt = new Date(now + windowMs);

    return { allowed, remaining, resetAt };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // Fail open - allow the request if Redis is down
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + windowMs),
    };
  }
}

/**
 * Distributed lock using Redis
 */
export class RedisLock {
  private key: string;
  private value: string;
  private ttl: number;

  constructor(lockKey: string, ttlSeconds: number = 30) {
    this.key = `lock:${lockKey}`;
    this.value = `${Date.now()}-${Math.random()}`;
    this.ttl = ttlSeconds;
  }

  /**
   * Acquire the lock
   */
  async acquire(): Promise<boolean> {
    try {
      const result = await redis.set(
        this.key,
        this.value,
        "EX",
        this.ttl,
        "NX"
      );
      return result === "OK";
    } catch (error) {
      console.error("Lock acquire error:", error);
      return false;
    }
  }

  /**
   * Release the lock
   */
  async release(): Promise<void> {
    try {
      // Only delete if we own the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, this.key, this.value);
    } catch (error) {
      console.error("Lock release error:", error);
    }
  }

  /**
   * Extend the lock TTL
   */
  async extend(additionalSeconds: number): Promise<boolean> {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await redis.eval(
        script,
        1,
        this.key,
        this.value,
        additionalSeconds
      );
      return result === 1;
    } catch (error) {
      console.error("Lock extend error:", error);
      return false;
    }
  }
}

/**
 * Graceful shutdown
 */
async function disconnectRedis() {
  await redis.quit();
  console.log("Redis connection closed");
}

process.on("SIGINT", async () => {
  await disconnectRedis();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await disconnectRedis();
  process.exit(0);
});

export default redis;
