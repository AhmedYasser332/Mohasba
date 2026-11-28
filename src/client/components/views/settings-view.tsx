'use client';

import React, { useMemo } from 'react';
import {
  AR_STRINGS,
  DEFAULT_KEYBOARD_SHORTCUTS,
  normalizeShortcutChord,
  resolveEffectiveShortcuts,
  SHORTCUT_ACTION_IDS,
  type DefaultHomeView,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { usePersistedStringSet } from '../../utils/disclosure-storage';
import { IconChevronDown, IconExpiredAlert } from '../icons';
import { ActionsSection } from '../settings/actions-section';
import { BackupAuditSection } from '../settings/backup-audit-section';
import { GeneralPreferencesSection } from '../settings/general-section';
import { NtfySection } from '../settings/ntfy-section';
import { PeriodsSection } from '../settings/periods-section';
import { RolloverLocationSection } from '../settings/rollover-location-section';
import { ShortcutsSection } from '../settings/shortcuts-section';

type SettingsSectionKey =
  | 'general'
  | 'periods'
  | 'actions'
  | 'rollover'
  | 'ntfy'
  | 'shortcuts'
  | 'backup';

const ALL_SECTION_KEYS: readonly SettingsSectionKey[] = [
  'general',
  'periods',
  'actions',
  'rollover',
  'ntfy',
  'shortcuts',
  'backup',
];

const HOME_VIEW_LABELS: Record<DefaultHomeView, string> = {
  now: 'الآن',
  week: 'الجدول الأسبوعي',
  qadaa: 'القضاء',
  analytics: 'التحليلات',
};

interface SettingsViewProps {
  onStatusMessage?: (msg: string) => void;
}

interface AccordionSectionProps {
  sectionKey: SettingsSectionKey;
  testId: string;
  title: string;
  isOpen: boolean;
  onToggle: (key: SettingsSectionKey) => void;
  meta: React.ReactNode;
  children: React.ReactNode;
}

function AccordionSection({
  sectionKey,
  testId,
  title,
  isOpen,
  onToggle,
  meta,
  children,
}: AccordionSectionProps) {
  const triggerId = `settings-${sectionKey}-trigger`;
  const panelId = `settings-${sectionKey}-panel`;

  return (
    <section className="panel accordion-panel" data-testid={testId}>
      <h3 className="accordion-heading">
        <button
          type="button"
          id={triggerId}
          className="accordion-trigger"
          data-testid={`accordion-toggle-${sectionKey}`}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onToggle(sectionKey)}
        >
          <span className="accordion-title-group">
            <IconChevronDown
              size="sm"
              className={`accordion-chevron ${isOpen ? '' : 'is-closed'}`}
            />
            <span className="accordion-title-text">{title}</span>
          </span>
          <span className="accordion-meta">{meta}</span>
        </button>
      </h3>

      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="accordion-body"
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function SettingsView({ onStatusMessage }: SettingsViewProps) {
  const {
    isOnline,
    settings,
    periods,
    actions,
    ntfyConfigured,
    outbox,
  } = useMohasba();

  const [openSections, setOpenSections] = usePersistedStringSet(
    'mohasba.ui.settings-open-sections',
  );

  const toggleSection = (key: SettingsSectionKey) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => {
    setOpenSections(new Set(ALL_SECTION_KEYS));
  };

  const collapseAll = () => {
    setOpenSections(new Set());
  };

  const activePeriodsCount = useMemo(
    () => periods.filter((p) => p.archived_at === null).length,
    [periods],
  );
  const activeActionsCount = useMemo(
    () => actions.filter((a) => a.archived_at === null).length,
    [actions],
  );
  const customShortcutsCount = useMemo(() => {
    const effective = resolveEffectiveShortcuts(settings?.keyboard_shortcuts);
    let count = 0;
    for (const id of SHORTCUT_ACTION_IDS) {
      if (
        normalizeShortcutChord(effective[id]) !==
        normalizeShortcutChord(DEFAULT_KEYBOARD_SHORTCUTS[id])
      ) {
        count += 1;
      }
    }
    return count;
  }, [settings?.keyboard_shortcuts]);

  const attentionCount = useMemo(
    () => outbox.filter((item) => item.state === 'attention_needed').length,
    [outbox],
  );

  const openCount = useMemo(
    () => ALL_SECTION_KEYS.filter((k) => openSections.has(k)).length,
    [openSections],
  );
  const allExpanded = openCount === ALL_SECTION_KEYS.length;
  const noneExpanded = openCount === 0;

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

      <div className="settings-topbar">
        <div className="settings-topbar-summary">
          <strong>{AR_STRINGS.settings.title}</strong>
          <span className="count-chip nums">
            {openCount} / {ALL_SECTION_KEYS.length} مفتوح
          </span>
        </div>

        <div className="settings-topbar-actions">
          <button
            type="button"
            className="btn"
            data-testid="settings-expand-all-btn"
            disabled={allExpanded}
            onClick={expandAll}
          >
            توسيع الكل
          </button>
          <button
            type="button"
            className="btn"
            data-testid="settings-collapse-all-btn"
            disabled={noneExpanded}
            onClick={collapseAll}
          >
            طيّ الكل
          </button>
        </div>
      </div>

      {/* 1. General Preferences */}
      <AccordionSection
        sectionKey="general"
        testId="settings-general-section"
        title="التفضيلات والعرض العام"
        isOpen={openSections.has('general')}
        onToggle={toggleSection}
        meta={
          <span className="count-chip">
            الافتراضية: {HOME_VIEW_LABELS[settings?.default_home_view ?? 'now']}
          </span>
        }
      >
        <GeneralPreferencesSection />
      </AccordionSection>

      {/* 2. Periods & Groups */}
      <AccordionSection
        sectionKey="periods"
        testId="settings-periods-section"
        title="الفترات والمجموعات"
        isOpen={openSections.has('periods')}
        onToggle={toggleSection}
        meta={
          <span className="count-chip nums">{activePeriodsCount} نشطة</span>
        }
      >
        <PeriodsSection />
      </AccordionSection>

      {/* 3. Periods & Actions */}
      <AccordionSection
        sectionKey="actions"
        testId="settings-actions-section"
        title={AR_STRINGS.settings.schemaSectionTitle}
        isOpen={openSections.has('actions')}
        onToggle={toggleSection}
        meta={
          <span className="count-chip nums">{activeActionsCount} عمل</span>
        }
      >
        <ActionsSection />
      </AccordionSection>

      {/* 4. Islamic Rollover & Location */}
      <AccordionSection
        sectionKey="rollover"
        testId="settings-rollover-section"
        title={AR_STRINGS.settings.rolloverSectionTitle}
        isOpen={openSections.has('rollover')}
        onToggle={toggleSection}
        meta={
          <>
            <span className="count-chip">
              {settings?.rollover_mode === 'MIDNIGHT'
                ? 'منتصف الليل'
                : 'الفجر'}
            </span>
            {settings?.city_name && (
              <span className="count-chip">{settings.city_name}</span>
            )}
          </>
        }
      >
        <RolloverLocationSection />
      </AccordionSection>

      {/* 5. ntfy Alerts & Reminders */}
      <AccordionSection
        sectionKey="ntfy"
        testId="settings-ntfy-section"
        title={AR_STRINGS.settings.ntfySectionTitle}
        isOpen={openSections.has('ntfy')}
        onToggle={toggleSection}
        meta={
          <span className={`rate-pill ${ntfyConfigured ? 'good' : 'warn'}`}>
            {ntfyConfigured ? 'مُعدّ' : 'غير مُهيّأ'}
          </span>
        }
      >
        <NtfySection />
      </AccordionSection>

      {/* 6. Keyboard Shortcuts */}
      <AccordionSection
        sectionKey="shortcuts"
        testId="settings-shortcuts-section"
        title="اختصارات لوحة المفاتيح"
        isOpen={openSections.has('shortcuts')}
        onToggle={toggleSection}
        meta={
          <span className="count-chip nums">
            {customShortcutsCount > 0
              ? `${customShortcutsCount} مخصص`
              : 'الافتراضية'}
          </span>
        }
      >
        <ShortcutsSection />
      </AccordionSection>

      {/* 7. Backup, Audit & Session */}
      <AccordionSection
        sectionKey="backup"
        testId="settings-backup-section"
        title="النسخ الاحتياطي وسجل الأحداث والجلسة"
        isOpen={openSections.has('backup')}
        onToggle={toggleSection}
        meta={
          <>
            {attentionCount > 0 && (
              <span className="count-chip alert nums">
                {attentionCount} تنبيه مزامنة
              </span>
            )}
            <span className="count-chip">JSON</span>
          </>
        }
      >
        <BackupAuditSection onStatusMessage={onStatusMessage} />
      </AccordionSection>
    </div>
  );
}
