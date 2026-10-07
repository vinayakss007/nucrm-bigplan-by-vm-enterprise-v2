/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// #2429 — recurring periods must clamp month-end instead of overflowing it, and
// must measure from a stored anchor day rather than the previous (clamped) day.
// All assertions pin NON-LEAP years on purpose: 2024-01-31 -> 2024-02-29 is
// correct under the old `setUTCMonth` code, so a leap-year fixture would have
// passed against the bug.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addCalendarMonths,
  addMonthsClamped,
  anchorDayOf,
  daysInMonth,
  utcDateStamp,
} from '@/lib/billing/recurrence-date';

describe('addCalendarMonths — month-end does not overflow (#2429)', () => {
  it('clamps the 31st into a 28-day month instead of rolling into March', () => {
    // Old behaviour: 2026-03-03.
    expect(addCalendarMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addCalendarMonths('2026-01-30', 1, 30)).toBe('2026-02-28');
    expect(addCalendarMonths('2026-01-29', 1, 29)).toBe('2026-02-28');
  });

  it('restores the 31st in the month AFTER a short month', () => {
    // This is the criterion a plain clamp of the stored value fails: from
    // 2026-02-28 the old code, and any anchorless clamp, produces 2026-03-28.
    expect(addCalendarMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addCalendarMonths('2026-02-28', 1, 30)).toBe('2026-03-30');
    expect(addCalendarMonths('2026-02-28', 1, 29)).toBe('2026-03-29');
  });

  it('lands on day 30 in a 30-day month for a 31st-of-month series', () => {
    expect(addCalendarMonths('2026-03-31', 1, 31)).toBe('2026-04-30');
    expect(addCalendarMonths('2026-05-31', 1, 31)).toBe('2026-06-30');
  });

  it('leaves a mid-month anchor untouched', () => {
    for (const [i, want] of [
      ['2026-02-03', '2026-03-03'],
      ['2026-03-03', '2026-04-03'],
      ['2026-04-03', '2026-05-03'],
    ] as const) {
      expect(addCalendarMonths(i, 1, 3)).toBe(want);
    }
  });

  it('carries the year when crossing December', () => {
    expect(addCalendarMonths('2026-12-31', 1, 31)).toBe('2027-01-31');
    expect(addCalendarMonths('2026-12-15', 1, 15)).toBe('2027-01-15');
    expect(addCalendarMonths('2026-12-31', 12, 31)).toBe('2027-12-31');
  });

  it('walks backwards without overflowing', () => {
    expect(addCalendarMonths('2026-03-31', -1, 31)).toBe('2026-02-28');
    expect(addCalendarMonths('2027-01-31', -1, 31)).toBe('2026-12-31');
  });

  it('handles multi-month and annual periods', () => {
    expect(addCalendarMonths('2026-01-31', 3, 31)).toBe('2026-04-30'); // quarterly
    expect(addCalendarMonths('2026-01-31', 6, 31)).toBe('2026-07-31'); // semi-annual
    expect(addCalendarMonths('2026-01-31', 12, 31)).toBe('2027-01-31'); // yearly
    // Old behaviour for the leap-day anniversary: 2025-03-01.
    expect(addCalendarMonths('2024-02-29', 12, 29)).toBe('2025-02-28');
  });

  it('produces a 12-period series that never migrates off month end', () => {
    const anchor = 31;
    let cur = '2026-01-31';
    const series: string[] = [cur];
    for (let i = 0; i < 11; i++) {
      cur = addCalendarMonths(cur, 1, anchor);
      series.push(cur);
    }
    expect(series).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
      '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31',
      '2026-11-30', '2026-12-31',
    ]);
    // The bug's signature: three days into the month, forever.
    expect(series.some((d) => Number(d.slice(8, 10)) <= 3 && !d.endsWith('-28') && !d.endsWith('-29'))).toBe(false);
  });

  it('defaults the anchor to the input day, which is right only for a first step', () => {
    // Documents why the caller must persist an anchor: re-deriving it from a
    // clamped value is what pins a month-end customer to the 28th.
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2026-02-28', 1)).toBe('2026-03-28');
  });

  it('rejects malformed input instead of returning NaN dates', () => {
    expect(() => addCalendarMonths('2026-1-31', 1)).toThrow(RangeError);
    expect(() => addCalendarMonths('2026-01-31T00:00:00Z', 1)).toThrow(RangeError);
    expect(() => addCalendarMonths('2026-02-30', 1)).toThrow(RangeError); // not a real date
    expect(() => addCalendarMonths('2026-01-31', 1.5)).toThrow(RangeError);
    expect(() => addCalendarMonths('2026-01-31', 1, 0)).toThrow(RangeError);
    expect(() => addCalendarMonths('2026-01-31', 1, 32)).toThrow(RangeError);
    expect(() => addCalendarMonths('2026-01-31', 1, Number.NaN)).toThrow(RangeError);
  });
});

