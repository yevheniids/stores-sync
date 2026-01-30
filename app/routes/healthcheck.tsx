/**
 * Health Check Route
 *
 * Provides health status of the application and its dependencies
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { checkDatabaseHealth } from "~/db.server";
import { checkRedisHealth } from "~/lib/redis.server";
import { checkSupabaseHealth } from "~/lib/supabase.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const checks = await Promise.allSettled([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkSupabaseHealth(),
  ]);

  const [database, redis, supabase] = checks.map((check) =>
    check.status === "fulfilled" ? check.value : false
  );

  const isHealthy = database && redis && supabase;

  return json(
    {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      checks: {
        database: database ? "ok" : "error",
        redis: redis ? "ok" : "error",
        supabase: supabase ? "ok" : "error",
      },
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
};
