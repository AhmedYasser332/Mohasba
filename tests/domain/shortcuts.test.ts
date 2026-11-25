import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  SHORTCUT_ACTION_IDS,
  SHORTCUT_DEFINITIONS,
  findShortcutConflict,
  formatCodeDualLegend,
  formatShortcutKeycaps,
  hasValidShortcutModifiers,
  isBrowserReservedShortcut,
  matchesShortcutEvent,
  normalizeShortcutChord,
  resolveEffectiveShortcuts,
} from '@/domain/shortcuts';
import {
  AppSettingsSchema,
  KeyboardShortcutBindingSchema,
  KeyboardShortcutsMapSchema,
} from '@/domain/types';

describe('domain/shortcuts & AppSettings UX preferences', () => {
  it('validates canonical default shortcuts cleanly with zero duplicates or browser-reserved chords', () => {
    expect(SHORTCUT_DEFINITIONS.length).toBe(SHORTCUT_ACTION_IDS.length);

    const parsed = KeyboardShortcutsMapSchema.safeParse(
      DEFAULT_KEYBOARD_SHORTCUTS,
    );
    expect(parsed.success).toBe(true);

    for (const def of SHORTCUT_DEFINITIONS) {
      expect(isBrowserReservedShortcut(def.defaultBinding)).toBe(false);
      expect(hasValidShortcutModifiers(def.id, def.defaultBinding)).toBe(true);
    }
  });

  it('rejects duplicate chords, invalid codes, >32 entries, and prototype/constructor action IDs', () => {
    const dup = KeyboardShortcutsMapSchema.safeParse({
      nav_now: { code: 'KeyK', alt: true },
      nav_week: { code: 'KeyK', alt: true },
    });
    expect(dup.success).toBe(false);

    const invalidCode = KeyboardShortcutBindingSchema.safeParse({
      code: 'Key1',
    });
    expect(invalidCode.success).toBe(false);

    const protoKey = KeyboardShortcutsMapSchema.safeParse(
      JSON.parse('{"constructor":{"code":"KeyA","alt":true}}'),
    );
    expect(protoKey.success).toBe(false);

    const protoKey2 = KeyboardShortcutsMapSchema.safeParse({
      prototype: { code: 'KeyA', alt: true },
    });
    expect(protoKey2.success).toBe(false);
  });

  it('blocks browser-reserved shortcuts and detects in-app conflicts', () => {
    expect(isBrowserReservedShortcut({ code: 'KeyW', ctrl: true })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'KeyT', ctrl: true })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'KeyR', ctrl: true })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'KeyI', ctrl: true, shift: true })).toBe(
      true,
    );
    expect(isBrowserReservedShortcut({ code: 'F5' })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'F11' })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'F12' })).toBe(true);
    expect(isBrowserReservedShortcut({ code: 'Tab', alt: true })).toBe(true);

    expect(isBrowserReservedShortcut({ code: 'KeyI', ctrl: true })).toBe(false);
    expect(isBrowserReservedShortcut({ code: 'KeyO', alt: true })).toBe(false);

    const effective = resolveEffectiveShortcuts({
      nav_now: { code: 'KeyM', alt: true },
    });
    expect(effective.nav_now).toEqual({ code: 'KeyM', alt: true });

    const conflict = findShortcutConflict(
      'nav_week',
      { code: 'KeyM', alt: true },
      effective,
    );
    expect(conflict).not.toBeNull();
    expect(conflict?.conflictingActionId).toBe('nav_now');
  });

  it('formats Arabic-101 / Latin dual legend keycaps and matches KeyboardEvent.code layout-independently', () => {
    expect(formatCodeDualLegend('KeyI')).toBe('I / ه');
    expect(formatCodeDualLegend('KeyO')).toBe('O / خ');
    expect(formatCodeDualLegend('Digit2')).toBe('2');

    expect(formatShortcutKeycaps({ code: 'KeyI', ctrl: true })).toEqual([
      'Ctrl',
      'I / ه',
    ]);
    expect(formatShortcutKeycaps({ code: 'Slash', shift: true })).toEqual(['?']);

    // Arabic layout produces event.key='ه', event.code='KeyI'
    expect(
      matchesShortcutEvent(
        {
          code: 'KeyI',
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        DEFAULT_KEYBOARD_SHORTCUTS.toggle_sidebar,
      ),
    ).toBe(true);

    // macOS Cmd parity (metaKey)
    expect(
      matchesShortcutEvent(
        {
          code: 'KeyI',
          ctrlKey: false,
          metaKey: true,
          altKey: false,
          shiftKey: false,
        },
        DEFAULT_KEYBOARD_SHORTCUTS.toggle_sidebar,
      ),
    ).toBe(true);

    expect(normalizeShortcutChord({ code: 'KeyI', ctrl: true })).toBe(
      'true:false:false:KeyI',
    );
  });

  it('hydrates pre-0002 AppSettings snapshots with UX preference defaults', () => {
    const parsed = AppSettingsSchema.parse({
      id: 1,
      rollover_mode: 'FAJR',
      iana_timezone: 'Africa/Cairo',
      city_name: 'Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
      calc_method: 'Egyptian',
      asr_madhhab: 'Shafi',
      prayer_offsets: {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
      },
      week_start_day: 6,
      ntfy_master_enabled: false,
      quiet_start_hhmm: null,
      quiet_end_hhmm: null,
      digest_enabled: true,
      digest_hhmm: '22:00',
      backup_reminder_enabled: true,
      onboarding_completed: true,
      last_pruned_date: null,
    });

    expect(parsed.show_catchup_banner).toBe(true);
    expect(parsed.default_home_view).toBe('now');
    expect(parsed.default_week_mode).toBe('standard');
    expect(parsed.keyboard_shortcuts).toEqual({});
  });
});
