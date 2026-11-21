'use client';

import React, { useState } from 'react';
import { AR_STRINGS } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { IconDownload, IconLogOut } from '../icons';

interface SettingsViewProps {
  onStatusMessage?: (msg: string) => void;
}

export function SettingsView({ onStatusMessage }: SettingsViewProps) {
  const { settings, periods, actions, syncBadge, buildOfflineExport, signOut } =
    useMohasba();
  const [signingOut, setSigningOut] = useState(false);

  const handleEmergencyExport = async () => {
    const data = await buildOfflineExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mohasba-emergency-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const res = await signOut();
      if (res.ok) {
        onStatusMessage?.('signed_out');
      } else {
        onStatusMessage?.(res.errorMessage ?? 'تعذر تسجيل الخروج');
      }
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <section className="panel" aria-label={AR_STRINGS.settings.title}>
      <div className="panel-header">
        <h3 className="panel-title">{AR_STRINGS.settings.title}</h3>
        <span className="panel-meta nums">
          {periods.length} فترات / {actions.length} عمل
        </span>
      </div>

      <div className="p-4 flex flex-col gap-4 text-sm">
        {settings && (
          <div className="panel-meta nums flex flex-wrap gap-3">
            <span>
              المدينة: {settings.city_name} ({settings.iana_timezone})
            </span>
            <span>
              نظام اليوم:{' '}
              {settings.rollover_mode === 'FAJR'
                ? 'من الفجر للفجر'
                : 'منتصف الليل'}
            </span>
          </div>
        )}

        <div className="panel-meta">
          إعدادات الفترات والأهداف وتنبيهات ntfy الكاملة تكتمل في المرحلة القادمة (Slice 5).
        </div>

        {syncBadge.activeCount > 0 && (
          <div className="confirm-banner">
            <span>{AR_STRINGS.settings.signOutUnsyncedWarning}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void handleEmergencyExport();
            }}
          >
            <IconDownload size="sm" />
            <span>{AR_STRINGS.settings.exportEmergencyButton}</span>
          </button>

          <button
            type="button"
            className="btn btn-danger"
            data-testid="signout-btn"
            disabled={signingOut}
            onClick={() => {
              void handleSignOut();
            }}
          >
            <IconLogOut size="sm" />
            <span>{AR_STRINGS.settings.signOutButton}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
