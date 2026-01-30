/**
 * Redis Client Configuration
 *
 * Provides a singleton Redis client for:
 * - BullMQ job queues
 * - Caching
 * - Rate limiting
 * - Session management
 *
 * Lazy-initialized to avoid crashes in serverless environments (e.g. Vercel)
 * where Redis may not be available.
 */

import Redis, { type RedisOptions } from "ioredis";

/**
 * Whether Redis is configured (REDIS_URL or REDIS_HOST set)
 */
export const isRedisAvailable = !!(process.env.REDIS_URL || process.env.REDIS_HOST);

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
 * Lazy singleton Redis client — only connects when first accessed
 */
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = createRedisClient();
  }
  return _redis;
}

/** @deprecated Use getRedis() for lazy initialization */
export const redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    return Reflect.get(getRedis(), prop, receiver);
  },
});

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
  if (!isRedisAvailable) {
    return false;
  }
  try {
    const result = await getRedis().ping();
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
  async get<T>(key: string): Promise<T | null> {
    if (!isRedisAvailable) return null;
    try {
      const value = await getRedis().get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  },

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (!isRedisAvailable) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await getRedis().setex(key, ttl, serialized);
      } else {
        await getRedis().set(key, serialized);
      }
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  },

  async delete(key: string): Promise<void> {
    if (!isRedisAvailable) return;
    try {
      await getRedis().del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  },

  async deletePattern(pattern: string): Promise<void> {
    if (!isRedisAvailable) return;
    try {
      const keys = await getRedis().keys(pattern);
      if (keys.length > 0) {
        await getRedis().del(...keys);
      }
    } catch (error) {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  },

  async exists(key: string): Promise<boolean> {
    if (!isRedisAvailable) return false;
    try {
      const result = await getRedis().exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists check error for key ${key}:`, error);
      return false;
    }
  },

  async increment(key: string, by: number = 1): Promise<number> {
    if (!isRedisAvailable) return 0;
    try {
      return await getRedis().incrby(key, by);
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  },

  async expire(key: string, seconds: number): Promise<void> {
    if (!isRedisAvailable) return;
    try {
      await getRedis().expire(key, seconds);
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
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (!isRedisAvailable) {
    return { allowed: true, remaining: limit, resetAt: new Date(now + windowMs) };
  }

  const key = `ratelimit:${identifier}`;

  try {
    const multi = getRedis().multi();
    multi.zremrangebyscore(key, 0, now - windowMs);
    multi.zcard(key);
    multi.zadd(key, now, `${now}`);
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

  async acquire(): Promise<boolean> {
    if (!isRedisAvailable) return true; // No-op lock when Redis unavailable
    try {
      const result = await getRedis().set(
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

  async release(): Promise<void> {
    if (!isRedisAvailable) return;
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await getRedis().eval(script, 1, this.key, this.value);
    } catch (error) {
      console.error("Lock release error:", error);
    }
  }

  async extend(additionalSeconds: number): Promise<boolean> {
    if (!isRedisAvailable) return true;
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await getRedis().eval(
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
  if (_redis) {
    await _redis.quit();
    console.log("Redis connection closed");
  }
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
