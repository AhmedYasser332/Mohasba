import type { SupabaseClient } from '@supabase/supabase-js';
import { AR_STRINGS } from '@/domain/i18n/ar';
import {
  isActionActiveOnDate,
  resolveCellAvailability,
} from '@/domain/lifecycle';
import {
  addDaysIso,
  computePrayerTimesForDay,
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
  fetchAppSettingsWithNtfySecrets,
  normalizeActionRow,
  normalizePeriodRow,
  normalizeTargetVersionRow,
} from '../db/normalizers';
import { normalizeDailyLogRow } from '../db/pagination';
import { ServiceError } from '../errors';
import { writeAuditLog } from '../observability/logger';
import {
  formatNtfyTopicHint,
  scrubNtfyError,
  scrubNtfySecrets,
  validateNtfyTopicUrl,
} from '../security/ntfy-url';

export interface NtfyTestResult {
  ok: boolean;
  status: number;
}

export async function sendTestNtfy(
  config: RuntimeConfig,
  supabase: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<NtfyTestResult> {
  const { ntfyTopicUrlDb, ntfyAccessTokenDb } =
    await fetchAppSettingsWithNtfySecrets(supabase);

  const effectiveUrl = ntfyTopicUrlDb ?? config.ntfyTopicUrl;
  if (!effectiveUrl) {
    throw new ServiceError(
      400,
      'NTFY_NOT_CONFIGURED',
      'NTFY_TOPIC_URL is not configured.',
    );
  }

  if (ntfyTopicUrlDb !== null) {
    const urlCheck = validateNtfyTopicUrl(ntfyTopicUrlDb);
    if (!urlCheck.ok) {
      throw new ServiceError(400, 'VALIDATION_ERROR', urlCheck.reason);
    }
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
  if (ntfyAccessTokenDb) {
    headers.Authorization = `Bearer ${ntfyAccessTokenDb}`;
  }

  try {
    const res = await fetchImpl(effectiveUrl, {
      method: 'POST',
      headers,
      body: 'تنبيه تجريبي من جدول المحاسبة — الاتصال يعمل بنجاح.',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });

    return {
      ok: res.ok,
      status: res.status,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const scrubbedMsg = scrubNtfySecrets(
      rawMsg,
      effectiveUrl,
      ntfyAccessTokenDb,
    );
    throw new ServiceError(
      502,
      'NTFY_DISPATCH_FAILED',
      `Failed sending ntfy test notification: ${scrubbedMsg}`,
    );
  }
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
  const { settings, ntfyTopicUrlDb, ntfyAccessTokenDb } =
    await fetchAppSettingsWithNtfySecrets(supabase);
  const todayIslamicDate = resolveIslamicDate(nowMs, settings);

  // 2. Daily Prune once per Islamic date
  let pruned = false;
  if (settings.last_pruned_date !== todayIslamicDate) {
    const cutoff90dIso = new Date(nowMs - 90 * 86_400_000).toISOString();
    const cutoff90dDate = addDaysIso(todayIslamicDate, -90);

    const [
      pruneMutationsRes,
      pruneDispatchesRes,
      pruneRateLimitsRes,
      trimAuditRes,
    ] = await Promise.all([
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

    const pruneFailures: Array<{ step: string; message: string }> = [];
    if (pruneMutationsRes.error) {
      pruneFailures.push({
        step: 'applied_mutations',
        message: pruneMutationsRes.error.message,
      });
    }
    if (pruneDispatchesRes.error) {
      pruneFailures.push({
        step: 'reminder_dispatches',
        message: pruneDispatchesRes.error.message,
      });
    }
    if (pruneRateLimitsRes.error) {
      pruneFailures.push({
        step: 'unlock_rate_limits',
        message: pruneRateLimitsRes.error.message,
      });
    }
    if (trimAuditRes.error) {
      pruneFailures.push({
        step: 'trim_audit_logs_if_needed',
        message: trimAuditRes.error.message,
      });
    }

    if (pruneFailures.length > 0) {
      console.error(
        JSON.stringify({
          ts: nowIso,
          level: 'ERROR',
          event: 'daily_prune_failed',
          requestId,
          islamicDate: todayIslamicDate,
          failures: pruneFailures,
        }),
      );
      await writeAuditLog(supabase, {
        level: 'ERROR',
        category: 'CRON',
        event_name: 'daily_prune_failed',
        request_id: requestId,
        summary: `Daily prune encountered ${pruneFailures.length} failure(s); last_pruned_date not advanced.`,
        context: {
          islamic_date: todayIslamicDate,
          failures: pruneFailures,
        },
      });
    } else {
      const { error: stampErr } = await supabase
        .from('app_settings')
        .update({
          last_pruned_date: todayIslamicDate,
          updated_at: nowIso,
        })
        .eq('id', 1);

      if (stampErr) {
        console.error(
          JSON.stringify({
            ts: nowIso,
            level: 'ERROR',
            event: 'daily_prune_stamp_failed',
            requestId,
            islamicDate: todayIslamicDate,
            error: stampErr.message,
          }),
        );
        await writeAuditLog(supabase, {
          level: 'ERROR',
          category: 'CRON',
          event_name: 'daily_prune_stamp_failed',
          request_id: requestId,
          summary: `Failed stamping last_pruned_date after daily prune: ${stampErr.message}`,
          context: { islamic_date: todayIslamicDate },
          error: stampErr,
        });
      } else {
        pruned = true;
      }
    }
  }

  let dispatchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const effectiveUrl = ntfyTopicUrlDb ?? config.ntfyTopicUrl;
  if (!effectiveUrl) {
    return {
      ok: true,
      islamic_date: todayIslamicDate,
      pruned,
      dispatched_count: 0,
      skipped_count: 0,
      failed_count: 0,
    };
  }

  if (ntfyTopicUrlDb !== null) {
    const urlCheck = validateNtfyTopicUrl(ntfyTopicUrlDb);
    if (!urlCheck.ok) {
      await writeAuditLog(supabase, {
        level: 'ERROR',
        category: 'CRON',
        event_name: 'ntfy_url_rejected',
        request_id: requestId,
        summary:
          'Skipped cron ntfy dispatch because stored ntfy_topic_url failed validation.',
        context: {
          reason: urlCheck.reason,
          topic_hint: formatNtfyTopicHint(ntfyTopicUrlDb),
        },
      });
      return {
        ok: true,
        islamic_date: todayIslamicDate,
        pruned,
        dispatched_count: 0,
        skipped_count: 0,
        failed_count: 0,
      };
    }
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
    const { data: lastBackup, error: lastBackupErr } = await supabase
      .from('reminder_dispatches')
      .select('islamic_date')
      .eq('reminder_kind', 'backup_nudge')
      .order('islamic_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastBackupErr) {
      console.error(
        JSON.stringify({
          ts: nowIso,
          level: 'ERROR',
          event: 'backup_nudge_query_failed',
          requestId,
          error: lastBackupErr.message,
        }),
      );
      await writeAuditLog(supabase, {
        level: 'ERROR',
        category: 'CRON',
        event_name: 'backup_nudge_query_failed',
        request_id: requestId,
        summary: `Skipped backup nudge because querying last backup_nudge failed: ${lastBackupErr.message}`,
        context: { islamic_date: todayIslamicDate },
        error: lastBackupErr,
      });
    } else {
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
        if (!isActionActiveOnDate(action, w.islamicDate)) return false;
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
      let digestInstant = zonedWallClockToUtc(
        todayIslamicDate,
        settings.digest_hhmm,
        settings.iana_timezone,
      );
      if (
        settings.rollover_mode === 'FAJR' &&
        digestInstant < computePrayerTimesForDay(todayIslamicDate, settings).fajr
      ) {
        digestInstant = zonedWallClockToUtc(
          addDaysIso(todayIslamicDate, 1),
          settings.digest_hhmm,
          settings.iana_timezone,
        );
      }
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
        if (ntfyAccessTokenDb) {
          headers.Authorization = `Bearer ${ntfyAccessTokenDb}`;
        }

        const res = await fetchImpl(effectiveUrl, {
          method: 'POST',
          headers,
          body: item.body,
          redirect: 'error',
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
        const { error: sentUpdateErr } = await supabase
          .from('reminder_dispatches')
          .update({ dispatch_status: 'sent' })
          .eq('id', item.claimId);
        if (sentUpdateErr) {
          console.error(
            JSON.stringify({
              ts: nowIso,
              level: 'ERROR',
              event: 'ntfy_status_update_failed',
              requestId,
              claimId: item.claimId,
              targetStatus: 'sent',
              error: sentUpdateErr.message,
            }),
          );
          await writeAuditLog(supabase, {
            level: 'ERROR',
            category: 'CRON',
            event_name: 'ntfy_status_update_failed',
            request_id: requestId,
            entity_type: 'reminder_dispatch',
            entity_id: item.claimId,
            summary: `Failed updating reminder_dispatch status to sent: ${sentUpdateErr.message}`,
            context: {
              reminder_kind: item.reminderKind,
              target_status: 'sent',
            },
            error: sentUpdateErr,
          });
        }
      } else {
        failedCount += 1;
        const rawErrMsg =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        const scrubbedErrMsg = scrubNtfySecrets(
          rawErrMsg,
          effectiveUrl,
          ntfyAccessTokenDb,
        );
        const { error: failedUpdateErr } = await supabase
          .from('reminder_dispatches')
          .update({
            dispatch_status: 'failed',
            error_message: scrubbedErrMsg.slice(0, 500),
          })
          .eq('id', item.claimId);
        if (failedUpdateErr) {
          console.error(
            JSON.stringify({
              ts: nowIso,
              level: 'ERROR',
              event: 'ntfy_status_update_failed',
              requestId,
              claimId: item.claimId,
              targetStatus: 'failed',
              error: failedUpdateErr.message,
            }),
          );
          await writeAuditLog(supabase, {
            level: 'ERROR',
            category: 'CRON',
            event_name: 'ntfy_status_update_failed',
            request_id: requestId,
            entity_type: 'reminder_dispatch',
            entity_id: item.claimId,
            summary: `Failed updating reminder_dispatch status to failed: ${failedUpdateErr.message}`,
            context: {
              reminder_kind: item.reminderKind,
              target_status: 'failed',
            },
            error: failedUpdateErr,
          });
        }

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
          error: scrubNtfyError(
            outcome.reason,
            effectiveUrl,
            ntfyAccessTokenDb,
          ),
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
