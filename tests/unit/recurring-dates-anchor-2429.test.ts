import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  addLocalMonthsClamped,
  addMonthsClamped,
  advanceBillingDate,
  formatYMD,
  lastDayOfMonth,
  parseYMD,
  readBillingAnchorDay,
  shiftMonth,
  utcTodayISO,
  BILLING_ANCHOR_METADATA_KEY,
} from '@/lib/billing/recurring-dates';

/*!
 * #2429 — recurring dates must clamp, and must remember their anchor.
 *
 * `setUTCMonth` rolled an overflowing day forward (2026-01-31 + 1 month was
 * 2026-03-03), and the next period was then computed from the value that had
 * already moved, so month-end series migrated to the 1st/2nd/3rd permanently.
 *
 * Every assertion here is pinned to a NON-leap year. `2024-01-31 -> 2024-02-29`
 * is correct by luck, which is exactly how the bug survived the fixture in
 * tests/unit/recurring-invoice-generator.test.ts (2026-02-01 -> 2026-03-01, a
 * case that never overflows).
 */

const monthlySeries = (start: string, anchorDay: number, periods: number): string[] => {
  const out: string[] = [];
  let cursor = start;
  for (let i = 0; i < periods; i++) {
    cursor = advanceBillingDate(cursor, 'monthly', anchorDay);
    out.push(cursor);
  }
  return out;
};

describe('lastDayOfMonth / shiftMonth', () => {
  it('knows a February that has 28 days and one that has 29', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    // A year divisible by 100 but not 400 is NOT a leap year — the reason this
    // delegates to Date rather than a `year % 4` rule.
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });

  it('rolls the year over in both directions', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, 12)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('addMonthsClamped', () => {
  it('clamps an overflowing day instead of rolling it forward', () => {
    expect(addMonthsClamped(parseYMD('2026-01-31'), 1)).toEqual(parseYMD('2026-02-28'));
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-30'), 1))).toBe('2026-02-28');
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-29'), 1))).toBe('2026-02-28');
  });

  it('restores the anchor the moment the month can hold it again', () => {
    // This is the criterion a plain clamp-everything fix fails: after Feb 28 it
    // bills March on the 28th forever.
    expect(formatYMD(addMonthsClamped(parseYMD('2026-02-28'), 1, 31))).toBe('2026-03-31');
    expect(formatYMD(addMonthsClamped(parseYMD('2026-04-30'), 1, 31))).toBe('2026-05-31');
  });

  it('is unchanged for a day the target month has', () => {
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-03'), 1, 3))).toBe('2026-02-03');
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-28'), 1, 28))).toBe('2026-02-28');
  });

  it('ignores a corrupt anchor rather than producing an impossible date', () => {
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-31'), 1, 0))).toBe('2026-02-28');
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-31'), 1, 45))).toBe('2026-02-28');
    expect(formatYMD(addMonthsClamped(parseYMD('2026-01-31'), 1, NaN))).toBe('2026-02-28');
  });

  it('handles a leap-day source advancing to a leap-day target', () => {
    expect(formatYMD(addMonthsClamped(parseYMD('2024-02-29'), 12, 29))).toBe('2025-02-28');
    expect(formatYMD(addMonthsClamped(parseYMD('2024-02-29'), 48, 29))).toBe('2028-02-29');
  });
});

describe('advanceBillingDate — the frequencies the cron uses', () => {
  it('bills a 12-period monthly series from 2026-01-31 without ever losing month-end', () => {
    expect(monthlySeries('2026-01-31', 31, 12)).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30',
      '2026-12-31', '2027-01-31',
    ]);
    // The old behaviour, restated so the intent of the assertion is unmistakable.
    expect(monthlySeries('2026-01-31', 31, 12).some((d) => [1, 2, 3].includes(Number(d.slice(-2))))).toBe(false);
  });

  it.each([31, 30, 29])('anchor %i bills January-end on Feb 28', (anchor) => {
    expect(advanceBillingDate('2026-01-31', 'monthly', anchor)).toBe('2026-02-28');
  });

  it('advances quarterly and semi-annual on the anchor', () => {
    expect(advanceBillingDate('2026-01-31', 'quarterly', 31)).toBe('2026-04-30');
    expect(advanceBillingDate('2026-04-30', 'quarterly', 31)).toBe('2026-07-31');
    expect(advanceBillingDate('2026-01-31', 'semiannual', 31)).toBe('2026-07-31');
    expect(advanceBillingDate('2026-01-31', 'semi-annual', 31)).toBe('2026-07-31');
    expect(advanceBillingDate('2026-01-31', 'biannual', 31)).toBe('2026-07-31');
  });

  it('advances yearly on the anchor, including the leap-day anniversary', () => {
    expect(advanceBillingDate('2024-02-29', 'yearly', 29)).toBe('2025-02-28');
    expect(advanceBillingDate('2025-02-28', 'yearly', 29)).toBe('2026-02-28');
    expect(advanceBillingDate('2027-02-28', 'annual', 29)).toBe('2028-02-29');
    expect(advanceBillingDate('2026-01-31', 'yearly', 31)).toBe('2027-01-31');
  });

  it('leaves the day-based cadences alone — they never overflowed', () => {
    expect(advanceBillingDate('2026-01-31', 'daily')).toBe('2026-02-01');
    expect(advanceBillingDate('2026-02-27', 'weekly')).toBe('2026-03-06');
    expect(advanceBillingDate('2026-02-20', 'biweekly')).toBe('2026-03-06');
    expect(advanceBillingDate('2026-12-31', 'daily')).toBe('2027-01-01');
  });

  it('falls back to monthly for a missing or unknown frequency', () => {
    expect(advanceBillingDate('2026-01-31', null, 31)).toBe('2026-02-28');
    expect(advanceBillingDate('2026-01-31', 'fortnightly', 31)).toBe('2026-02-28');
    expect(advanceBillingDate('2026-01-31', 'MONTHLY', 31)).toBe('2026-02-28');
  });

  it('pads the calendar so the value stays a valid yyyy-mm-dd', () => {
    expect(advanceBillingDate('2026-01-09', 'monthly', 9)).toBe('2026-02-09');
    expect(advanceBillingDate('2026-09-30', 'monthly', 30)).toBe('2026-10-30');
  });

  it('rejects input that is not a calendar date instead of shifting it silently', () => {
    expect(() => advanceBillingDate('2026-1-31', 'monthly', 31)).toThrow(/yyyy-mm-dd/);
    expect(() => advanceBillingDate('31/01/2026', 'monthly', 31)).toThrow(/yyyy-mm-dd/);
  });
});

