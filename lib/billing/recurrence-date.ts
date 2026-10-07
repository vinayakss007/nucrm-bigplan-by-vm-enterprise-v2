/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Recurring-period date arithmetic (#2429).
 *
 * `Date.prototype.setUTCMonth` / `setMonth` roll an overflowing day of month
 * FORWARD instead of clamping it: 2026-01-31 + 1 month is 2026-03-03, not
 * 2026-02-28. For a recurring series that is doubly wrong — the period is late,
 * and the new day (the 3rd) then looks like a legitimate anchor, so every later
 * period is billed on the 3rd too. The series never returns to month end.
 *
 * Clamping alone is not enough either. Once 2026-01-31 has been clamped to
 * 2026-02-28, the stored value no longer says whether the customer bills on the
 * 28th or at month end, so the next clamp produces 2026-03-28. The anchor day
 * therefore has to be carried alongside the date; callers persist it (see
 * `billing_anchor_day` in the recurring invoice generator) and every period is
 * computed from the anchor rather than from the previous, possibly clamped, day.
 *
 *   anchor 31: 2026-01-31 -> 02-28 -> 03-31 -> 04-30 -> 05-31
 *   anchor 30: 2026-01-30 -> 02-28 -> 03-30 -> 04-30 -> 05-30
 *   anchor  3: 2026-01-03 -> 02-03 -> 03-03 -> 04-03 -> 05-03
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Day count of a month, `month0` being 0-based (0 = January). */
export function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month is the last day of this one; UTC keeps DST out of it.
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function splitISODate(iso: string): { year: number; month0: number; day: number } {
  if (!ISO_DATE_RE.test(iso)) {
    throw new RangeError(`not a yyyy-mm-dd date: ${JSON.stringify(iso)}`);
  }
  const year = Number(iso.slice(0, 4));
  const month0 = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  if (month0 < 0 || month0 > 11 || day < 1 || day > daysInMonth(year, month0)) {
    throw new RangeError(`not a real calendar date: ${iso}`);
  }
  return { year, month0, day };
}

/**
 * Add `months` to a `yyyy-mm-dd` date, clamped to the target month and measured
 * from `anchorDay` (defaults to the day of `iso`, which is only correct for the
 * first step of a series). Month end is never overflowed and never skipped.
 */
export function addCalendarMonths(iso: string, months: number, anchorDay?: number): string {
  const { year, month0, day } = splitISODate(iso);
  const anchor = anchorDay ?? day;
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) {
    throw new RangeError(`anchor day out of range 1..31: ${String(anchorDay)}`);
  }
  if (!Number.isInteger(months)) {
    throw new RangeError(`month count must be an integer: ${String(months)}`);
  }

  const total = year * 12 + month0 + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth0 = total - targetYear * 12;
  const targetDay = Math.min(anchor, daysInMonth(targetYear, targetMonth0));

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(targetYear, 4)}-${pad(targetMonth0 + 1)}-${pad(targetDay)}`;
}

/**
 * Month addition for a `Date` that carries a time of day, in local time, so it
 * composes with the `setHours`/`setDate` arithmetic already used by the
 * scheduled-report sites. Overflow is clamped; the time of day is preserved.
 *
 * No anchor parameter: a clamped monthly report lands on e.g. the 28th and stays
 * there (#2429 scopes the report sites to clamping, since their stored next run
 * cannot distinguish "the 28th" from "month end").
 */
export function addMonthsClamped(date: Date, months: number): Date {
  if (!Number.isInteger(months)) {
    throw new RangeError(`month count must be an integer: ${String(months)}`);
  }
  const year = date.getFullYear();
  const month0 = date.getMonth();
  const day = date.getDate();

  const total = year * 12 + month0 + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth0 = total - targetYear * 12;
  const lastDay = new Date(targetYear, targetMonth0 + 1, 0).getDate();

  const out = new Date(date.getTime());
  // Setting year, month and day in one call avoids the intermediate overflow
  // that `setMonth` alone would hit, and `day` is already clamped.
  out.setFullYear(targetYear, targetMonth0, Math.min(day, lastDay));
  return out;
}

/**
 * Day-of-month a `yyyy-mm-dd` string is anchored to, or `fallback` when the
 * input is missing or malformed. Keeps cron rows that predate #2429 from
 * throwing: a corrupt date is a data problem, not a crash.
 */
export function anchorDayOf(iso: string | null | undefined, fallback = 1): number {
  if (!iso || !ISO_DATE_RE.test(iso)) return fallback;
  const day = Number(iso.slice(8, 10));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : fallback;
}

/** The UTC calendar day (`yyyy-mm-dd`) for an instant, with no local-time step. */
export function utcDateStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}
