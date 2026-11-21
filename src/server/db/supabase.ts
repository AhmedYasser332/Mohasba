import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RuntimeConfig } from '../config';

/**
 * Creates an HTTP-only server Supabase client using `SUPABASE_SERVICE_ROLE_KEY`.
 * Compatible with Node 20 and Web Standard runtimes.
 */
export function createServerSupabaseClient(
  config: Pick<RuntimeConfig, 'supabaseUrl' | 'supabaseServiceRoleKey'>,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
