'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  findShortcutConflict,
  formatShortcutKeycaps,
  hasValidShortcutModifiers,
  isBrowserReservedShortcut,
  KeyboardShortcutBindingSchema,
  normalizeShortcutChord,
  resolveEffectiveShortcuts,
  SHORTCUT_ACTION_IDS,
  SHORTCUT_DEFINITIONS,
  type KeyboardShortcutBinding,
  type KeyboardShortcutsMap,
  type KnownShortcutActionId,
  type ShortcutScope,
} from '@/domain';
import { useMohasba } from '../../store/mohasba-provider';
import { IconCheck, IconCross, IconEdit, IconRefresh } from '../icons';

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'عام',
  week: 'الجدول الأسبوعي',
  now_or_week: 'الآن والجدول',
};

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

const MATRIX_GRID_SHORTCUTS: ReadonlyArray<{
  label: string;
  caps: readonly string[];
}> = [
  { label: 'تسجيل تم', caps: ['1'] },
  { label: 'تسجيل فات', caps: ['2'] },
  { label: 'تسجيل قضاء', caps: ['3'] },
  { label: 'تسجيل 50%', caps: ['4'] },
  { label: 'مسح الخانة', caps: ['0'] },
  { label: 'تعطيل الخانة', caps: ['X / ء'] },
  { label: 'تبديل سريع', caps: ['Space'] },
  { label: 'فتح المحرر', caps: ['Enter'] },
  { label: 'نسخ ولصق', caps: ['Ctrl', 'C / V'] },
  { label: 'نقل الصف لأعلى أو لأسفل', caps: ['Alt', '↑ / ↓'] },
];

interface ConflictPrompt {
  targetActionId: KnownShortcutActionId;
  candidateBinding: KeyboardShortcutBinding;
  conflictingActionId: KnownShortcutActionId;
  conflictingLabelAr: string;
}

function buildMinimalOverrides(
  map: Record<KnownShortcutActionId, KeyboardShortcutBinding>,
): KeyboardShortcutsMap {
  const out: KeyboardShortcutsMap = {};
  for (const id of SHORTCUT_ACTION_IDS) {
    const binding = map[id];
    const def = DEFAULT_KEYBOARD_SHORTCUTS[id];
    if (normalizeShortcutChord(binding) !== normalizeShortcutChord(def)) {
      out[id] = {
        code: binding.code,
        ...(binding.ctrl ? { ctrl: true } : {}),
        ...(binding.alt ? { alt: true } : {}),
        ...(binding.shift ? { shift: true } : {}),
      };
    }
  }
  return out;
}

