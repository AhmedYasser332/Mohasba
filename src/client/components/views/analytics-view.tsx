'use client';

import React from 'react';
import { AR_STRINGS } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';

export function AnalyticsView() {
  const { analytics7d, analytics30d } = useMohasba();

  return (
    <section className="panel" aria-label={AR_STRINGS.analytics.title}>
      <div className="panel-header">
        <h3 className="panel-title">{AR_STRINGS.analytics.title}</h3>
        <span className="panel-meta nums">
          نقاط الضعف (30 يوماً): {analytics30d?.weakSpots.length ?? 0}
        </span>
      </div>

      <div className="empty-state">
        <p className="m-0 nums">
          تغطية التسجيل آخر 7 أيام:{' '}
          {analytics7d
            ? `${Math.round(analytics7d.pulse.backlog.loggingCoverage7d)}%`
            : '-'}
        </p>
        <span className="panel-meta">
          لوحة التحليلات الكاملة تكتمل في المرحلة القادمة (Slice 5).
        </span>
      </div>
    </section>
  );
}
