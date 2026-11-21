import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadTestEnv } from './load-env';

const DEFAULT_APP_SETTINGS = {
  id: 1,
  rollover_mode: 'FAJR',
  iana_timezone: 'Africa/Cairo',
  city_name: 'Cairo',
  latitude: 30.0444,
  longitude: 31.2357,
  calc_method: 'Egyptian',
  asr_madhhab: 'Shafi',
  prayer_offsets: {
    fajr: 0,
    sunrise: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  },
  week_start_day: 6,
  ntfy_master_enabled: false,
  quiet_start_hhmm: null,
  quiet_end_hhmm: null,
  digest_enabled: true,
  digest_hhmm: '22:00',
  backup_reminder_enabled: true,
  onboarding_completed: false,
  last_pruned_date: null,
} as const;

export function assertSafeTestDatabase(): {
  supabaseUrl: string;
  serviceRoleKey: string;
  testRef: string;
} {
  loadTestEnv();

  if (process.env.ALLOW_TEST_DB_RESET !== 'true') {
    throw new Error(
      'Refusing to reset database: ALLOW_TEST_DB_RESET must be "true".',
    );
  }

  const testRef = process.env.TEST_SUPABASE_REF?.trim();
  if (!testRef) {
    throw new Error(
      'Refusing to reset database: TEST_SUPABASE_REF must be set.',
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('Refusing to reset database: SUPABASE_URL must be set.');
  }

  let hostname: string;
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error('Refusing to reset database: SUPABASE_URL is invalid.');
  }

  if (hostname !== `${testRef}.supabase.co`) {
    throw new Error(
      `Refusing to reset database: SUPABASE_URL hostname (${hostname}) does not match TEST_SUPABASE_REF (${testRef}).`,
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      'Refusing to reset database: SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
  }

  return { supabaseUrl, serviceRoleKey, testRef };
}

export function createTestAdminClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = assertSafeTestDatabase();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function deleteAllRows(
  supabase: SupabaseClient,
  table: string,
  nonNullColumn: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .delete()
    .not(nonNullColumn, 'is', null);

  if (error) {
    throw new Error(`Failed clearing ${table}: ${error.message}`);
  }
}

export async function resetTestDb(): Promise<void> {
  const supabase = createTestAdminClient();

  // Delete in strict FK order:
  // daily_logs -> applied_mutations -> reminder_dispatches -> target_versions -> actions -> periods -> unlock_rate_limits -> audit_logs
  await deleteAllRows(supabase, 'daily_logs', 'action_id');
  await deleteAllRows(supabase, 'applied_mutations', 'mutation_id');
  await deleteAllRows(supabase, 'reminder_dispatches', 'id');
  await deleteAllRows(supabase, 'target_versions', 'id');
  await deleteAllRows(supabase, 'actions', 'id');
  await deleteAllRows(supabase, 'periods', 'id');
  await deleteAllRows(supabase, 'unlock_rate_limits', 'ip_hash');
  await deleteAllRows(supabase, 'audit_logs', 'id');

  const { error: settingsError } = await supabase
    .from('app_settings')
    .upsert(DEFAULT_APP_SETTINGS, { onConflict: 'id' });

  if (settingsError) {
    throw new Error(
      `Failed restoring app_settings defaults: ${settingsError.message}`,
    );
  }
}
