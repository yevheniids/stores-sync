/**
 * Supabase Client Configuration
 *
 * Provides Supabase client for:
 * - Real-time subscriptions
 * - Storage (if needed)
 * - Additional database operations
 * - Edge functions (if used)
 *
 * Note: Primary database access is through Prisma
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Validate Supabase environment variables
 */
function validateSupabaseEnvironment() {
  if (!process.env.SUPABASE_URL) {
    console.warn("SUPABASE_URL not set. Real-time features will be disabled.");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY not set. Admin operations will be disabled."
    );
  }
}

validateSupabaseEnvironment();

/**
 * Create Supabase client with service role key (server-side only)
 */
export const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: "public",
    },
  }
);

/**
 * Create Supabase client with anon key (for client-side use)
 */
export function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.SUPABASE_ANON_KEY || "placeholder-key",
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    }
  );
}

/**
 * Real-time subscription helpers
 */
export const realtime = {
  /**
   * Subscribe to inventory changes
   */
  subscribeToInventoryChanges(
    callback: (payload: any) => void
  ): () => void {
    const channel = supabase
      .channel("inventory_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
        },
        callback
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  },

  /**
   * Subscribe to sync operation updates
   */
  subscribeToSyncOperations(
    callback: (payload: any) => void
  ): () => void {
    const channel = supabase
      .channel("sync_operations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sync_operations",
        },
        callback
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  },

  /**
   * Subscribe to conflict detection
   */
  subscribeToConflicts(
    callback: (payload: any) => void
  ): () => void {
    const channel = supabase
      .channel("conflicts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conflicts",
        },
        callback
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  },

  /**
   * Broadcast message to all connected clients
   */
  async broadcast(channel: string, event: string, payload: any): Promise<void> {
    const ch = supabase.channel(channel);
    await ch.send({
      type: "broadcast",
      event,
      payload,
    });
  },
};

/**
 * Storage helpers (if using Supabase Storage)
 */
export const storage = {
  /**
   * Upload a file
   */
  async upload(
    bucket: string,
    path: string,
    file: File | Buffer,
    options?: { contentType?: string; cacheControl?: string }
  ): Promise<{ data: any; error: any }> {
    return await supabase.storage.from(bucket).upload(path, file, options);
  },

  /**
   * Download a file
   */
  async download(
    bucket: string,
    path: string
  ): Promise<{ data: Blob | null; error: any }> {
    return await supabase.storage.from(bucket).download(path);
  },

  /**
   * Delete a file
   */
  async delete(bucket: string, paths: string[]): Promise<{ data: any; error: any }> {
    return await supabase.storage.from(bucket).remove(paths);
  },

  /**
   * Get public URL for a file
   */
  getPublicUrl(bucket: string, path: string): string {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  /**
   * Create signed URL for private file
   */
  async createSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number = 3600
  ): Promise<{ data: { signedUrl: string } | null; error: any }> {
    return await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  },
};

/**
 * Edge function invocation (if using Supabase Edge Functions)
 */
export async function invokeEdgeFunction<T = any>(
  functionName: string,
  payload?: any
): Promise<{ data: T | null; error: any }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: payload,
    });

    return { data, error };
  } catch (error) {
    console.error(`Edge function ${functionName} invocation failed:`, error);
    return { data: null, error };
  }
}

/**
 * Health check for Supabase connection
 */
export async function checkSupabaseHealth(): Promise<boolean> {
  try {
    // Simple query to check connection
    const { error } = await supabase.from("stores").select("count").limit(1);
    return !error;
  } catch (error) {
    console.error("Supabase health check failed:", error);
    return false;
  }
}

export default supabase;
