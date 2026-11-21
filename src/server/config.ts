export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  cronSecret: string | null;
  appUrl: string | null;
  appPasscode: string | null;
  ntfyTopicUrl: string | null;
  allowUnauthenticated: boolean;
  nodeEnv: string;
  isProduction: boolean;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Loads server runtime configuration from an injected env map (defaults to `process.env`).
 * Keeps `src/server/*` free of hidden globals for Node 20 and Cloudflare Workers parity.
 */
export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseServiceRoleKey = trimToNull(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl) {
    throw new Error('Missing required environment variable: SUPABASE_URL');
  }
  if (!supabaseServiceRoleKey) {
    throw new Error(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  const nodeEnv = trimToNull(env.NODE_ENV) ?? 'development';

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    cronSecret: trimToNull(env.CRON_SECRET),
    appUrl: trimToNull(env.APP_URL),
    appPasscode: trimToNull(env.APP_PASSCODE),
    ntfyTopicUrl: trimToNull(env.NTFY_TOPIC_URL),
    allowUnauthenticated:
      env.ALLOW_UNAUTHENTICATED?.trim().toLowerCase() === 'true',
    nodeEnv,
    isProduction: nodeEnv === 'production',
  };
}
