'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AR_STRINGS,
  TEMPLATE_CATALOG,
  buildTemplateBundle,
  type Action,
  type CalcMethod,
  type Period,
  type RolloverMode,
  type TargetVersion,
  type TemplateLevelId,
} from '@/domain';
import type { InitOnboardingPayload } from '../../store/mohasba-provider';
import {
  ARABIC_NOUN_FORMS,
  formatArabicCount,
} from '../../utils/arabic-plural';
import {
  CALC_METHODS,
  CITY_PRESETS,
  generateSecureNtfyTopicUrl,
} from '../../utils/presets';
import { buildActionMetaBadges } from '../../utils/template-badges';
import {
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconExpiredAlert,
  IconPlus,
  IconRefresh,
  IconUpload,
  IconX,
} from '../icons';

interface OnboardingWizardProps {
  busy: boolean;
  error: string | null;
  onComplete: (payload: InitOnboardingPayload) => Promise<void>;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

interface QuickCustomAction {
  localId: string;
  periodId: string;
  title: string;
}

const ANCHOR_LABELS: Record<string, string> = {
  FAJR: 'الفجر',
  SUNRISE: 'الشروق',
  DHUHR: 'الظهر',
  ASR: 'العصر',
  MAGHRIB: 'المغرب',
  ISHA: 'العشاء',
  FIXED_TIME: 'وقت ثابت',
};

function formatPeriodWindowBrief(period: Period): string {
  if (period.side !== 'TIME_BOUND') return 'مجموعة يومية';
  const start = ANCHOR_LABELS[period.start_anchor ?? ''] ?? 'الفجر';
  const end = ANCHOR_LABELS[period.end_anchor ?? ''] ?? 'الشروق';
  return `من ${start} إلى ${end}`;
}

function validateClientNtfyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return 'يجب أن يبدأ رابط قناة ntfy بـ https://';
    }
    if (!parsed.pathname || parsed.pathname === '/') {
      return 'أضف اسم القناة في نهاية الرابط مثل https://ntfy.sh/mohasba-...';
    }
    return null;
  } catch {
    return 'رابط القناة غير صالح، مثال: https://ntfy.sh/mohasba-...';
  }
}

