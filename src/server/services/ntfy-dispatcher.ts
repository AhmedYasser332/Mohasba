import type { SupabaseClient } from '@supabase/supabase-js';
import { AR_STRINGS } from '@/domain/i18n/ar';
import { resolveCellAvailability } from '@/domain/lifecycle';
import {
  addDaysIso,
  diffDaysIso,
  formatLocalIsoDate,
  isTimeInQuietHours,
  resolveActiveWindow,
  resolveIslamicDate,
  resolveIslamicDayEndInstant,
  zonedWallClockToUtc,
} from '@/domain/prayer-engine';
import { get48hCatchUpItems } from '@/domain/qadaa';
import { makeCellKey, type DailyLog, type ReminderKind } from '@/domain/types';
import type { RuntimeConfig } from '../config';
import {
  fetchAppSettings,
  normalizeActionRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { normalizeDailyLogRow } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';

export interface NtfyTestResult {
  ok: boolean;
  status: number;
}

export async function sendTestNtfy(
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<NtfyTestResult> {
  if (!config.ntfyTopicUrl) {
    throw new ServiceError(
      400,
      'NTFY_NOT_CONFIGURED',
      'NTFY_TOPIC_URL is not configured.',
    );
  }

  const clickUrl = config.appUrl
    ? `${config.appUrl.replace(/\/+$/, '')}/?view=settings`
    : undefined;

  const headers: Record<string, string> = {
    Title: 'Mohasba Tracker - Test Notification',
    Tags: 'mosque',
  };
  if (clickUrl) {
    headers.Click = clickUrl;
  }

  const res = await fetchImpl(config.ntfyTopicUrl, {
    method: 'POST',
    headers,
    body: 'تنبيه تجريبي من جدول المحاسبة — الاتصال يعمل بنجاح.',
    signal: AbortSignal.timeout(5000),
  });

  return {
    ok: res.ok,
    status: res.status,
  };
}

export interface CronTickSummary {
  ok: true;
  islamic_date: string;
  pruned: boolean;
  dispatched_count: number;
  skipped_count: number;
  failed_count: number;
}

interface PendingDispatch {
  claimId: string;
  periodId: string | null;
  islamicDate: string;
  reminderKind: ReminderKind;
  titleAscii: string;
  body: string;
  clickUrl?: string;
}

export async function runCronTick(
  config: RuntimeConfig,
  supabase: SupabaseClient,
  options?: {
    now?: Date | number;
    fetchImpl?: typeof fetch;
    requestId?: string;
  },
): Promise<CronTickSummary> {
  const nowMs =
    options?.now !== undefined
      ? typeof options.now === 'number'
        ? options.now
        : options.now.getTime()
      : Date.now();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const requestId = options?.requestId ?? null;
  const nowIso = new Date(nowMs).toISOString();

  // 1. Read app_settings (continuously resets Supabase's 7-day inactivity pause)
  const settings = await fetchAppSettings(supabase);
  const todayIslamicDate = resolveIslamicDate(nowMs, settings);

  // 2. Daily Prune once per Islamic date
  let pruned = false;
  if (settings.last_pruned_date !== todayIslamicDate) {
    const cutoff90dIso = new Date(nowMs - 90 * 86_400_000).toISOString();
    const cutoff90dDate = addDaysIso(todayIslamicDate, -90);

    await Promise.all([
      supabase
        .from('applied_mutations')
        .delete()
        .lt('applied_at', cutoff90dIso),
      supabase
        .from('reminder_dispatches')
        .delete()
        .lt('islamic_date', cutoff90dDate),
      supabase
        .from('unlock_rate_limits')
        .delete()
        .lt('locked_until', nowIso),
      supabase.rpc('trim_audit_logs_if_needed', {
        p_max_rows: 35000,
        p_emergency_bytes: 104857600,
        p_batch_limit: 1000,
      }),
    ]);

    await supabase
      .from('app_settings')
      .update({
        last_pruned_date: todayIslamicDate,
        updated_at: nowIso,
      })
      .eq('id', 1);

    pruned = true;
  }

  let dispatchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  if (!config.ntfyTopicUrl) {
    return {
      ok: true,
      islamic_date: todayIslamicDate,
      pruned,
      dispatched_count: 0,
      skipped_count: 0,
      failed_count: 0,
    };
  }

  const inQuietHours = isTimeInQuietHours(nowMs, settings);
  const appBaseUrl = config.appUrl?.replace(/\/+$/, '') ?? null;
  const dispatchesToSend: PendingDispatch[] = [];

  async function tryClaimDispatch(params: {
    periodId: string | null;
    islamicDate: string;
    reminderKind: ReminderKind;
  }): Promise<string | null> {
    const { data, error } = await supabase
      .from('reminder_dispatches')
      .insert({
        period_id: params.periodId,
        islamic_date: params.islamicDate,
        reminder_kind: params.reminderKind,
        dispatch_status: 'sending',
        dispatched_at: nowIso,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        skippedCount += 1;
        return null;
      }
      throw new Error(`Failed claiming reminder_dispatch: ${error.message}`);
    }
    return String(data.id);
  }

  // 3. Biweekly Backup Nudge (even if period reminders are off, as long as backup_reminder_enabled)
  if (settings.backup_reminder_enabled && !inQuietHours) {
    const { data: lastBackup } = await supabase
      .from('reminder_dispatches')
      .select('islamic_date')
      .eq('reminder_kind', 'backup_nudge')
      .order('islamic_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const shouldNudge =
      !lastBackup ||
      diffDaysIso(String(lastBackup.islamic_date), todayIslamicDate) >= 14;

    if (shouldNudge) {
      const claimId = await tryClaimDispatch({
        periodId: null,
        islamicDate: todayIslamicDate,
        reminderKind: 'backup_nudge',
      });
      if (claimId) {
        dispatchesToSend.push({
          claimId,
          periodId: null,
          islamicDate: todayIslamicDate,
          reminderKind: 'backup_nudge',
          titleAscii: 'Mohasba Tracker - Backup Reminder',
          body: 'تذكير دوري: احفظ نسخة احتياطية كاملة (JSON) من جدول المحاسبة من الإعدادات.',
          clickUrl: appBaseUrl ? `${appBaseUrl}/?view=settings` : undefined,
        });
      }
    }
  }

  // 4. Period Reminders + Nightly Backlog Digest
  if (settings.ntfy_master_enabled && !inQuietHours) {
    const civilDate = formatLocalIsoDate(nowMs, settings.iana_timezone);
    const minDate = addDaysIso(civilDate, -2);
    const maxDate = addDaysIso(civilDate, 1);

    const [periodsRes, actionsRes, targetsRes, logsRes] = await Promise.all([
      supabase.from('periods').select('*').order('sort_order'),
      supabase.from('actions').select('*').order('sort_order'),
      supabase.from('target_versions').select('*'),
      supabase
        .from('daily_logs')
        .select('*')
        .gte('log_date', minDate)
        .lte('log_date', maxDate),
    ]);

    if (periodsRes.error) {
      throw new Error(`Cron failed reading periods: ${periodsRes.error.message}`);
    }
    if (actionsRes.error) {
      throw new Error(`Cron failed reading actions: ${actionsRes.error.message}`);
    }
    if (targetsRes.error) {
      throw new Error(
        `Cron failed reading target_versions: ${targetsRes.error.message}`,
      );
    }
    if (logsRes.error) {
      throw new Error(`Cron failed reading daily_logs: ${logsRes.error.message}`);
    }

    const periods = (periodsRes.data ?? []).map((r) =>
      normalizePeriodRow(r as Record<string, unknown>),
    );
    const actions = (actionsRes.data ?? []).map((r) =>
      normalizeActionRow(r as Record<string, unknown>),
    );
    const targetVersions = (targetsRes.data ?? []).map((r) =>
      normalizeTargetVersionRow(r as Record<string, unknown>),
    );
    const logs = (logsRes.data ?? []).map((r) =>
      normalizeDailyLogRow(r as Record<string, unknown>),
    );

    const logsByKey = new Map<string, DailyLog>(
      logs.map((l) => [makeCellKey(l.action_id, l.log_date), l]),
    );

    const { windows3Day } = resolveActiveWindow(nowMs, periods, settings);

    for (const w of windows3Day) {
      if (!w.period.ntfy_enabled || !w.period.ntfy_mode) {
        continue;
      }

      const triggerInstant =
        w.period.ntfy_mode === 'pre_expiry'
          ? w.endInstant - w.period.ntfy_offset_min * 60_000
          : w.startInstant + w.period.ntfy_offset_min * 60_000;

      // Anti-flood bound: strictly within [triggerInstant, endInstant)
      if (!(triggerInstant <= nowMs && nowMs < w.endInstant)) {
        continue;
      }

      // Check >= 1 active enabled EMPTY item exists in this period (or bound to it) on w.islamicDate
      const hasUnloggedItem = actions.some((action) => {
        const belongsToPeriod =
          action.period_id === w.periodId ||
          action.bound_time_period_id === w.periodId;
        if (!belongsToPeriod) return false;
        const log = logsByKey.get(makeCellKey(action.id, w.islamicDate));
        if (log?.status != null) return false;
        const avail = resolveCellAvailability(action, log, w.islamicDate);
        return avail.isActive && avail.isEnabled;
      });

      if (!hasUnloggedItem) {
        skippedCount += 1;
        continue;
      }

      const claimId = await tryClaimDispatch({
        periodId: w.periodId,
        islamicDate: w.islamicDate,
        reminderKind: w.period.ntfy_mode,
      });

      if (!claimId) {
        continue;
      }

      const body = AR_STRINGS.settings.ntfyOfflineCopyTemplate.replace(
        '{{period}}',
        w.period.title,
      );

      dispatchesToSend.push({
        claimId,
        periodId: w.periodId,
        islamicDate: w.islamicDate,
        reminderKind: w.period.ntfy_mode,
        titleAscii: 'Mohasba Tracker - Period Reminder',
        body,
        clickUrl: appBaseUrl
          ? `${appBaseUrl}/?period=${encodeURIComponent(w.periodId)}&date=${encodeURIComponent(w.islamicDate)}`
          : undefined,
      });
    }

    // Nightly Backlog Digest
    if (settings.digest_enabled && settings.digest_hhmm) {
      const digestInstant = zonedWallClockToUtc(
        todayIslamicDate,
        settings.digest_hhmm,
        settings.iana_timezone,
      );
      const dayEndInstant = resolveIslamicDayEndInstant(
        todayIslamicDate,
        settings,
      );

      if (nowMs >= digestInstant && nowMs < dayEndInstant) {
        const catchUp = get48hCatchUpItems({
          actions,
          periods,
          targetVersions,
          logs,
          settings,
          now: nowMs,
        });

        if (catchUp.length > 0) {
          const claimId = await tryClaimDispatch({
            periodId: null,
            islamicDate: todayIslamicDate,
            reminderKind: 'nightly_digest',
          });

          if (claimId) {
            dispatchesToSend.push({
              claimId,
              periodId: null,
              islamicDate: todayIslamicDate,
              reminderKind: 'nightly_digest',
              titleAscii: 'Mohasba Tracker - Nightly Backlog Digest',
              body: `يوجد ${catchUp.length} عناصر منتهية غير مسجّلة في آخر 48 ساعة — راجع الاستدراك متى تيسر.`,
              clickUrl: appBaseUrl
                ? `${appBaseUrl}/?view=qadaa&tab=catchup`
                : undefined,
            });
          }
        }
      }
    }
  }

  // 5. Execute all claimed HTTP dispatches in parallel with 5s timeout
  if (dispatchesToSend.length > 0) {
    const results = await Promise.allSettled(
      dispatchesToSend.map(async (item) => {
        const headers: Record<string, string> = {
          Title: item.titleAscii,
          Tags: 'mosque',
        };
        if (item.clickUrl) {
          headers.Click = item.clickUrl;
        }

        const res = await fetchImpl(config.ntfyTopicUrl!, {
          method: 'POST',
          headers,
          body: item.body,
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          throw new Error(`ntfy HTTP ${res.status}`);
        }
        return item;
      }),
    );

    for (let i = 0; i < results.length; i += 1) {
      const outcome = results[i]!;
      const item = dispatchesToSend[i]!;
      if (outcome.status === 'fulfilled') {
        dispatchedCount += 1;
        await supabase
          .from('reminder_dispatches')
          .update({ dispatch_status: 'sent' })
          .eq('id', item.claimId);
      } else {
        failedCount += 1;
        const errMsg =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        await supabase
          .from('reminder_dispatches')
          .update({
            dispatch_status: 'failed',
            error_message: errMsg.slice(0, 500),
          })
          .eq('id', item.claimId);

        await writeAuditLog(supabase, {
          level: 'WARN',
          category: 'CRON',
          event_name: 'ntfy_dispatch_failed',
          request_id: requestId,
          entity_type: 'reminder_dispatch',
          entity_id: item.claimId,
          summary: `ntfy dispatch failed for ${item.reminderKind}.`,
          context: {
            reminder_kind: item.reminderKind,
            period_id: item.periodId,
            islamic_date: item.islamicDate,
          },
          error: outcome.reason,
        });
      }
    }
  }

  return {
    ok: true,
    islamic_date: todayIslamicDate,
    pruned,
    dispatched_count: dispatchedCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
  };
}
