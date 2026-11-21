'use client';

import React, { useMemo, useState } from 'react';
import {
  AR_STRINGS,
  type Action,
  type MetricsSummary,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';

function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '-';
  return `${Math.round(rate * 100)}%`;
}

function getRatePillClass(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return 'rate-pill';
  const pct = rate * 100;
  if (pct >= 85) return 'rate-pill good';
  if (pct >= 60) return 'rate-pill warn';
  return 'rate-pill bad';
}

function RateBadge({ rate }: { rate: number | null }) {
  return (
    <span className={`${getRatePillClass(rate)} nums`}>{formatRate(rate)}</span>
  );
}

export function AnalyticsView() {
  const { analytics7d, analytics30d, actions } = useMohasba();
  const [windowDays, setWindowDays] = useState<7 | 30>(7);

  const actionsById = useMemo(
    () => new Map<string, Action>(actions.map((a) => [a.id, a])),
    [actions],
  );

  const activeAnalytics = windowDays === 7 ? analytics7d : analytics30d;
  const insight30 = analytics30d ?? analytics7d;
  const pulse = (analytics7d ?? analytics30d)?.pulse ?? null;

  if (!activeAnalytics || !insight30 || !pulse) {
    return (
      <section className="panel" aria-label={AR_STRINGS.analytics.title}>
        <div className="empty-state">
          <span>لا توجد بيانات تحليلية متاحة حالياً.</span>
        </div>
      </section>
    );
  }

  const { weakSpots, adaptingTargets, progressionTrails } = insight30;
  const { breakdown } = activeAnalytics;

  const renderSummaryMetrics = (label: string, summary: MetricsSummary) => (
    <tr className="summary-row">
      <td>{label}</td>
      <td>
        <RateBadge rate={summary.weightedRate} />
      </td>
      <td className="nums">{formatRate(summary.onTimeRate)}</td>
      <td className="nums">{formatRate(summary.qadaaRate)}</td>
      <td className="nums">{formatRate(summary.missedRate)}</td>
      <td className="nums">{summary.loggedCount}</td>
    </tr>
  );

  return (
    <div className="view-stack" aria-label={AR_STRINGS.analytics.title}>
      {/* Top Header + 7d / 30d Toggle */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">{AR_STRINGS.analytics.title}</h3>
            <span className="panel-meta">
              البيانات الفارغة أو المعذورة لا تُحتسب في المقام ولا تتحول تلقائياً إلى فوات
            </span>
          </div>

          <div className="seg-tabs" role="tablist" aria-label="نطاق التحليل">
            <button
              type="button"
              role="tab"
              className="seg-tab"
              data-testid="analytics-toggle-7d"
              aria-selected={windowDays === 7}
              onClick={() => setWindowDays(7)}
            >
              7 أيام
            </button>
            <button
              type="button"
              role="tab"
              className="seg-tab"
              data-testid="analytics-toggle-30d"
              aria-selected={windowDays === 30}
              onClick={() => setWindowDays(30)}
            >
              30 يوماً
            </button>
          </div>
        </div>

        {/* Insight 3: Qadaa & Backlog Pulse */}
        <div className="analytics-pulse-grid" data-testid="analytics-pulse">
          <div className="pulse-col">
            <span className="panel-meta">
              {AR_STRINGS.analytics.insight3Title} (القضاء)
            </span>
            <div className="pulse-kpi nums" data-testid="pulse-open-qadaa">
              {pulse.qadaa.openQadaaCount} {AR_STRINGS.analytics.openQadaaLabel}
            </div>
            <div className="pulse-sub nums">
              <span>
                {AR_STRINGS.analytics.oldestDebtLabel}:{' '}
                {pulse.qadaa.oldestAgeDays !== null
                  ? `${pulse.qadaa.oldestAgeDays} يوم`
                  : '-'}
              </span>
              <span>
                {AR_STRINGS.analytics.addedLabel}: +{pulse.qadaa.added7d}
              </span>
              <span>
                {AR_STRINGS.analytics.clearedLabel}: -{pulse.qadaa.cleared7d}
              </span>
              <span>
                {AR_STRINGS.analytics.velocity7dLabel}:{' '}
                {pulse.qadaa.netVelocity7d > 0
                  ? `+${pulse.qadaa.netVelocity7d}`
                  : pulse.qadaa.netVelocity7d}
              </span>
            </div>
          </div>

          <div className="pulse-col">
            <span className="panel-meta">
              {AR_STRINGS.analytics.loggingCoverageLabel} (منع المراكمة)
            </span>
            <div className="pulse-kpi nums" data-testid="pulse-coverage">
              {Math.round(pulse.backlog.loggingCoverage7d * 100)}%
            </div>
            <div className="pulse-sub nums">
              <span>مسجّل: {pulse.backlog.logged7d}</span>
              <span>
                {AR_STRINGS.analytics.unloggedExpiredLabel}:{' '}
                {pulse.backlog.unloggedExpired7d}
              </span>
              <span>قيد الانتظار: {pulse.backlog.pending7d}</span>
            </div>
          </div>

          <div className="pulse-col">
            <span className="panel-meta">
              {AR_STRINGS.analytics.coreMissesLabel} (آخر 7 أيام)
            </span>
            <div className="pulse-kpi nums" data-testid="pulse-core-misses">
              {pulse.nonRecoverable.coreMisses7d}
            </div>
            <div className="pulse-sub nums">
              <span>
                إجمالي الفوات غير المقضي:{' '}
                {pulse.nonRecoverable.totalNonRecoverableMisses7d}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Insight 1: Weakest Spots (< 85%) + Adapting New Targets + Progression Trails */}
      <section className="panel" data-testid="analytics-weak-spots">
        <div className="panel-header">
          <h3 className="panel-title">
            أضعف النقاط (&lt; 85%) خلال 30 يوماً
          </h3>
          <span className="panel-meta">
            يشترط 5 أيام مسجّلة على الأقل (أو يومين للأعمال الأسبوعية)
          </span>
        </div>

        {adaptingTargets.length > 0 && (
          <div className="action-list">
            {adaptingTargets.map((item) => (
              <div
                key={`adapt-${item.action.id}`}
                className="qadaa-row"
                data-testid={`adapting-target-${item.action.id}`}
              >
                <div className="qadaa-info">
                  <div className="action-title-line">
                    <span className="action-title">{item.action.title}</span>
                    <span className="target-tag new-target-tag">
                      {AR_STRINGS.analytics.newTargetBadge}
                    </span>
                    <span className="target-tag">
                      {item.latestVersion.target_label}
                    </span>
                  </div>
                  <div className="qadaa-meta-row">
                    {item.period && <span>{item.period.title}</span>}
                    <span className="nums">
                      فترة التكيّف ({item.loggedUnderNewCount} من 5 أيام مسجّلة)
                    </span>
                  </div>
                  {item.progressionTrail && (
                    <div className="trail-row">
                      <span>{item.progressionTrail.formattedTrail}</span>
                    </div>
                  )}
                </div>
                <div className="qadaa-actions">
                  <RateBadge rate={item.consistency30d} />
                </div>
              </div>
            ))}
          </div>
        )}

        {weakSpots.length === 0 ? (
          <div className="empty-state" data-testid="analytics-empty-weak-spots">
            <span>{AR_STRINGS.analytics.emptyWeakSpots}</span>
          </div>
        ) : (
          <div className="action-list">
            {weakSpots.map((spot) => (
              <div
                key={`weak-${spot.action.id}`}
                className="qadaa-row"
                data-testid={`weak-spot-${spot.action.id}`}
              >
                <div className="qadaa-info">
                  <div className="action-title-line">
                    <span className="action-title">{spot.action.title}</span>
                    {spot.action.analytics_role === 'core_jamaah' && (
                      <span className="target-tag">
                        {AR_STRINGS.analytics.coreJamaahLabel}
                      </span>
                    )}
                    {!spot.action.is_qadaa_eligible &&
                      spot.action.analytics_role === 'core_habit' && (
                        <span className="target-tag">عادة أساسية</span>
                      )}
                  </div>
                  <div className="qadaa-meta-row nums">
                    {spot.period && <span>{spot.period.title}</span>}
                    <span>المسجّل: {spot.loggedCount}</span>
                    <span>الفائت: {spot.missedCount}</span>
                  </div>
                  {spot.progressionTrail && (
                    <div className="trail-row">
                      <span>المسار: {spot.progressionTrail.formattedTrail}</span>
                    </div>
                  )}
                </div>

                <div className="qadaa-actions">
                  <RateBadge rate={spot.consistency30d} />
                </div>
              </div>
            ))}
          </div>
        )}

        {progressionTrails.length > 0 && (
          <div className="schema-group" data-testid="analytics-progression-trails">
            <div className="schema-group-head">
              <strong>{AR_STRINGS.analytics.progressionTitle}</strong>
              <span className="panel-meta nums">
                {progressionTrails.length} أعمال مطوّرة
              </span>
            </div>
            <div className="action-list">
              {progressionTrails.map((trail) => {
                const act = actionsById.get(trail.actionId);
                return (
                  <div key={trail.actionId} className="qadaa-row">
                    <div className="qadaa-info">
                      <span className="action-title">
                        {act?.title ?? trail.actionId}
                      </span>
                      <div className="trail-row" data-testid="progression-trail-text">
                        <span>{trail.formattedTrail}</span>
                      </div>
                      <div className="qadaa-meta-row nums">
                        {trail.versions.map((ver) => (
                          <span key={ver.versionId} className="target-tag">
                            {ver.targetLabel} ({ver.effectiveFrom}
                            {ver.consistencyRate !== null
                              ? ` / ${formatRate(ver.consistencyRate)}`
                              : ''}
                            )
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Insight 2: Strict Side Isolation (TIME_BOUND vs DAILY_GROUP) */}
      <div className="analytics-split" data-testid="analytics-breakdown">
        {/* Time-Bound Windows */}
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">الفترات الموقوتة ({windowDays === 7 ? '7 أيام' : '30 يوماً'})</h3>
            <span className="panel-meta">
              فصل صريح بين {AR_STRINGS.analytics.coreJamaahLabel} و{AR_STRINGS.analytics.sunanLabel}
            </span>
          </div>

          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>الفترة</th>
                  <th>الإجمالي</th>
                  <th>{AR_STRINGS.analytics.coreJamaahLabel}</th>
                  <th>{AR_STRINGS.analytics.sunanLabel}</th>
                  <th>في الوقت</th>
                  <th>قضاء</th>
                </tr>
              </thead>
              <tbody>
                <tr className="summary-row">
                  <td>ملخص الفترات الموقوتة</td>
                  <td>
                    <RateBadge rate={breakdown.timeBoundSummary.overall.weightedRate} />
                  </td>
                  <td>
                    <RateBadge rate={breakdown.timeBoundSummary.coreJamaah.weightedRate} />
                  </td>
                  <td>
                    <RateBadge rate={breakdown.timeBoundSummary.sunanAndAdhkar.weightedRate} />
                  </td>
                  <td className="nums">
                    {formatRate(breakdown.timeBoundSummary.overall.onTimeRate)}
                  </td>
                  <td className="nums">
                    {formatRate(breakdown.timeBoundSummary.overall.qadaaRate)}
                  </td>
                </tr>
                {breakdown.timeBoundPeriods.map((row) => (
                  <tr key={row.period.id}>
                    <td>{row.period.title}</td>
                    <td>
                      <RateBadge rate={row.overall.weightedRate} />
                    </td>
                    <td>
                      <RateBadge rate={row.coreJamaah.weightedRate} />
                    </td>
                    <td>
                      <RateBadge rate={row.sunanAndAdhkar.weightedRate} />
                    </td>
                    <td className="nums">{formatRate(row.overall.onTimeRate)}</td>
                    <td className="nums">{formatRate(row.overall.qadaaRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Daily Habit Groups (Isolated) */}
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">المجموعات اليومية ({windowDays === 7 ? '7 أيام' : '30 يوماً'})</h3>
            <span className="panel-meta">معزولة تماماً عن حسابات الفترات</span>
          </div>

          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>المجموعة</th>
                  <th>الإجمالي</th>
                  <th>تم</th>
                  <th>قضاء</th>
                  <th>فات</th>
                  <th>مسجّل</th>
                </tr>
              </thead>
              <tbody>
                {renderSummaryMetrics(
                  'ملخص المجموعات اليومية',
                  breakdown.dailyGroupSummary.overall,
                )}
                {breakdown.dailyGroups.map((row) => (
                  <tr key={row.period.id}>
                    <td>{row.period.title}</td>
                    <td>
                      <RateBadge rate={row.overall.weightedRate} />
                    </td>
                    <td className="nums">{formatRate(row.overall.onTimeRate)}</td>
                    <td className="nums">{formatRate(row.overall.qadaaRate)}</td>
                    <td className="nums">{formatRate(row.overall.missedRate)}</td>
                    <td className="nums">{row.overall.loggedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
