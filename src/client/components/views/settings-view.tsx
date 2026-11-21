'use client';

import React from 'react';
import { AR_STRINGS } from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { IconExpiredAlert } from '../icons';
import { ActionsSection } from '../settings/actions-section';
import { BackupAuditSection } from '../settings/backup-audit-section';
import { NtfySection } from '../settings/ntfy-section';
import { PeriodsSection } from '../settings/periods-section';
import { RolloverLocationSection } from '../settings/rollover-location-section';

interface SettingsViewProps {
  onStatusMessage?: (msg: string) => void;
}

export function SettingsView({ onStatusMessage }: SettingsViewProps) {
  const { isOnline } = useMohasba();

  return (
    <div className="view-stack" aria-label={AR_STRINGS.settings.title}>
      {!isOnline && (
        <div
          className="offline-banner"
          data-testid="settings-offline-banner"
          role="status"
        >
          <IconExpiredAlert size="sm" />
          <span>{AR_STRINGS.settings.onlineOnlyBanner}</span>
        </div>
      )}

      <PeriodsSection />
      <ActionsSection />
      <RolloverLocationSection />
      <NtfySection />
      <BackupAuditSection onStatusMessage={onStatusMessage} />
    </div>
  );
}
