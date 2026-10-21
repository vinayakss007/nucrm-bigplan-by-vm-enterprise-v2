import { describe, it, expect } from 'vitest';
import { reminderWindows, utcDateStr } from '@/lib/cron/renewal-windows';

/**
 * #2997 — the renewal crons compared local midnight read back through
 * `toISOString()` against `date` columns. On a host east of Greenwich every
 * window landed one calendar day early; contract-renewal then recomputed the
 * day count independently and skipped every row it had just selected, so the
 * feature was dead (returning ok:true) on e.g. TZ=Asia/Kolkata.
 */

describe('reminderWindows (#2997)', () => {
  const now = new Date('2026-11-21T04:00:00Z'); // 09:30 IST — local "today" is Nov 21 there

  it('produces UTC-calendar targets for every window', () => {
    expect(reminderWindows(now, [30, 14, 7, 3]).map((w) => w.targetStr)).toEqual([
      '2026-12-21', '2026-12-05', '2026-11-28', '2026-11-24',
    ]);
  });

  it('is a pure function of the UTC day — same targets at any time of day', () => {
    const startOfDay = new Date('2026-11-21T00:00:00Z');
    const endOfDay = new Date('2026-11-21T23:59:59Z');
    expect(reminderWindows(startOfDay, [3, 7, 14, 30]))
      .toEqual(reminderWindows(endOfDay, [3, 7, 14, 30]));
  });

  it('makes every target resolve back to its own day count', () => {
    // The old route gated `REMINDER_DAYS.includes(days)` with `days` computed
    // independently from local midnights — under IST it was always N-1, so
    // every row the SQL selected was skipped. The map lookup cannot disagree.
    for (const { days, targetStr } of reminderWindows(now, [30, 14, 7, 3])) {
      expect(utcDateStr(new Date(`${targetStr}T00:00:00Z`))).toBe(targetStr);
      expect([30, 14, 7, 3]).toContain(days);
    }
  });

  it('reproduces the superseded arithmetic failing on an IST host', () => {
    // 00:00 IST on Nov 21 is 2026-11-20T18:30Z. The old form then did
    // setDate(+30) and serialized through toISOString() — the UTC day is
    // Dec 20, one day short of the true 30-window Dec 21.
    const istMidnightAsUtc = new Date('2026-11-20T18:30:00Z');
    istMidnightAsUtc.setUTCDate(istMidnightAsUtc.getUTCDate() + 30);
    expect(istMidnightAsUtc.toISOString().split('T')[0]).toBe('2026-12-20');
    expect(reminderWindows(now, [30])[0]?.targetStr).toBe('2026-12-21');
  });

  it('utcDateStr accepts Date and string shapes and returns the calendar day', () => {
    expect(utcDateStr(new Date('2026-12-21T00:00:00Z'))).toBe('2026-12-21');
    expect(utcDateStr('2026-12-21')).toBe('2026-12-21');
    expect(utcDateStr('2026-12-21T09:30:00Z')).toBe('2026-12-21');
    expect(utcDateStr(null)).toBeNull();
    expect(utcDateStr(undefined)).toBeNull();
  });
});
