/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Money helpers (audit M-1).
 *
 * Monetary amounts are stored as Postgres `decimal` and surface as strings, and
 * user input arrives as strings/numbers of varying cleanliness. Summing them as
 * raw IEEE-754 floats and only `.toFixed(2)`-ing at the end lets rounding drift
 * accumulate (0.1 + 0.2 = 0.30000000000000004), so a document subtotal can end
 * up a cent off from the sum of its displayed line totals.
 *
 * The rule here: parse every value the same way, and round to 2 decimals at
 * EACH accumulation step (round-half-up on cents), so repeated addition cannot
 * drift. This mirrors the pattern already used in lib/billing/payments.ts.
 */

/** Parse any money-ish input (string from decimal cols, number, or junk) to a finite number. */
export function money(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Round a value to 2 decimal places (cents), avoiding float drift. */
export function round2(value: number): number {
  // +Number.EPSILON nudge guards against e.g. 1.005 rounding down to 1.00.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Multiply quantity * unitPrice and round to cents. Both inputs are money()-parsed. */
export function lineTotal(quantity: unknown, unitPrice: unknown): number {
  return round2(money(quantity) * money(unitPrice));
}

/**
 * Sum line items (each quantity * unit_price), rounding at every step so the
 * running subtotal cannot accumulate float error.
 */
export function sumLineItems(
  items: ReadonlyArray<{ quantity?: unknown; unit_price?: unknown }>,
): number {
  let subtotal = 0;
  for (const item of items) {
    subtotal = round2(subtotal + lineTotal(item.quantity ?? 1, item.unit_price ?? 0));
  }
  return subtotal;
}

/**
 * Compute a document total = subtotal - discount + tax, rounded to cents and
 * clamped at 0. A discount larger than (subtotal + tax) must not produce a
 * negative total — negative totals corrupt AR/reporting and are treated as
 * fully "paid" downstream (balance_due <= 0). (#1497 follow-up)
 */
export function documentTotal(subtotal: unknown, discount: unknown, tax: unknown): number {
  return round2(Math.max(0, money(subtotal) - money(discount) + money(tax)));
}
