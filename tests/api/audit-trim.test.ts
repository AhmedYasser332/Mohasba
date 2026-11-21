import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

describe('Slice 2: Live trim_audit_logs_if_needed RPC', () => {
  const admin = createTestAdminClient();

  beforeAll(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await resetTestDb();
  });

  it('enforces the 7-day protection floor on recent rows and trims oldest >7d rows in bounded batches', async () => {
    const oldTimestamp = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const recentTimestamp = new Date().toISOString();

    const oldRows = Array.from({ length: 15 }, (_, i) => ({
      created_at: oldTimestamp,
      level: 'INFO',
      category: 'SYSTEM',
      event_name: `old_event_${i}`,
      summary: `Old audit log ${i}`,
      context: { idx: i },
    }));

    const recentRows = Array.from({ length: 10 }, (_, i) => ({
      created_at: recentTimestamp,
      level: 'INFO',
      category: 'SYSTEM',
      event_name: `recent_event_${i}`,
      summary: `Recent audit log ${i}`,
      context: { idx: i },
    }));

    const { error: insertErr } = await admin
      .from('audit_logs')
      .insert([...oldRows, ...recentRows]);
    expect(insertErr).toBeNull();

    // Trim batch 1: limit 8 out of 25 rows (threshold p_max_rows=5)
    const { data: trim1, error: trim1Err } = await admin.rpc(
      'trim_audit_logs_if_needed',
      {
        p_max_rows: 5,
        p_emergency_bytes: 104857600,
        p_batch_limit: 8,
      },
    );
    expect(trim1Err).toBeNull();
    expect(trim1).toMatchObject({
      rows_before: 25,
      deleted_count: 8,
    });

    // Trim batch 2: remaining 7 old rows deleted, 10 recent rows preserved by 7-day floor
    const { data: trim2, error: trim2Err } = await admin.rpc(
      'trim_audit_logs_if_needed',
      {
        p_max_rows: 5,
        p_emergency_bytes: 104857600,
        p_batch_limit: 10,
      },
    );
    expect(trim2Err).toBeNull();
    expect(trim2).toMatchObject({
      rows_before: 17,
      deleted_count: 7,
    });

    // Trim batch 3: 10 recent rows remain > p_max_rows=5, yet 0 deleted because all are <= 7 days old!
    const { data: trim3, error: trim3Err } = await admin.rpc(
      'trim_audit_logs_if_needed',
      {
        p_max_rows: 5,
        p_emergency_bytes: 104857600,
        p_batch_limit: 10,
      },
    );
    expect(trim3Err).toBeNull();
    expect(trim3).toMatchObject({
      rows_before: 10,
      deleted_count: 0,
    });

    const { data: remaining } = await admin
      .from('audit_logs')
      .select('event_name');
    expect(remaining).toHaveLength(10);
    expect(
      remaining?.every((r) => String(r.event_name).startsWith('recent_event_')),
    ).toBe(true);
  });
});