describe('daysInMonth', () => {
  it('is correct for leap and non-leap Februaries and every 31-day month', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 3)).toBe(30);
    expect(daysInMonth(2026, 0)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(31);
  });
});

describe('addMonthsClamped — Date with a time of day (scheduled reports)', () => {
  it('clamps without overflowing and preserves the clock time', () => {
    const from = new Date(2026, 0, 31, 10, 30, 0); // Jan 31 2026, local
    const next = addMonthsClamped(from, 1);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 1, 28]);
    expect([next.getHours(), next.getMinutes()]).toEqual([10, 30]);
    expect(next.getTime()).not.toBe(from.getTime()); // a copy, not mutated
  });

  it('crosses the year boundary and multi-month steps', () => {
    const dec31 = new Date(2026, 11, 31, 23, 59, 59);
    const jan = addMonthsClamped(dec31, 1);
    expect([jan.getFullYear(), jan.getMonth(), jan.getDate()]).toEqual([2027, 0, 31]);
    expect([jan.getHours(), jan.getMinutes(), jan.getSeconds()]).toEqual([23, 59, 59]);
    expect(addMonthsClamped(new Date(2026, 0, 30), 3).getDate()).toBe(30); // Apr 30
    expect(addMonthsClamped(new Date(2026, 0, 31), 3).getDate()).toBe(30); // Apr, clamped
  });

  it('never lands in the following month the way setMonth did', () => {
    // Regression guard for the exact old expression.
    const naive = new Date(2026, 0, 31);
    naive.setMonth(naive.getMonth() + 1);
    expect(naive.getMonth()).toBe(2); // March — the bug
    expect(addMonthsClamped(new Date(2026, 0, 31), 1).getMonth()).toBe(1); // February
  });

  it('rejects a non-integer month count', () => {
    expect(() => addMonthsClamped(new Date(2026, 0, 31), 1.5)).toThrow(RangeError);
  });
});

describe('anchorDayOf / utcDateStamp', () => {
  it('reads the day of a valid date and falls back on anything else', () => {
    expect(anchorDayOf('2026-01-31')).toBe(31);
    expect(anchorDayOf('2026-02-28')).toBe(28);
    expect(anchorDayOf(null, 7)).toBe(7);
    expect(anchorDayOf('', 7)).toBe(7);
    expect(anchorDayOf('not-a-date', 9)).toBe(9);
    expect(anchorDayOf('2026-13-45', 9)).toBe(9);
  });

  it('is independent of the host clock for a given instant', () => {
    // 2026-10-06T20:30Z is 2026-10-07 02:00 in Asia/Kolkata: the old
    // local-midnight-then-toISOString form reported the other day.
    expect(utcDateStamp(new Date('2026-10-06T20:30:00Z'))).toBe('2026-10-06');
    expect(utcDateStamp(new Date('2026-10-07T00:00:00.001Z'))).toBe('2026-10-07');
    expect(utcDateStamp(new Date('2026-10-07T23:59:59Z'))).toBe('2026-10-07');
  });
});

// Drift guard: `setMonth`/`setUTCMonth` on a day-of-month of 29..31 is the whole
// bug, and it is invisible in a leap year, so it can reappear through any future
// edit of these files. They must go through the clamped helpers instead.
describe('no recurring site does raw month arithmetic (#2429)', () => {
  const sites = [
    'app/api/cron/recurring-invoice-generator/route.ts',
    'app/api/cron/scheduled-report-delivery/route.ts',
    'app/api/tenant/reports/scheduled/route.ts',
  ];

  for (const rel of sites) {
    it(`${rel} contains no setMonth/setUTCMonth call`, () => {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(src).not.toMatch(/\.(setUTCMonth|setMonth)\s*\(/);
    });
  }

  it('the invoice cron reads the due day from UTC, not local midnight', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'app/api/cron/recurring-invoice-generator/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/setHours\(0,\s*0,\s*0,\s*0\)/);
    expect(src).toContain('utcDateStamp()');
  });
});
