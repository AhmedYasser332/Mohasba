import type {
  KeyboardShortcutBinding,
  KeyboardShortcutsMap,
} from './types';

export const SHORTCUT_ACTION_IDS = [
  'toggle_sidebar',
  'toggle_one_glance',
  'nav_now',
  'nav_week',
  'nav_qadaa',
  'nav_analytics',
  'nav_settings',
  'jump_today',
  'undo',
  'open_shortcuts_help',
] as const;

export type KnownShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

export type ShortcutScope = 'global' | 'week' | 'now_or_week';

export interface ShortcutDefinition {
  id: KnownShortcutActionId;
  labelAr: string;
  scope: ShortcutScope;
  requiresModifier: boolean;
  defaultBinding: KeyboardShortcutBinding;
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    id: 'toggle_sidebar',
    labelAr: 'إظهار / إخفاء الشريط الجانبي',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'KeyI', ctrl: true },
  },
  {
    id: 'toggle_one_glance',
    labelAr: 'تبديل وضع «نظرة واحدة»',
    scope: 'week',
    requiresModifier: true,
    defaultBinding: { code: 'KeyO', alt: true },
  },
  {
    id: 'nav_now',
    labelAr: 'الانتقال إلى «الآن»',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'Digit1', alt: true },
  },
  {
    id: 'nav_week',
    labelAr: 'الانتقال إلى «الجدول الأسبوعي»',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'Digit2', alt: true },
  },
  {
    id: 'nav_qadaa',
    labelAr: 'الانتقال إلى «القضاء»',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'Digit3', alt: true },
  },
  {
    id: 'nav_analytics',
    labelAr: 'الانتقال إلى «التحليلات»',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'Digit4', alt: true },
  },
  {
    id: 'nav_settings',
    labelAr: 'الانتقال إلى «الإعدادات»',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'Digit5', alt: true },
  },
  {
    id: 'jump_today',
    labelAr: 'القفز إلى اليوم الحالي',
    scope: 'now_or_week',
    requiresModifier: true,
    defaultBinding: { code: 'KeyT', alt: true },
  },
  {
    id: 'undo',
    labelAr: 'التراجع عن آخر تعديل',
    scope: 'global',
    requiresModifier: true,
    defaultBinding: { code: 'KeyZ', ctrl: true },
  },
  {
    id: 'open_shortcuts_help',
    labelAr: 'عرض خريطة الاختصارات',
    scope: 'global',
    requiresModifier: false,
    defaultBinding: { code: 'Slash', shift: true },
  },
] as const;

export const DEFAULT_KEYBOARD_SHORTCUTS: Record<
  KnownShortcutActionId,
  KeyboardShortcutBinding
> = SHORTCUT_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.id] = def.defaultBinding;
    return acc;
  },
  {} as Record<KnownShortcutActionId, KeyboardShortcutBinding>,
);