describe('readBillingAnchorDay', () => {
  it('reads the persisted anchor', () => {
    expect(readBillingAnchorDay({ [BILLING_ANCHOR_METADATA_KEY]: 31, generated_by: 'x' })).toBe(31);
  });

  it('treats anything unparseable as absent, so the caller adopts the current day', () => {
    expect(readBillingAnchorDay(null)).toBeUndefined();
    expect(readBillingAnchorDay(undefined)).toBeUndefined();
    expect(readBillingAnchorDay('billing_anchor_day=31')).toBeUndefined();
    expect(readBillingAnchorDay([{ [BILLING_ANCHOR_METADATA_KEY]: 31 }])).toBeUndefined();
    expect(readBillingAnchorDay({ [BILLING_ANCHOR_METADATA_KEY]: '31' })).toBeUndefined();
    expect(readBillingAnchorDay({ [BILLING_ANCHOR_METADATA_KEY]: 31.5 })).toBeUndefined();
    expect(readBillingAnchorDay({ [BILLING_ANCHOR_METADATA_KEY]: 99 })).toBeUndefined();
  });
});

describe('utcTodayISO — the due cutoff is TZ-independent (#2429 secondary)', () => {
  const REAL_TZ = process.env.TZ;
  afterAll(() => {
    process.env.TZ = REAL_TZ;
  });

  // 06:00Z — the hour scripts/cron-scheduler.ts fires this job. In Asia/Kolkata
  // it is already 11:30 the same calendar day, and in Los Angeles still 02:00
  // the previous one; the cutoff must be 2026-02-01 in all three.
  const instant = () => new Date('2026-02-01T06:00:00Z');

  it.each(['UTC', 'Asia/Kolkata', 'America/Los_Angeles'])('returns the UTC day under TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(utcTodayISO(instant())).toBe('2026-02-01');
  });

  it('is a day behind what the old local-midnight read produced', () => {
    // The shape of the bug: `setHours(0,0,0,0)` then `toISOString()` truncates
    // LOCAL midnight, which on a positive-offset host is the previous UTC day —
    // so `lte(nextBillingDate, todayStr)` delayed every due template by a day.
    process.env.TZ = 'Asia/Kolkata';
    const old = instant();
    old.setHours(0, 0, 0, 0);
    expect(old.toISOString().split('T')[0]).toBe('2026-01-31');
    expect(utcTodayISO(instant())).toBe('2026-02-01');
  });
});

describe('#2429 guard — recurring cadence may not use the overflowing month setter', () => {
  // The fix is a rule about the whole app, not just the three sites it changed:
  // the next `setMonth(+1)` written into a cron silently reintroduces the drift.
  // Source-scanned because no type or lint rule distinguishes it from a correct
  // day addition.
  const SETTER = /\.(setUTCMonth|setMonth)\(/;

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  };

  it('leaves only the one site that normalises the overflow itself', () => {
    const offenders = [...walk('app'), ...walk('lib')].filter((f) => SETTER.test(readFileSync(f, 'utf8')));
    // app/api/cron/auto-backup advances the month then immediately setDate(1),
    // so its backups land on the 1st whatever the overflow did — harmless, and
    // verified rather than assumed when #2429 was fixed.
    expect(offenders).toEqual(['app/api/cron/auto-backup/route.ts']);
  });
});

describe('addLocalMonthsClamped — scheduled-report next runs (#2429)', () => {
  const REAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    process.env.TZ = REAL_TZ;
  });

  it('clamps the 31st to Feb 28 instead of landing on March 3', () => {
    const from = new Date('2026-01-31T09:30:00Z');
    const next = addLocalMonthsClamped(from, 1);
    expect(next.toISOString()).toBe('2026-02-28T09:30:00.000Z');
  });

  it('keeps the wall-clock time, including milliseconds', () => {
    const from = new Date('2026-01-31T23:59:59.123Z');
    const next = addLocalMonthsClamped(from, 1);
    expect(next.toISOString()).toBe('2026-02-28T23:59:59.123Z');
  });

  it('crosses the year boundary', () => {
    expect(addLocalMonthsClamped(new Date('2026-12-31T06:00:00Z'), 1).toISOString())
      .toBe('2027-01-31T06:00:00.000Z');
  });

  it('honours an explicit anchor so a month-end report stays at month-end', () => {
    expect(addLocalMonthsClamped(new Date('2026-02-28T06:00:00Z'), 1, 31).toISOString())
      .toBe('2026-03-31T06:00:00.000Z');
  });
});
