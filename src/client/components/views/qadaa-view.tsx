'use client';

import React from 'react';
import { AR_STRINGS } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';

interface QadaaViewProps {
  activeTab: string | null;
  onSelectTab: (tab: 'open' | 'catchup' | 'non_recoverable') => void;
}

export function QadaaView({ activeTab, onSelectTab }: QadaaViewProps) {
  const { openQadaaQueue, catchUp48hItems, nonRecoverableMisses } =
    useMohasba();

  const currentTab =
    activeTab === 'catchup' || activeTab === 'non_recoverable'
      ? activeTab
      : 'open';

  return (
    <section className="panel" aria-label={AR_STRINGS.qadaa.title}>
      <div className="panel-header">
        <h3 className="panel-title">{AR_STRINGS.qadaa.title}</h3>
        <div className="seg-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={currentTab === 'open'}
            onClick={() => onSelectTab('open')}
          >
            <span>{AR_STRINGS.qadaa.tabOpenQadaa}</span>
            <span className="count-chip nums">{openQadaaQueue.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={currentTab === 'catchup'}
            onClick={() => onSelectTab('catchup')}
          >
            <span>{AR_STRINGS.qadaa.tabCatchUp48h}</span>
            <span className="count-chip nums">{catchUp48hItems.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            className="seg-tab"
            aria-selected={currentTab === 'non_recoverable'}
            onClick={() => onSelectTab('non_recoverable')}
          >
            <span>{AR_STRINGS.qadaa.tabNonRecoverable}</span>
            <span className="count-chip nums">
              {nonRecoverableMisses.length}
            </span>
          </button>
        </div>
      </div>

      <div className="empty-state">
        <p className="m-0">
          {currentTab === 'open'
            ? `لديك ${openQadaaQueue.length} عنصر قضاء مفتوح.`
            : currentTab === 'catchup'
              ? `لديك ${catchUp48hItems.length} عنصر منتهٍ غير مسجّل خلال آخر 48 ساعة.`
              : `لديك ${nonRecoverableMisses.length} فوات غير قابل للقضاء خلال آخر 30 يوماً.`}
        </p>
        <span className="panel-meta">
          واجهة القضاء الكاملة تكتمل في المرحلة القادمة (Slice 5).
        </span>
      </div>
    </section>
  );
}
