/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Reminder-window date arithmetic (#2997).
 *
 * The renewal crons compared a LOCAL midnight `Date` read back through
 * `toISOString()` against a plain `date` column. On a host east of Greenwich
 * (TZ=Asia/Kolkata: 00:00 local -> the previous day's `T18:30Z`) every target
 * landed one calendar day early — the exact bug #2429 fixed in
 * `recurring-invoice-generator`. Windows are computed from UTC midnight so the
 * result never depends on the host timezone.
 */

export interface ReminderWindow {
  days: number;
  /** Target calendar date as `yyyy-mm-dd`, UTC-based. */
  targetStr: string;
}

export function reminderWindows(now: Date, reminderDays: readonly number[]): ReminderWindow[] {
  const base = new Date(now);
  base.setUTCHours(0, 0, 0, 0);
  return reminderDays.map((days) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return { days, targetStr: d.toISOString().slice(0, 10) };
  });
}

/**
 * Calendar-day string of a `date`-column value, whatever shape the driver returns.
 *
 * Two overloads rather than one `string | null` signature: the null in the return
 * type exists for callers whose column may genuinely be null, and a caller that has
 * already excluded null had no way to say so. `app/api/cron/contract-renewal-check`
 * narrowed `contract.endDate` in its own ternary and still got `string | null` back
 * on the line that feeds a `Map.get`, which is a type error (#2997's CI red) and was
 * only ever going to be answered there with a redundant `?? ''` — a key that cannot
 * exist, invented to satisfy a signature that was lying.
 */
export function utcDateStr(value: Date | string): string;
export function utcDateStr(value: Date | string | null | undefined): string | null;
export function utcDateStr(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