const ARABIC_101_LETTER_LABELS: Record<string, string> = {
  KeyQ: 'Q / ض',
  KeyW: 'W / ص',
  KeyE: 'E / ث',
  KeyR: 'R / ق',
  KeyT: 'T / ف',
  KeyY: 'Y / غ',
  KeyU: 'U / ع',
  KeyI: 'I / ه',
  KeyO: 'O / خ',
  KeyP: 'P / ح',
  KeyA: 'A / ش',
  KeyS: 'S / س',
  KeyD: 'D / ي',
  KeyF: 'F / ب',
  KeyG: 'G / ل',
  KeyH: 'H / ا',
  KeyJ: 'J / ت',
  KeyK: 'K / ن',
  KeyL: 'L / م',
  KeyZ: 'Z / ئ',
  KeyX: 'X / ء',
  KeyC: 'C / ؤ',
  KeyV: 'V / ر',
  KeyB: 'B / لا',
  KeyN: 'N / ى',
  KeyM: 'M / ة',
  BracketLeft: '[ / ج',
  BracketRight: '] / د',
  Semicolon: '; / ك',
  Quote: "' / ط",
  Comma: ', / و',
  Period: '. / ز',
  Slash: '/ / ظ',
  Backquote: '` / ذ',
  Minus: '-',
  Equal: '=',
  Backslash: '\\',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

/**
 * Normalizes a shortcut binding into a canonical chord key (`ctrl:alt:shift:code`).
 */
export function normalizeShortcutChord(
  binding: KeyboardShortcutBinding,
): string {
  return `${Boolean(binding.ctrl)}:${Boolean(binding.alt)}:${Boolean(binding.shift)}:${binding.code}`;
}

/**
 * Formats a physical KeyboardEvent.code into an Arabic-101 / Latin dual legend label.
 */
export function formatCodeDualLegend(code: string): string {
  if (ARABIC_101_LETTER_LABELS[code]) {
    return ARABIC_101_LETTER_LABELS[code];
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  return code;
}

/**
 * Formats a shortcut binding into ordered LTR keycap strings for `<kbd>` rendering.
 */
export function formatShortcutKeycaps(
  binding: KeyboardShortcutBinding,
): string[] {
  if (
    binding.code === 'Slash' &&
    Boolean(binding.shift) &&
    !binding.ctrl &&
    !binding.alt
  ) {
    return ['?'];
  }

  const caps: string[] = [];
  if (binding.ctrl) caps.push('Ctrl');
  if (binding.alt) caps.push('Alt');
  if (binding.shift) caps.push('Shift');
  caps.push(formatCodeDualLegend(binding.code));
  return caps;
}

/**
 * Returns true when a chord is reserved by browsers/OS and must not be bound in-app.
 */
export function isBrowserReservedShortcut(
  binding: KeyboardShortcutBinding,
): boolean {
  const ctrl = Boolean(binding.ctrl);
  const alt = Boolean(binding.alt);
  const shift = Boolean(binding.shift);
  const code = binding.code;

  if (code === 'F5' || code === 'F11' || code === 'F12') {
    return true;
  }

  if ((ctrl || alt) && code === 'Tab') {
    return true;
  }

  if (ctrl && !alt && !shift) {
    if (
      code === 'KeyW' ||
      code === 'KeyT' ||
      code === 'KeyN' ||
      code === 'KeyR' ||
      code === 'KeyL' ||
      code === 'KeyQ'
    ) {
      return true;
    }
  }

  if (ctrl && !alt && shift) {
    if (
      code === 'KeyT' ||
      code === 'KeyN' ||
      code === 'KeyR' ||
      code === 'KeyI' ||
      code === 'KeyJ' ||
      code === 'KeyC'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a binding has a modifier when the action requires one.
 */
export function hasValidShortcutModifiers(
  actionId: KnownShortcutActionId,
  binding: KeyboardShortcutBinding,
): boolean {
  const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
  if (!def || !def.requiresModifier) {
    return true;
  }
  return Boolean(binding.ctrl) || Boolean(binding.alt);
}

/**
 * Resolves the effective shortcut map by merging saved user overrides onto canonical defaults.
 */
export function resolveEffectiveShortcuts(
  overrides?: KeyboardShortcutsMap | null,
): Record<KnownShortcutActionId, KeyboardShortcutBinding> {
  const resolved: Record<KnownShortcutActionId, KeyboardShortcutBinding> = {
    ...DEFAULT_KEYBOARD_SHORTCUTS,
  };
  if (!overrides) {
    return resolved;
  }

  for (const id of SHORTCUT_ACTION_IDS) {
    const custom = overrides[id];
    if (custom && !isBrowserReservedShortcut(custom)) {
      resolved[id] = custom;
    }
  }

  return resolved;
}

/**
 * Matches a keyboard event against a physical shortcut binding (treating Meta as Ctrl for macOS parity).
 */
export function matchesShortcutEvent(
  event: {
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  binding: KeyboardShortcutBinding,
): boolean {
  const modPressed = Boolean(event.ctrlKey || event.metaKey);
  return (
    event.code === binding.code &&
    modPressed === Boolean(binding.ctrl) &&
    Boolean(event.altKey) === Boolean(binding.alt) &&
    Boolean(event.shiftKey) === Boolean(binding.shift)
  );
}

/**
 * Finds another action that already uses the same physical chord, if any.
 */
export function findShortcutConflict(
  targetActionId: KnownShortcutActionId,
  candidateBinding: KeyboardShortcutBinding,
  effectiveMap: Record<KnownShortcutActionId, KeyboardShortcutBinding>,
): { conflictingActionId: KnownShortcutActionId; conflictingLabelAr: string } | null {
  const candidateChord = normalizeShortcutChord(candidateBinding);
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.id === targetActionId) continue;
    const existing = effectiveMap[def.id];
    if (normalizeShortcutChord(existing) === candidateChord) {
      return {
        conflictingActionId: def.id,
        conflictingLabelAr: def.labelAr,
      };
    }
  }
  return null;
}
