/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Calendar arithmetic for recurring periods (#2429).
 *
 * `setUTCMonth`/`setMonth` roll an overflowing day *forward* instead of clamping
 * it: 2026-01-31 + 1 month is 2026-03-03, not 2026-02-28. Every month-based
 * cadence here went through one of them, so a series anchored on the 29th, 30th
 * or 31st migrated its billing day to the 1st, 2nd or 3rd — and stayed there,
 * because the next period is computed from the value that already moved.
 *
 * Clamping alone is not enough either. Once Jan 31 clamps to Feb 28, the 28
 * reads as a legitimate day-28 anchor and March bills on the 28th. The series'
 * anchor has to be carried alongside the date, which is why `addMonthsClamped`
 * takes it explicitly and the invoice cron persists it in `invoices.metadata`.
 *
 * The month-length and year-rollover maths below always goes through day 1 of
 * the target month — day 1 exists in every month, so it cannot overflow — and
 * applies the day last. Month length is a calendar fact independent of timezone,
 * so `lastDayOfMonth` and `shiftMonth` are TZ-neutral; only the helpers that
 * read a `Date` choose between UTC and local components.
 */

/** A calendar date as integer components. `month` is 1-based. */
export type YMD = { year: number; month: number; day: number };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Days in `month` (1-based) of `year`. */
export function lastDayOfMonth(year: number, month: number): number {
  // Month index `month` is the one *after* the target; day 0 of it is the last
  // day of the target. Handles February and leap years without a lookup table.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add `months` to a (year, month) pair, rolling the year over as needed. */
export function shiftMonth(year: number, month: number, months: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * `source` advanced by `months` calendar months, landing on `anchorDay` clamped
 * to the target month's last day. `anchorDay` defaults to `source.day`.
 *
 * anchor 31 from 2026-01-31: -> 2026-02-28 -> 2026-03-31 -> 2026-04-30.
 */
export function addMonthsClamped(source: YMD, months: number, anchorDay?: number): YMD {
  // A corrupt anchor (0, 45, NaN) must not produce an impossible date.
  const anchor = Number.isInteger(anchorDay) && (anchorDay as number) >= 1 && (anchorDay as number) <= 31
    ? (anchorDay as number)
    : source.day;
  const shifted = shiftMonth(source.year, source.month, months);
  return { ...shifted, day: Math.min(anchor, lastDayOfMonth(shifted.year, shifted.month)) };
}

export function parseYMD(iso: string): YMD {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) throw new Error(`not a yyyy-mm-dd date: ${iso}`);
  return { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) };
}

export function formatYMD(ymd: YMD): string {
  return `${pad2(ymd.year)}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

/**
 * `from` plus `months` calendar months, clamped, keeping its local wall-clock
 * time. Scheduled-report next-run values are timestamps rather than calendar
 * days, so this reads local components; the clamp itself is the same
 * TZ-neutral month-length fact.
 */
export function addLocalMonthsClamped(
  from: Date,
  months: number,
  anchorDay?: number,
): Date {
  const clamped = addMonthsClamped(
    { year: from.getFullYear(), month: from.getMonth() + 1, day: from.getDate() },
    months,
    anchorDay,
  );
  return new Date(
    clamped.year,
    clamped.month - 1,
    clamped.day,
    from.getHours(),
    from.getMinutes(),
    from.getSeconds(),
    from.getMilliseconds(),
  );
}

const MONTH_STEPS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  'semi-annual': 6,
  biannual: 6,
  yearly: 12,
  annual: 12,
};

const DAY_STEPS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };

/**
 * The next date of a recurring series: `fromISO` advanced by one `frequency`
 * period, with `anchorDay` clamped rather than overflowed.
 *
 * A missing or unknown frequency falls back to monthly — the most common
 * cadence — so a misconfigured row still advances instead of regenerating every
 * day. Day-based cadences are untouched by the overflow bug (Jan 31 + 1 day is
 * legitimately Feb 1) and keep their plain day arithmetic.
 */
export function advanceBillingDate(fromISO: string, frequency: string | null, anchorDay?: number): string {
  const key = (frequency || 'monthly').toLowerCase();

  const days = DAY_STEPS[key];
  if (days !== undefined) {
    const from = parseYMD(fromISO);
    const d = new Date(Date.UTC(from.year, from.month - 1, from.day + days));
    return formatYMD({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }

  return formatYMD(addMonthsClamped(parseYMD(fromISO), MONTH_STEPS[key] ?? 1, anchorDay));
}

/** `invoices.metadata` key carrying a series' day-of-month anchor (#2429). */
export const BILLING_ANCHOR_METADATA_KEY = 'billing_anchor_day';

/** The anchor persisted on a template, if any. Anything unparseable reads as absent. */
export function readBillingAnchorDay(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const raw = (metadata as Record<string, unknown>)[BILLING_ANCHOR_METADATA_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 31 ? raw : undefined;
}

/**
 * The UTC calendar day of `now`, as `yyyy-mm-dd`.
 *
 * `setHours(0, 0, 0, 0)` followed by `toISOString()` is *not* the UTC day on a
 * non-UTC host: local midnight in Asia/Kolkata is 18:30 of the previous UTC day,
 * so a due cutoff built that way silently lags the wall clock by a day. Reading
 * the UTC fields directly is timezone-independent.
 */
export function utcTodayISO(now: Date = new Date()): string {
  return formatYMD({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() });
}
