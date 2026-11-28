import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTestEnv } from '../helpers/load-env';
import {
  assertSafeTestDatabase,
  createTestAdminClient,
  resetTestDb,
} from '../helpers/reset-test-db';

loadTestEnv();

describe('Slice 0: mohasba-test schema & PostgREST security lockdown', () => {
  const { supabaseUrl } = assertSafeTestDatabase();
  const admin = createTestAdminClient();
  const anonKey = process.env.SUPABASE_ANON_KEY_FOR_TESTS?.trim();

  beforeAll(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await resetTestDb();
  });

  describe('Direct PostgREST anon access lockdown', () => {
    const anonHeaders = () => {
      if (!anonKey) {
        throw new Error('SUPABASE_ANON_KEY_FOR_TESTS is required for anon checks');
      }
      return {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      };
    };

    it('rejects anon GET /rest/v1/daily_logs', async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/daily_logs?select=*`, {
        method: 'GET',
        headers: anonHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      expect(res.ok).toBe(false);
      expect([401, 403]).toContain(res.status);
      if (body.code) {
        expect(body.code).toBe('42501');
      }
    });

    it('rejects anon GET /rest/v1/audit_logs', async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/audit_logs?select=*`, {
        method: 'GET',
        headers: anonHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      expect(res.ok).toBe(false);
      expect([401, 403]).toContain(res.status);
      if (body.code) {
        expect(body.code).toBe('42501');
      }
    });

    it('rejects anon POST /rest/v1/rpc/commit_sync_batch', async () => {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/commit_sync_batch`, {
        method: 'POST',
        headers: anonHeaders(),
        body: JSON.stringify({ p_items: [] }),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      expect(res.ok).toBe(false);
      expect([401, 403]).toContain(res.status);
      if (body.code) {
        expect(body.code).toBe('42501');
      }
    });

    it('rejects anon POST /rest/v1/rpc/trim_audit_logs_if_needed', async () => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/rpc/trim_audit_logs_if_needed`,
        {
          method: 'POST',
          headers: anonHeaders(),
          body: JSON.stringify({}),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      expect(res.ok).toBe(false);
      expect([401, 403]).toContain(res.status);
      if (body.code) {
        expect(body.code).toBe('42501');
      }
    });

    it('rejects anon POST /rest/v1/rpc/delete_action_atomic and delete_period_atomic', async () => {
      for (const fn of ['delete_action_atomic', 'delete_period_atomic']) {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: anonHeaders(),
          body: JSON.stringify({
            [fn === 'delete_action_atomic' ? 'p_action_id' : 'p_period_id']:
              '00000000-0000-4000-8000-000000000001',
            p_force: false,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        expect(res.ok).toBe(false);
        expect([401, 403]).toContain(res.status);
        if (body.code) {
          expect(body.code).toBe('42501');
        }
      }
    });

    it('rejects anon POST /rest/v1/rpc/reset_workspace_atomic and record_unlock_failure_atomic', async () => {
      const rpcCases: Array<{ fn: string; payload: Record<string, unknown> }> = [
        { fn: 'reset_workspace_atomic', payload: {} },
        {
          fn: 'record_unlock_failure_atomic',
          payload: {
            p_ip_hash: 'anon-lockdown-probe',
            p_now: '2026-11-28T00:00:00.000Z',
            p_window_ms: 60_000,
            p_max_attempts: 5,
            p_lock_ms: 60_000,
          },
        },
      ];

      for (const { fn, payload } of rpcCases) {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: anonHeaders(),
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        expect(res.ok).toBe(false);
        expect([401, 403]).toContain(res.status);
        if (body.code) {
          expect(body.code).toBe('42501');
        }
      }
    });
  });

  describe('SQL 3-valued-logic CHECKs, composite FK & ON DELETE RESTRICT', () => {
    const periodId = '10000000-0000-4000-8000-000000000001';
    const actionAId = '20000000-0000-4000-8000-000000000001';
    const actionBId = '20000000-0000-4000-8000-000000000002';
    const targetAId = '30000000-0000-4000-8000-000000000001';
    const targetBId = '30000000-0000-4000-8000-000000000002';
    const nowIso = '2026-11-21T12:00:00.000Z';

    beforeAll(async () => {
      const { error: pErr } = await admin.from('periods').insert({
        id: periodId,
        title: 'الفجر',
        side: 'TIME_BOUND',
        sort_order: 1,
        start_anchor: 'FAJR',
        end_anchor: 'SUNRISE',
        active_from: '2026-11-01',
      });
      expect(pErr).toBeNull();

      const { error: aErr } = await admin.from('actions').insert([
        {
          id: actionAId,
          period_id: periodId,
          title: 'ورد القرآن',
          sort_order: 1,
          supports_percentage: true,
          is_qadaa_eligible: true,
          active_from: '2026-11-01',
        },
        {
          id: actionBId,
          period_id: periodId,
          title: 'أذكار الصباح',
          sort_order: 2,
          supports_percentage: false,
          is_qadaa_eligible: false,
          active_from: '2026-11-01',
        },
      ]);
      expect(aErr).toBeNull();

      const { error: tErr } = await admin.from('target_versions').insert([
        {
          id: targetAId,
          action_id: actionAId,
          effective_from: '2026-11-01',
          target_label: '10 صفحات',
          target_value: 10,
          target_unit: 'صفحة',
          direction: 'level_up',
        },
        {
          id: targetBId,
          action_id: actionBId,
          effective_from: '2026-11-01',
          target_label: 'كاملة',
          direction: 'level_up',
        },
      ]);
      expect(tErr).toBeNull();
    });

    it('rejects (status=NULL, percent_value=50)', async () => {
      const { error } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-20',
        status: null,
        percent_value: 50,
        client_updated_at: nowIso,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23514');
    });

    it('rejects (status=NULL, qadaa_resolved_at=now())', async () => {
      const { error } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-20',
        status: null,
        qadaa_resolved_at: nowIso,
        client_updated_at: nowIso,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23514');
    });

    it('rejects (status=PERCENT, percent_value=NULL)', async () => {
      const { error } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-20',
        status: 'PERCENT',
        percent_value: null,
        client_updated_at: nowIso,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23514');
    });

    it('rejects (availability_override=DISABLED, status=DONE)', async () => {
      const { error } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-20',
        availability_override: 'DISABLED',
        status: 'DONE',
        client_updated_at: nowIso,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23514');
    });

    it('rejects cross-action target_version_id', async () => {
      const { error } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-20',
        status: 'DONE',
        target_version_id: targetBId,
        client_updated_at: nowIso,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23503');
    });

    it('blocks DELETE on a log-referenced target_version (ON DELETE RESTRICT)', async () => {
      const { error: insertErr } = await admin.from('daily_logs').insert({
        action_id: actionAId,
        log_date: '2026-11-21',
        status: 'DONE',
        target_version_id: targetAId,
        client_updated_at: nowIso,
      });
      expect(insertErr).toBeNull();

      const { error: delErr } = await admin
        .from('target_versions')
        .delete()
        .eq('id', targetAId);
      expect(delErr).not.toBeNull();
      expect(delErr?.code).toBe('23503');
    });
  });

  describe('UNIQUE NULLS NOT DISTINCT & service_role sanity', () => {
    it('rejects duplicate (period_id=NULL, islamic_date, nightly_digest)', async () => {
      const { error: firstErr } = await admin.from('reminder_dispatches').insert({
        period_id: null,
        islamic_date: '2026-11-21',
        reminder_kind: 'nightly_digest',
        dispatch_status: 'sent',
      });
      expect(firstErr).toBeNull();

      const { error: dupErr } = await admin.from('reminder_dispatches').insert({
        period_id: null,
        islamic_date: '2026-11-21',
        reminder_kind: 'nightly_digest',
        dispatch_status: 'sending',
      });
      expect(dupErr).not.toBeNull();
      expect(dupErr?.code).toBe('23505');
    });

    it('reads singleton app_settings and runs trim_audit_logs_if_needed via service_role', async () => {
      const { data: settings, error: sErr } = await admin
        .from('app_settings')
        .select('id, rollover_mode, iana_timezone, week_start_day')
        .eq('id', 1)
        .single();
      expect(sErr).toBeNull();
      expect(settings).toMatchObject({
        id: 1,
        rollover_mode: 'FAJR',
        iana_timezone: 'Africa/Cairo',
        week_start_day: 6,
      });

      const { data: trimRes, error: trimErr } = await admin.rpc(
        'trim_audit_logs_if_needed',
      );
      expect(trimErr).toBeNull();
      expect(trimRes).toMatchObject({
        deleted_count: 0,
      });
    });

    it('enforces 0002_ux_preferences.sql CHECK constraints on app_settings', async () => {
      // Non-HTTPS ntfy_topic_url rejected
      const { error: badSchemeErr } = await admin
        .from('app_settings')
        .update({ ntfy_topic_url: 'http://ntfy.sh/insecure-topic' })
        .eq('id', 1);
      expect(badSchemeErr).not.toBeNull();
      expect(badSchemeErr?.code).toBe('23514');

      // Invalid default_home_view rejected
      const { error: badHomeErr } = await admin
        .from('app_settings')
        .update({ default_home_view: 'invalid_view' })
        .eq('id', 1);
      expect(badHomeErr).not.toBeNull();
      expect(badHomeErr?.code).toBe('23514');

      // Invalid enter_key_mode rejected
      const { error: badEnterErr } = await admin
        .from('app_settings')
        .update({ enter_key_mode: 'invalid_enter_mode' })
        .eq('id', 1);
      expect(badEnterErr).not.toBeNull();
      expect(badEnterErr?.code).toBe('23514');

      // Non-object keyboard_shortcuts JSONB rejected
      const { error: badShortcutsErr } = await admin
        .from('app_settings')
        .update({ keyboard_shortcuts: [] })
        .eq('id', 1);
      expect(badShortcutsErr).not.toBeNull();
      expect(badShortcutsErr?.code).toBe('23514');
    });
  });
});
