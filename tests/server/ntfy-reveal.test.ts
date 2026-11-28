import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RuntimeConfig } from '@/server/config';
import { ServiceError } from '@/server/errors';
import { revealNtfyTopicUrl } from '@/server/services/ntfy-dispatcher';

function makeMockSupabase(row: Record<string, unknown>): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: row, error: null }),
  };
  return {
    from: () => query,
  } as unknown as SupabaseClient;
}

const BASE_SETTINGS_ROW: Record<string, unknown> = {
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
  ntfy_master_enabled: true,
  quiet_start_hhmm: null,
  quiet_end_hhmm: null,
  digest_enabled: true,
  digest_hhmm: '22:30',
  backup_reminder_enabled: true,
  onboarding_completed: true,
  last_pruned_date: null,
};

const BASE_CONFIG: RuntimeConfig = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'test-key',
  appPasscode: 'secret',
  cronSecret: 'cron-secret',
  appUrl: 'http://127.0.0.1:3000',
  ntfyTopicUrl: null,
  allowUnauthenticated: false,
  nodeEnv: 'test',
  isProduction: false,
};

describe('server/services/ntfy-dispatcher revealNtfyTopicUrl', () => {
  it('gives DB ntfy_topic_url precedence over env and never returns ntfy_access_token', async () => {
    const supabase = makeMockSupabase({
      ...BASE_SETTINGS_ROW,
      ntfy_topic_url: 'https://ntfy.sh/mohasba-db-topic-1234',
      ntfy_access_token: 'tk_super_secret_token_should_never_leak',
    });
    const config: RuntimeConfig = {
      ...BASE_CONFIG,
      ntfyTopicUrl: 'https://ntfy.sh/mohasba-env-topic-9999',
    };

    const result = await revealNtfyTopicUrl(config, supabase);
    expect(result).toEqual({
      url: 'https://ntfy.sh/mohasba-db-topic-1234',
      source: 'db',
    });
    expect(Object.keys(result).sort()).toEqual(['source', 'url']);
    expect(JSON.stringify(result)).not.toContain('tk_super_secret_token');
  });

  it('falls back to env config.ntfyTopicUrl when DB ntfy_topic_url is null or blank', async () => {
    const supabase = makeMockSupabase({
      ...BASE_SETTINGS_ROW,
      ntfy_topic_url: '   ',
      ntfy_access_token: 'tk_super_secret_token_should_never_leak',
    });
    const config: RuntimeConfig = {
      ...BASE_CONFIG,
      ntfyTopicUrl: 'https://ntfy.sh/mohasba-env-fallback-5678',
    };

    const result = await revealNtfyTopicUrl(config, supabase);
    expect(result).toEqual({
      url: 'https://ntfy.sh/mohasba-env-fallback-5678',
      source: 'env',
    });
    expect(Object.keys(result).sort()).toEqual(['source', 'url']);
    expect(JSON.stringify(result)).not.toContain('tk_super_secret_token');
  });

  it('throws ServiceError 400 NTFY_NOT_CONFIGURED when neither DB nor env URL is configured', async () => {
    const supabase = makeMockSupabase({
      ...BASE_SETTINGS_ROW,
      ntfy_topic_url: null,
      ntfy_access_token: null,
    });

    await expect(revealNtfyTopicUrl(BASE_CONFIG, supabase)).rejects.toMatchObject({
      status: 400,
      code: 'NTFY_NOT_CONFIGURED',
    });

    try {
      await revealNtfyTopicUrl(BASE_CONFIG, supabase);
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
    }
  });
});