function ShortcutKeycaps({ binding }: { binding: KeyboardShortcutBinding }) {
  const caps = formatShortcutKeycaps(binding);
  return (
    <span className="kbd-group" dir="ltr">
      {caps.map((cap, idx) => (
        <React.Fragment key={`${cap}-${idx}`}>
          {idx > 0 && (
            <span className="kbd-plus" aria-hidden="true">
              +
            </span>
          )}
          <kbd className="kbd-cap">{cap}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

export function ShortcutsSection() {
  const { settings, isOnline, updateSettings } = useMohasba();
  const [recordingId, setRecordingId] = useState<KnownShortcutActionId | null>(
    null,
  );
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPrompt | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const effectiveMap = useMemo(
    () => resolveEffectiveShortcuts(settings?.keyboard_shortcuts),
    [settings?.keyboard_shortcuts],
  );

  const customizedCount = useMemo(() => {
    let count = 0;
    for (const id of SHORTCUT_ACTION_IDS) {
      if (
        normalizeShortcutChord(effectiveMap[id]) !==
        normalizeShortcutChord(DEFAULT_KEYBOARD_SHORTCUTS[id])
      ) {
        count += 1;
      }
    }
    return count;
  }, [effectiveMap]);

  const persistMap = async (
    nextMap: Record<KnownShortcutActionId, KeyboardShortcutBinding>,
    successMsg: string,
  ) => {
    if (!isOnline || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const overrides = buildMinimalOverrides(nextMap);
      const res = await updateSettings({ keyboard_shortcuts: overrides });
      if (res.ok) {
        setFeedback({ text: successMsg, isError: false });
      } else {
        setFeedback({
          text: res.errorMessage ?? 'تعذر حفظ اختصارات لوحة المفاتيح.',
          isError: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (MODIFIER_CODES.has(e.code)) {
        return;
      }

      if (e.code === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        setRecordingId(null);
        setConflictPrompt(null);
        return;
      }

      const candidate: KeyboardShortcutBinding = {
        code: e.code,
        ...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
        ...(e.shiftKey ? { shift: true } : {}),
      };

      const parsed = KeyboardShortcutBindingSchema.safeParse(candidate);
      if (!parsed.success) {
        setFeedback({
          text: 'هذا المفتاح غير مدعوم للاختصارات؛ اختر حرفاً أو رقماً أو مفتاح تنقل قياسياً.',
          isError: true,
        });
        setRecordingId(null);
        return;
      }

      if (isBrowserReservedShortcut(parsed.data)) {
        setFeedback({
          text: 'هذا الاختصار محجوز للمتصفح ولا يمكن تخصيصه؛ اختر تركيبة أخرى.',
          isError: true,
        });
        setRecordingId(null);
        return;
      }

      if (!hasValidShortcutModifiers(recordingId, parsed.data)) {
        setFeedback({
          text: 'يلزم تضمين مفتاح Ctrl أو Alt في هذا الاختصار لتجنب التعارض أثناء الكتابة.',
          isError: true,
        });
        setRecordingId(null);
        return;
      }

      const conflict = findShortcutConflict(
        recordingId,
        parsed.data,
        effectiveMap,
      );
      if (conflict) {
        setConflictPrompt({
          targetActionId: recordingId,
          candidateBinding: parsed.data,
          conflictingActionId: conflict.conflictingActionId,
          conflictingLabelAr: conflict.conflictingLabelAr,
        });
        setRecordingId(null);
        setFeedback(null);
        return;
      }

      const targetDef = SHORTCUT_DEFINITIONS.find((d) => d.id === recordingId);
      const nextMap: Record<KnownShortcutActionId, KeyboardShortcutBinding> = {
        ...effectiveMap,
        [recordingId]: parsed.data,
      };
      setRecordingId(null);
      setConflictPrompt(null);
      void persistMap(
        nextMap,
        `تم تحديث اختصار «${targetDef?.labelAr ?? recordingId}».`,
      );
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  });

  if (!settings) return null;

  const handleConfirmSwap = () => {
    if (!conflictPrompt) return;
    const oldTargetBinding = effectiveMap[conflictPrompt.targetActionId];
    if (
      !hasValidShortcutModifiers(
        conflictPrompt.conflictingActionId,
        oldTargetBinding,
      )
    ) {
      setFeedback({
        text: `لا يمكن نقل الاختصار الحالي إلى «${conflictPrompt.conflictingLabelAr}» لأنه يفتقر لمفتاح تعديل (Ctrl أو Alt).`,
        isError: true,
      });
      setConflictPrompt(null);
      return;
    }

    const nextMap: Record<KnownShortcutActionId, KeyboardShortcutBinding> = {
      ...effectiveMap,
      [conflictPrompt.targetActionId]: conflictPrompt.candidateBinding,
      [conflictPrompt.conflictingActionId]: oldTargetBinding,
    };
    const targetDef = SHORTCUT_DEFINITIONS.find(
      (d) => d.id === conflictPrompt.targetActionId,
    );
    setConflictPrompt(null);
    void persistMap(
      nextMap,
      `تم تبديل الاختصار وحفظ «${targetDef?.labelAr ?? ''}» ونقل الاختصار السابق.`,
    );
  };

  const handleResetSingle = (id: KnownShortcutActionId) => {
    const defBinding = DEFAULT_KEYBOARD_SHORTCUTS[id];
    const conflict = findShortcutConflict(id, defBinding, effectiveMap);
    if (conflict) {
      setConflictPrompt({
        targetActionId: id,
        candidateBinding: defBinding,
        conflictingActionId: conflict.conflictingActionId,
        conflictingLabelAr: conflict.conflictingLabelAr,
      });
      setFeedback(null);
      return;
    }

    const defMeta = SHORTCUT_DEFINITIONS.find((d) => d.id === id);
    const nextMap = { ...effectiveMap, [id]: defBinding };
    void persistMap(
      nextMap,
      `تمت استعادة الاختصار الافتراضي لـ «${defMeta?.labelAr ?? id}».`,
    );
  };

  return (
    <div>
      <div className="settings-section-bar">
        <span className="panel-meta">
          تُطابق الاختصارات موضع المفاتيح الفيزيائي فتعمل بالعربية والإنجليزية بالطريقة نفسها.
        </span>
        <button
          type="button"
          className="btn"
          data-testid="shortcuts-reset-all-btn"
          disabled={!isOnline || busy || customizedCount === 0}
          onClick={() => {
            setRecordingId(null);
            setConflictPrompt(null);
            void persistMap(
              { ...DEFAULT_KEYBOARD_SHORTCUTS },
              'تمت إعادة تعيين جميع الاختصارات إلى القيم الافتراضية.',
            );
          }}
        >
          <IconRefresh size="sm" />
          <span>إعادة تعيين كل الاختصارات</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 pb-0">
          <div
            className={`status-note ${feedback.isError ? 'is-error' : ''}`}
            data-testid="shortcuts-feedback"
            role="status"
          >
            {feedback.text}
          </div>
        </div>
      )}

      <div>
        {SHORTCUT_DEFINITIONS.map((def) => {
          const currentBinding = effectiveMap[def.id];
          const isCustom =
            normalizeShortcutChord(currentBinding) !==
            normalizeShortcutChord(def.defaultBinding);
          const isRecording = recordingId === def.id;
          const hasConflict = conflictPrompt?.targetActionId === def.id;

          return (
            <div
              key={def.id}
              className={`shortcut-row ${isRecording ? 'is-recording' : ''}`}
              data-testid={`shortcut-row-${def.id}`}
            >
              <div className="shortcut-row-top">
                <div className="shortcut-info">
                  <span className="shortcut-label">{def.labelAr}</span>
                  <span className="target-tag">{SCOPE_LABELS[def.scope]}</span>
                  {isCustom && <span className="target-tag">مخصص</span>}
                </div>

                <div className="shortcut-controls">
                  {isRecording ? (
                    <>
                      <span
                        className="shortcut-record-pill"
                        data-testid={`shortcut-recording-${def.id}`}
                      >
                        اضغط الاختصار المطلوب... (Esc للإلغاء)
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRecordingId(null)}
                      >
                        <IconCross size="sm" />
                        <span>إلغاء</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <ShortcutKeycaps binding={currentBinding} />
                      <button
                        type="button"
                        className="btn"
                        data-testid={`shortcut-edit-${def.id}`}
                        disabled={!isOnline || busy}
                        onClick={() => {
                          setFeedback(null);
                          setConflictPrompt(null);
                          setRecordingId(def.id);
                        }}
                      >
                        <IconEdit size="sm" />
                        <span>تعديل</span>
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          className="btn"
                          data-testid={`shortcut-reset-${def.id}`}
                          disabled={!isOnline || busy}
                          onClick={() => handleResetSingle(def.id)}
                        >
                          <IconRefresh size="sm" />
                          <span>افتراضي</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {hasConflict && conflictPrompt && (
                <div
                  className="shortcut-conflict-bar"
                  data-testid={`shortcut-conflict-${def.id}`}
                  role="alert"
                >
                  <span>
                    هذا الاختصار مُستخدم حالياً لـ «{conflictPrompt.conflictingLabelAr}».
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-live"
                      data-testid={`shortcut-swap-${def.id}`}
                      disabled={!isOnline || busy}
                      onClick={handleConfirmSwap}
                    >
                      <IconCheck size="sm" />
                      <span>استبدال ونقل الاختصار</span>
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConflictPrompt(null)}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="settings-subpanel">
        <div className="settings-subpanel-head">
          <strong>اختصارات خلايا الجدول الأسبوعي (ثابتة داخل الجدول)</strong>
          <span className="panel-meta">تعمل عند التركيز داخل الجدول</span>
        </div>
        <div className="shortcut-reference-grid">
          {MATRIX_GRID_SHORTCUTS.map((item) => (
            <div key={item.label} className="shortcut-ref-item">
              <span>{item.label}</span>
              <span className="kbd-group" dir="ltr">
                {item.caps.map((cap, idx) => (
                  <React.Fragment key={`${cap}-${idx}`}>
                    {idx > 0 && <span className="kbd-plus">+</span>}
                    <kbd className="kbd-cap">{cap}</kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
