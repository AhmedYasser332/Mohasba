import { describe, expect, it } from 'vitest';
import {
  formatCountdownClock,
  formatHhmmInTz,
} from '@/client/components/cell-display';

describe('cell-display time & countdown formatters', () => {
  it('formats 12-hour AM/PM clock times accurately across midnight, noon, and evening', () => {
    // Africa/Cairo is UTC+2 in November
    const midnight = Date.parse('2026-11-26T00:00:00+02:00');
    const morning = Date.parse('2026-11-26T06:44:00+02:00');
    const noon = Date.parse('2026-11-26T12:00:00+02:00');
    const afternoon = Date.parse('2026-11-26T15:09:00+02:00');
    const lateNight = Date.parse('2026-11-26T23:59:00+02:00');

    expect(formatHhmmInTz(midnight, 'Africa/Cairo')).toBe('12:00 AM');
    expect(formatHhmmInTz(morning, 'Africa/Cairo')).toBe('6:44 AM');
    expect(formatHhmmInTz(noon, 'Africa/Cairo')).toBe('12:00 PM');
    expect(formatHhmmInTz(afternoon, 'Africa/Cairo')).toBe('3:09 PM');
    expect(formatHhmmInTz(lateNight, 'Africa/Cairo')).toBe('11:59 PM');
  });

  it('formats descending countdown clocks in H:MM and H:MM:SS and clamps negatives to zero', () => {
    const oneHour41Min5Sec = (1 * 3600 + 41 * 60 + 5) * 1000;
    expect(formatCountdownClock(oneHour41Min5Sec, false)).toBe('1:41');
    expect(formatCountdownClock(oneHour41Min5Sec, true)).toBe('1:41:05');

    const fortyFiveSec = 45_900;
    expect(formatCountdownClock(fortyFiveSec, false)).toBe('0:00');
    expect(formatCountdownClock(fortyFiveSec, true)).toBe('0:00:45');

    expect(formatCountdownClock(-5000, false)).toBe('0:00');
    expect(formatCountdownClock(-5000, true)).toBe('0:00:00');
  });
});