export function OnboardingWizard({
  busy,
  error,
  onComplete,
  onImportFile,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedLevel, setSelectedLevel] = useState<TemplateLevelId>('level_1');
  const [isBlankMode, setIsBlankMode] = useState(false);

  // Per-level customization state so switching levels preserves user's tweaks cleanly
  const [excludedPeriodsByLevel, setExcludedPeriodsByLevel] = useState<
    Record<TemplateLevelId, string[]>
  >({ level_1: [], level_2: [], level_3: [] });
  const [excludedActionsByLevel, setExcludedActionsByLevel] = useState<
    Record<TemplateLevelId, string[]>
  >({ level_1: [], level_2: [], level_3: [] });
  const [customActionsByLevel, setCustomActionsByLevel] = useState<
    Record<TemplateLevelId, QuickCustomAction[]>
  >({ level_1: [], level_2: [], level_3: [] });

  const [expandedPeriodIds, setExpandedPeriodIds] = useState<Record<string, boolean>>({});
  const [quickAddDrafts, setQuickAddDrafts] = useState<Record<string, string>>({});
  const [previewSearch, setPreviewSearch] = useState('');

  // Step 2: General Settings (Location, Rollover, Global ntfy)
  const [cityPresetId, setCityPresetId] = useState<string>('cairo');
  const [calcMethod, setCalcMethod] = useState<CalcMethod>('Egyptian');
  const [rolloverMode, setRolloverMode] = useState<RolloverMode>('FAJR');
  const [ntfyGlobalEnabled, setNtfyGlobalEnabled] = useState(false);
  const [ntfyTopicUrl, setNtfyTopicUrl] = useState('');
  const [ntfyToken, setNtfyToken] = useState('');
  const [ntfyUrlError, setNtfyUrlError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const didMountStepRef = useRef(false);

  // Move focus & scroll smoothly to heading whenever user moves between Step 1 and Step 2
  useEffect(() => {
    if (!didMountStepRef.current) {
      didMountStepRef.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const activeBundle = useMemo(
    () => buildTemplateBundle(selectedLevel),
    [selectedLevel],
  );

  const excludedPeriodSet = useMemo(
    () => new Set(excludedPeriodsByLevel[selectedLevel]),
    [excludedPeriodsByLevel, selectedLevel],
  );
  const excludedActionSet = useMemo(
    () => new Set(excludedActionsByLevel[selectedLevel]),
    [excludedActionsByLevel, selectedLevel],
  );
  const customActions = customActionsByLevel[selectedLevel];

  const targetByActionId = useMemo(() => {
    const map = new Map<string, TargetVersion>();
    for (const tv of activeBundle.targetVersions) {
      map.set(tv.action_id, tv);
    }
    return map;
  }, [activeBundle.targetVersions]);

  const actionsByPeriodId = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const action of activeBundle.actions) {
      const list = map.get(action.period_id) ?? [];
      list.push(action);
      map.set(action.period_id, list);
    }
    return map;
  }, [activeBundle.actions]);

  const customActionsByPeriodId = useMemo(() => {
    const map = new Map<string, QuickCustomAction[]>();
    for (const item of customActions) {
      const list = map.get(item.periodId) ?? [];
      list.push(item);
      map.set(item.periodId, list);
    }
    return map;
  }, [customActions]);

  const selectionSummary = useMemo(() => {
    let keptPeriods = 0;
    let keptActions = 0;
    for (const period of activeBundle.periods) {
      if (excludedPeriodSet.has(period.id)) continue;
      const baseActions = actionsByPeriodId.get(period.id) ?? [];
      const customInPeriod = customActionsByPeriodId.get(period.id) ?? [];
      const activeCount =
        baseActions.filter((a) => !excludedActionSet.has(a.id)).length +
        customInPeriod.length;
      if (activeCount > 0) {
        keptPeriods += 1;
        keptActions += activeCount;
      }
    }
    return { keptPeriods, keptActions };
  }, [
    activeBundle.periods,
    actionsByPeriodId,
    customActionsByPeriodId,
    excludedActionSet,
    excludedPeriodSet,
  ]);

  const hasCustomizations =
    excludedPeriodSet.size > 0 ||
    excludedActionSet.size > 0 ||
    customActions.length > 0;

  const normalizedSearch = previewSearch.trim().toLowerCase();

  const allExpanded = useMemo(
    () =>
      activeBundle.periods.length > 0 &&
      activeBundle.periods.every((p) => Boolean(expandedPeriodIds[p.id])),
    [activeBundle.periods, expandedPeriodIds],
  );

  const toggleAllExpanded = () => {
    const nextState = !allExpanded;
    const next: Record<string, boolean> = {};
    for (const p of activeBundle.periods) {
      next[p.id] = nextState;
    }
    setExpandedPeriodIds(next);
  };

  const togglePeriodExpanded = (periodId: string) => {
    setExpandedPeriodIds((prev) => ({ ...prev, [periodId]: !prev[periodId] }));
  };

  const togglePeriodIncluded = (periodId: string) => {
    setLocalError(null);
    const baseActions = actionsByPeriodId.get(periodId) ?? [];
    const customInPeriod = customActionsByPeriodId.get(periodId) ?? [];
    const keptInPeriod =
      baseActions.filter((a) => !excludedActionSet.has(a.id)).length +
      customInPeriod.length;
    const isCurrentlyIncluded = !excludedPeriodSet.has(periodId) && keptInPeriod > 0;

    if (isCurrentlyIncluded) {
      setExcludedPeriodsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: Array.from(new Set([...prev[selectedLevel], periodId])),
      }));
    } else {
      const baseActionIds = new Set(baseActions.map((a) => a.id));
      setExcludedPeriodsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: prev[selectedLevel].filter((id) => id !== periodId),
      }));
      setExcludedActionsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: prev[selectedLevel].filter((id) => !baseActionIds.has(id)),
      }));
    }
  };

  const toggleActionIncluded = (periodId: string, actionId: string) => {
    setLocalError(null);
    const isPeriodExcluded = excludedPeriodSet.has(periodId);
    if (isPeriodExcluded) {
      const siblingIds = (actionsByPeriodId.get(periodId) ?? [])
        .map((a) => a.id)
        .filter((id) => id !== actionId);
      setExcludedPeriodsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: prev[selectedLevel].filter((id) => id !== periodId),
      }));
      setExcludedActionsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: Array.from(
          new Set([
            ...prev[selectedLevel].filter((id) => id !== actionId),
            ...siblingIds,
          ]),
        ),
      }));
      return;
    }

    setExcludedActionsByLevel((prev) => {
      const current = prev[selectedLevel];
      const next = current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId];
      return { ...prev, [selectedLevel]: next };
    });
  };

  const handleQuickAddAction = (periodId: string) => {
    const raw = (quickAddDrafts[periodId] ?? '').trim();
    if (!raw) return;
    if (customActions.length >= 50) {
      setLocalError(
        'يمكنك إضافة حتى 50 عملاً سريعاً هنا، والباقي بسهولة من الإعدادات لاحقاً.',
      );
      return;
    }
    setLocalError(null);
    const localId = crypto.randomUUID();
    setCustomActionsByLevel((prev) => ({
      ...prev,
      [selectedLevel]: [
        ...prev[selectedLevel],
        { localId, periodId, title: raw.slice(0, 120) },
      ],
    }));
    if (excludedPeriodSet.has(periodId)) {
      setExcludedPeriodsByLevel((prev) => ({
        ...prev,
        [selectedLevel]: prev[selectedLevel].filter((id) => id !== periodId),
      }));
    }
    setQuickAddDrafts((prev) => ({ ...prev, [periodId]: '' }));
  };

  const handleRemoveCustomAction = (localId: string) => {
    setCustomActionsByLevel((prev) => ({
      ...prev,
      [selectedLevel]: prev[selectedLevel].filter((c) => c.localId !== localId),
    }));
  };

  const handleResetLevelCustomizations = () => {
    setExcludedPeriodsByLevel((prev) => ({ ...prev, [selectedLevel]: [] }));
    setExcludedActionsByLevel((prev) => ({ ...prev, [selectedLevel]: [] }));
    setCustomActionsByLevel((prev) => ({ ...prev, [selectedLevel]: [] }));
    setLocalError(null);
  };

  const handleCityPresetChange = (presetId: string) => {
    setCityPresetId(presetId);
    const preset = CITY_PRESETS.find((c) => c.id === presetId);
    if (preset) {
      setCalcMethod(preset.calc_method);
    }
  };

  const handleCopyNtfyUrl = async () => {
    if (!ntfyTopicUrl.trim()) return;
    try {
      await navigator.clipboard.writeText(ntfyTopicUrl.trim());
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard blocked in non-secure contexts; URL remains selectable in input.
    }
  };

  const handleLevelCardKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    // RTL visual flow: ArrowLeft moves to next card, ArrowRight moves to previous
    let nextIdx = -1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % TEMPLATE_CATALOG.length;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + TEMPLATE_CATALOG.length) % TEMPLATE_CATALOG.length;
    }
    if (nextIdx >= 0) {
      e.preventDefault();
      const nextMeta = TEMPLATE_CATALOG[nextIdx]!;
      setIsBlankMode(false);
      setSelectedLevel(nextMeta.id);
      setLocalError(null);
      const nextBtn = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
        `[data-testid="onboarding-level-${nextMeta.id}"]`,
      );
      nextBtn?.focus();
    }
  };

  const buildSettingsPatch = (skipCustomSettings: boolean): Record<string, unknown> => {
    if (skipCustomSettings) {
      return { ntfy_master_enabled: false };
    }
    const preset =
      CITY_PRESETS.find((c) => c.id === cityPresetId) ?? CITY_PRESETS[0]!;
    const patch: Record<string, unknown> = {
      city_name: preset.city_name,
      iana_timezone: preset.iana_timezone,
      latitude: preset.latitude,
      longitude: preset.longitude,
      calc_method: calcMethod,
      rollover_mode: rolloverMode,
      ntfy_master_enabled: ntfyGlobalEnabled,
    };
    if (ntfyGlobalEnabled && ntfyTopicUrl.trim()) {
      patch.ntfy_topic_url = ntfyTopicUrl.trim();
      if (ntfyToken.trim()) {
        patch.ntfy_access_token = ntfyToken.trim();
      }
    }
    return patch;
  };

  const submitOnboarding = async (options: {
    blank?: boolean;
    skipSettings?: boolean;
  }) => {
    setLocalError(null);
    const blank = options.blank ?? isBlankMode;
    const skipSettings = options.skipSettings ?? false;

    if (!skipSettings && ntfyGlobalEnabled) {
      const urlErr = validateClientNtfyUrl(ntfyTopicUrl);
      if (urlErr) {
        setNtfyUrlError(urlErr);
        return;
      }
    }
    setNtfyUrlError(null);

    if (!blank && selectionSummary.keptActions === 0) {
      setLocalError(
        'اختر عملاً واحداً على الأقل من المعاينة، أو اختر البدء بجدول فارغ.',
      );
      return;
    }

    if (blank) {
      await onComplete({
        mode: 'blank',
        settings_patch: buildSettingsPatch(skipSettings),
      });
      return;
    }

    const effectiveExcludedPeriods = new Set(excludedPeriodSet);
    for (const p of activeBundle.periods) {
      const baseActions = actionsByPeriodId.get(p.id) ?? [];
      const customInPeriod = customActionsByPeriodId.get(p.id) ?? [];
      const keptCount =
        baseActions.filter((a) => !excludedActionSet.has(a.id)).length +
        customInPeriod.length;
      if (keptCount === 0) {
        effectiveExcludedPeriods.add(p.id);
      }
    }

    const effectiveNtfyPeriods = skipSettings ? false : ntfyGlobalEnabled;

    await onComplete({
      mode: 'template',
      level: selectedLevel,
      excluded_period_ids: Array.from(effectiveExcludedPeriods),
      excluded_action_ids: Array.from(excludedActionSet),
      custom_actions: customActions
        .filter((c) => !effectiveExcludedPeriods.has(c.periodId))
        .map((c) => ({ id: c.localId, period_id: c.periodId, title: c.title })),
      ntfy_all_periods_enabled: effectiveNtfyPeriods,
      settings_patch: buildSettingsPatch(skipSettings),
    });
  };

  const renderPeriodGroup = (side: 'TIME_BOUND' | 'DAILY_GROUP', heading: string) => {
    const groupPeriods = activeBundle.periods.filter((p) => {
      if (p.side !== side) return false;
      if (!normalizedSearch) return true;
      if (p.title.toLowerCase().includes(normalizedSearch)) return true;
      const base = actionsByPeriodId.get(p.id) ?? [];
      const custom = customActionsByPeriodId.get(p.id) ?? [];
      return (
        base.some((a) => a.title.toLowerCase().includes(normalizedSearch)) ||
        custom.some((c) => c.title.toLowerCase().includes(normalizedSearch))
      );
    });
    if (groupPeriods.length === 0) return null;

    return (
      <div className="onboarding-preview-group">
        <div className="schema-side-heading">{heading}</div>
        <div className="onboarding-period-list">
          {groupPeriods.map((period) => {
            const baseActions = actionsByPeriodId.get(period.id) ?? [];
            const customInPeriod = customActionsByPeriodId.get(period.id) ?? [];
            const periodMatchesSearch =
              !normalizedSearch ||
              period.title.toLowerCase().includes(normalizedSearch);
            const visibleBaseActions = periodMatchesSearch
              ? baseActions
              : baseActions.filter((a) =>
                  a.title.toLowerCase().includes(normalizedSearch),
                );
            const visibleCustomActions = periodMatchesSearch
              ? customInPeriod
              : customInPeriod.filter((c) =>
                  c.title.toLowerCase().includes(normalizedSearch),
                );

            const isPeriodExcluded = excludedPeriodSet.has(period.id);
            const totalCount = baseActions.length + customInPeriod.length;
            const keptCount = isPeriodExcluded
              ? 0
              : baseActions.filter((a) => !excludedActionSet.has(a.id)).length +
                customInPeriod.length;
            const isChecked = keptCount > 0 && keptCount === totalCount;
            const isIndeterminate = keptCount > 0 && keptCount < totalCount;
            const isExpanded =
              Boolean(normalizedSearch) || Boolean(expandedPeriodIds[period.id]);

            return (
              <div
                key={period.id}
                className={`onboarding-period-card ${keptCount === 0 ? 'is-excluded' : ''}`}
                data-testid={`preview-period-card-${period.id}`}
              >
                <div className="onboarding-period-head">
                  <label className="onboarding-period-check-wrap">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = isIndeterminate;
                      }}
                      data-testid={`preview-period-toggle-${period.id}`}
                      aria-label={`تضمين ${period.title}`}
                      disabled={busy}
                      onChange={() => togglePeriodIncluded(period.id)}
                    />
                  </label>

                  <button
                    type="button"
                    className="onboarding-period-disclosure"
                    aria-expanded={isExpanded}
                    data-testid={`preview-period-expand-${period.id}`}
                    onClick={() => togglePeriodExpanded(period.id)}
                  >
                    <span className="onboarding-period-title-block">
                      <span className="onboarding-period-title">{period.title}</span>
                      <span className="onboarding-period-sub">
                        {formatPeriodWindowBrief(period)}
                      </span>
                    </span>
                    <span className="onboarding-period-right">
                      <span className="onboarding-period-count nums" dir="ltr">
                        {keptCount} / {totalCount}
                      </span>
                      <IconChevronDown
                        size="sm"
                        className={`accordion-chevron ${isExpanded ? '' : 'is-closed'}`}
                      />
                    </span>
                  </button>
                </div>

                {isExpanded && (
                  <div className="onboarding-period-body">
                    <div className="onboarding-actions-list">
                      {visibleBaseActions.map((action) => {
                        const checked =
                          !isPeriodExcluded && !excludedActionSet.has(action.id);
                        const badges = buildActionMetaBadges(action, targetByActionId);
                        return (
                          <label
                            key={action.id}
                            className={`onboarding-action-row ${checked ? '' : 'is-unchecked'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              data-testid={`preview-action-toggle-${action.id}`}
                              disabled={busy}
                              onChange={() =>
                                toggleActionIncluded(period.id, action.id)
                              }
                            />
                            <span className="onboarding-action-title">
                              {action.title}
                            </span>
                            {badges.length > 0 && (
                              <span className="onboarding-action-badges">
                                {badges.map((badge) => (
                                  <span
                                    key={badge}
                                    className="onboarding-meta-pill nums"
                                  >
                                    {badge}
                                  </span>
                                ))}
                              </span>
                            )}
                          </label>
                        );
                      })}

                      {visibleCustomActions.map((custom) => (
                        <div
                          key={custom.localId}
                          className="onboarding-action-row is-custom"
                          data-testid="preview-custom-action-row"
                        >
                          <span className="onboarding-custom-dot" aria-hidden="true">
                            <IconCheck size="sm" />
                          </span>
                          <span className="onboarding-action-title">
                            <bdi>{custom.title}</bdi>
                          </span>
                          <span className="onboarding-action-badges">
                            <span className="onboarding-meta-pill">عمل مضاف</span>
                          </span>
                          <button
                            type="button"
                            className="btn btn-icon onboarding-remove-custom-btn"
                            aria-label={`حذف ${custom.title}`}
                            disabled={busy}
                            onClick={() => handleRemoveCustomAction(custom.localId)}
                          >
                            <IconX size="sm" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="onboarding-quick-add">
                      <input
                        type="text"
                        className="field-input"
                        maxLength={120}
                        aria-label={`إضافة عمل سريع داخل ${period.title}`}
                        placeholder="إضافة عمل سريع..."
                        value={quickAddDrafts[period.id] ?? ''}
                        data-testid={`preview-quick-add-input-${period.id}`}
                        disabled={busy}
                        onChange={(e) =>
                          setQuickAddDrafts((prev) => ({
                            ...prev,
                            [period.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleQuickAddAction(period.id);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn"
                        data-testid={`preview-quick-add-btn-${period.id}`}
                        disabled={busy || !(quickAddDrafts[period.id] ?? '').trim()}
                        onClick={() => handleQuickAddAction(period.id)}
                      >
                        <IconPlus size="sm" />
                        <span>إضافة</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const displayedError = localError ?? error;
  const timeGroupEl = renderPeriodGroup(
    'TIME_BOUND',
    'الفترات الموقوتة (المرتبطة بالصلاة)',
  );
  const dailyGroupEl = renderPeriodGroup(
    'DAILY_GROUP',
    'المجموعات اليومية والأسبوعية',
  );
  const hasSearchMatches = Boolean(timeGroupEl || dailyGroupEl);

  return (
    <section
      className="panel onboarding-shell"
      data-testid="onboarding-wizard"
      aria-labelledby="onboarding-heading"
    >
      <div className="panel-header onboarding-header">
        <div>
          <h2
            ref={headingRef}
            id="onboarding-heading"
            tabIndex={-1}
            className="panel-title onboarding-heading-focus"
          >
            {AR_STRINGS.authAndOnboarding.onboardingTitle}
          </h2>
          <p className="panel-meta m-0 mt-1">
            {step === 1
              ? 'اختر المستوى المناسب لك، عاين أعماله وعدّلها بحرية قبل البدء.'
              : 'اضبط الموقع وبداية اليوم والتنبيهات العامة مرة واحدة (قابلة للتعديل لاحقاً).'}
          </p>
        </div>

        <ol className="onboarding-stepper" aria-label="خطوات الإعداد">
          <li className={step === 1 ? 'is-active' : 'is-done'}>
            <span className="onboarding-step-num nums">1</span>
            <span>اختيار المستوى والمعاينة</span>
          </li>
          <li className={step === 2 ? 'is-active' : ''}>
            <span className="onboarding-step-num nums">2</span>
            <span>الإعدادات العامة</span>
          </li>
        </ol>
      </div>

      <div className="onboarding-body">
        {displayedError && (
          <div className="confirm-banner delete-warn-banner" role="alert">
            <span className="delete-warn-icon" aria-hidden="true">
              <IconExpiredAlert size="sm" />
            </span>
            <span>{displayedError}</span>
          </div>
        )}

        {step === 1 && (
          <>
            <div
              className="onboarding-level-grid"
              role="radiogroup"
              aria-label="مستويات جدول المحاسبة"
            >
              {TEMPLATE_CATALOG.map((meta, idx) => {
                const active = !isBlankMode && selectedLevel === meta.id;
                const isTabStop = active || (isBlankMode && idx === 0);
                return (
                  <button
                    key={meta.id}
                    type="button"
                    role="radio"
                    tabIndex={isTabStop ? 0 : -1}
                    aria-checked={active}
                    className={`onboarding-level-card ${active ? 'is-selected' : ''}`}
                    data-testid={`onboarding-level-${meta.id}`}
                    disabled={busy}
                    onKeyDown={(e) => handleLevelCardKeyDown(e, idx)}
                    onClick={() => {
                      setIsBlankMode(false);
                      setSelectedLevel(meta.id);
                      setLocalError(null);
                    }}
                  >
                    <div className="onboarding-level-head">
                      <span className="onboarding-level-title">{meta.title}</span>
                      <span className="onboarding-level-badge">{meta.badge}</span>
                    </div>
                    <div className="onboarding-level-subtitle">{meta.subtitle}</div>
                    <p className="onboarding-level-desc">{meta.description}</p>
                    <div className="onboarding-level-counts nums">
                      <span>
                        {formatArabicCount(meta.periodCount, ARABIC_NOUN_FORMS.section)}
                      </span>
                      <span>
                        {formatArabicCount(meta.actionCount, ARABIC_NOUN_FORMS.action)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="onboarding-alt-bar">
              <button
                type="button"
                className={`btn ${isBlankMode ? 'btn-live' : ''}`}
                data-testid="onboarding-blank"
                disabled={busy}
                onClick={() => {
                  setIsBlankMode(true);
                  setStep(2);
                  setLocalError(null);
                }}
              >
                <span>{AR_STRINGS.authAndOnboarding.onboardingBlank}</span>
              </button>

              <button
                type="button"
                className="btn"
                data-testid="onboarding-import"
                disabled={busy}
                onClick={() => importInputRef.current?.click()}
              >
                <IconUpload size="sm" />
                <span>
                  استيراد نسخة احتياطية <bdi>JSON</bdi>
                </span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  void onImportFile(e);
                }}
              />
            </div>

            {!isBlankMode && (
              <div
                className="onboarding-preview"
                data-testid="onboarding-preview"
              >
                <div className="onboarding-preview-bar">
                  <div className="flex flex-col gap-0.5">
                    <strong className="text-[0.875rem]">
                      معاينة وتخصيص «
                      {TEMPLATE_CATALOG.find((m) => m.id === selectedLevel)?.title}»
                    </strong>
                    <span
                      className="panel-meta nums"
                      data-testid="onboarding-selected-count"
                    >
                      المختار حالياً:{' '}
                      {formatArabicCount(
                        selectionSummary.keptActions,
                        ARABIC_NOUN_FORMS.action,
                      )}{' '}
                      في{' '}
                      {formatArabicCount(
                        selectionSummary.keptPeriods,
                        ARABIC_NOUN_FORMS.section,
                      )}
                    </span>
                  </div>

                  <div className="onboarding-preview-tools">
                    <input
                      type="search"
                      className="field-input onboarding-search-input"
                      aria-label="بحث داخل أعمال المستوى"
                      placeholder="ابحث عن عمل أو فترة..."
                      value={previewSearch}
                      data-testid="onboarding-preview-search"
                      disabled={busy}
                      onChange={(e) => setPreviewSearch(e.target.value)}
                    />
                    {hasCustomizations && (
                      <button
                        type="button"
                        className="btn"
                        data-testid="onboarding-reset-preview"
                        disabled={busy}
                        onClick={handleResetLevelCustomizations}
                      >
                        <IconRefresh size="sm" />
                        <span>استعادة الكل</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      data-testid="onboarding-toggle-expand-all"
                      aria-expanded={allExpanded}
                      disabled={busy}
                      onClick={toggleAllExpanded}
                    >
                      <span>{allExpanded ? 'طي الكل' : 'توسيع الكل'}</span>
                    </button>
                  </div>
                </div>

                {hasSearchMatches ? (
                  <div className="onboarding-preview-columns">
                    {timeGroupEl}
                    {dailyGroupEl}
                  </div>
                ) : (
                  <div className="empty-state">
                    <span>لا توجد نتائج مطابقة للبحث «{previewSearch.trim()}».</span>
                  </div>
                )}

                <p className="panel-meta onboarding-preview-footnote m-0">
                  تم ضبط الإعدادات الافتراضية الذكية لكل عمل تلقائياً (أعمال المسجد، القضاء، النسبة المئوية، والأيام المحددة). للتخصيص الكامل لأي عمل جديد يمكنك تعديله بسهولة من الإعدادات بعد الدخول.
                </p>
              </div>
            )}

            <div className="onboarding-footer">
              <button
                type="button"
                className="btn btn-live"
                data-testid="onboarding-next-step"
                disabled={busy || (!isBlankMode && selectionSummary.keptActions === 0)}
                onClick={() => {
                  setLocalError(null);
                  setStep(2);
                }}
              >
                <span>التالي: الإعدادات العامة</span>
                <IconChevronLeft size="sm" />
              </button>

              <button
                type="button"
                className="btn"
                data-testid="onboarding-quick-start"
                disabled={busy || (!isBlankMode && selectionSummary.keptActions === 0)}
                onClick={() => {
                  void submitOnboarding({ blank: false, skipSettings: true });
                }}
              >
                <span>
                  {busy ? 'جاري التهيئة...' : 'بدء مباشر بالإعدادات الافتراضية'}
                </span>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="onboarding-step2" data-testid="onboarding-step-2">
            <div className="onboarding-settings-grid">
              <div className="settings-subpanel">
                <div className="settings-subpanel-head">
                  <strong>الموقع ومواقيت الصلاة وبداية اليوم</strong>
                  <span className="panel-meta">لحساب أوقات الفترات بدقة</span>
                </div>

                <div className="onboarding-subpanel-body">
                  <div className="field-grid">
                    <label className="field-label">
                      <span>المدينة</span>
                      <select
                        id="onb-city"
                        className="field-select"
                        data-testid="onboarding-city-select"
                        value={cityPresetId}
                        disabled={busy}
                        onChange={(e) => handleCityPresetChange(e.target.value)}
                      >
                        {CITY_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.city_name} ({preset.iana_timezone})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-label">
                      <span>طريقة الحساب</span>
                      <select
                        id="onb-calc"
                        className="field-select"
                        data-testid="onboarding-calc-select"
                        value={calcMethod}
                        disabled={busy}
                        onChange={(e) => setCalcMethod(e.target.value as CalcMethod)}
                      >
                        {CALC_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="field-label">
                    <span>بداية اليوم المحاسبي</span>
                    <div
                      className="pref-seg-group onboarding-rollover-seg"
                      role="radiogroup"
                      aria-label="بداية اليوم المحاسبي"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={rolloverMode === 'FAJR'}
                        className={`pref-seg-btn ${rolloverMode === 'FAJR' ? 'is-active' : ''}`}
                        data-testid="onboarding-rollover-fajr"
                        disabled={busy}
                        onClick={() => setRolloverMode('FAJR')}
                      >
                        الفجر (موصى به)
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={rolloverMode === 'MIDNIGHT'}
                        className={`pref-seg-btn ${rolloverMode === 'MIDNIGHT' ? 'is-active' : ''}`}
                        data-testid="onboarding-rollover-midnight"
                        disabled={busy}
                        onClick={() => setRolloverMode('MIDNIGHT')}
                      >
                        منتصف الليل (<bdi>12:00 AM</bdi>)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-subpanel">
                <div className="settings-subpanel-head">
                  <span className="flex items-center gap-1.5">
                    <IconBell size="sm" />
                    <strong>
                      تنبيهات <bdi>ntfy</bdi> العامة
                    </strong>
                  </span>
                  <span className="panel-meta">
                    تحكم موحّد بدلاً من ضبط كل فترة منفردة
                  </span>
                </div>

                <div className="onboarding-subpanel-body">
                  <label className="onboarding-global-switch">
                    <input
                      type="checkbox"
                      checked={ntfyGlobalEnabled}
                      data-testid="onboarding-ntfy-global"
                      disabled={busy}
                      onChange={(e) => {
                        setNtfyGlobalEnabled(e.target.checked);
                        if (!e.target.checked) setNtfyUrlError(null);
                      }}
                    />
                    <span className="flex flex-col gap-0.5">
                      <strong>
                        تفعيل تنبيهات <bdi>ntfy</bdi> لجميع الفترات الموقوتة
                      </strong>
                      <span className="panel-meta">
                        {ntfyGlobalEnabled
                          ? 'سيتم تفعيل التذكير الذكي قبل انتهاء كل فترة موقوتة دفعة واحدة.'
                          : 'متوقفة بشكل عام — يمكنك تفعيلها أو تخصيصها في أي وقت من الإعدادات.'}
                      </span>
                    </span>
                  </label>

                  {ntfyGlobalEnabled && (
                    <div className="flex flex-col gap-3">
                      <div className="field-label">
                        <label htmlFor="onb-ntfy-url">
                          رابط قناة <bdi>ntfy</bdi> الخاصة (اختياري الآن)
                        </label>
                        <div className="onboarding-url-row">
                          <input
                            id="onb-ntfy-url"
                            type="url"
                            dir="ltr"
                            className="field-input onboarding-ltr-input"
                            placeholder="https://ntfy.sh/mohasba-..."
                            value={ntfyTopicUrl}
                            aria-invalid={Boolean(ntfyUrlError)}
                            aria-describedby={ntfyUrlError ? 'onb-ntfy-url-error' : undefined}
                            data-testid="onboarding-ntfy-url"
                            disabled={busy}
                            onChange={(e) => {
                              setNtfyTopicUrl(e.target.value);
                              if (ntfyUrlError) {
                                setNtfyUrlError(
                                  validateClientNtfyUrl(e.target.value),
                                );
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn"
                            data-testid="onboarding-ntfy-generate"
                            disabled={busy}
                            onClick={() => {
                              setNtfyTopicUrl(generateSecureNtfyTopicUrl());
                              setNtfyUrlError(null);
                            }}
                          >
                            توليد رابط خاص
                          </button>
                          {ntfyTopicUrl.trim() && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                void handleCopyNtfyUrl();
                              }}
                            >
                              {copiedUrl ? (
                                <IconCheck size="sm" />
                              ) : (
                                <IconCopy size="sm" />
                              )}
                              <span>{copiedUrl ? 'نُسخ' : 'نسخ'}</span>
                            </button>
                          )}
                        </div>
                        {ntfyUrlError && (
                          <span
                            id="onb-ntfy-url-error"
                            className="onboarding-field-error"
                            role="alert"
                          >
                            {ntfyUrlError}
                          </span>
                        )}
                        {!ntfyTopicUrl.trim() && !ntfyUrlError && (
                          <span className="panel-meta">
                            ملاحظة: لن تصلك الإشعارات فعلياً حتى تضيف رابط القناة هنا أو لاحقاً من الإعدادات.
                          </span>
                        )}
                      </div>

                      <label className="field-label">
                        <span>
                          رمز الوصول (<bdi>Access Token</bdi> — اختياري للخوادم المحمية)
                        </span>
                        <input
                          id="onb-ntfy-token"
                          type="password"
                          dir="ltr"
                          className="field-input onboarding-ltr-input"
                          placeholder="tk_..."
                          value={ntfyToken}
                          data-testid="onboarding-ntfy-token"
                          disabled={busy}
                          onChange={(e) => setNtfyToken(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="onboarding-footer">
              <button
                type="button"
                className="btn"
                data-testid="onboarding-back-step"
                disabled={busy}
                onClick={() => {
                  setStep(1);
                }}
              >
                <IconChevronRight size="sm" />
                <span>رجوع لاختيار المستوى</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  data-testid="onboarding-skip-settings"
                  disabled={busy}
                  onClick={() => {
                    void submitOnboarding({ skipSettings: true });
                  }}
                >
                  تخطي الإعدادات والبدء
                </button>
                <button
                  type="button"
                  className="btn btn-live"
                  data-testid="onboarding-finish"
                  disabled={busy}
                  onClick={() => {
                    void submitOnboarding({ skipSettings: false });
                  }}
                >
                  <IconCheck size="sm" />
                  <span>
                    {busy
                      ? 'جاري إعداد الجدول...'
                      : isBlankMode
                        ? 'بدء بجدول فارغ'
                        : 'ابدأ جدول المحاسبة'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
