/**
 * Tests for lib/money.ts (audit M-1).
 */
import { describe, it, expect } from 'vitest';
import { money, round2, lineTotal, sumLineItems, documentTotal } from '@/lib/money';

describe('money()', () => {
  it('parses decimal strings from Postgres', () => {
    expect(money('12.50')).toBe(12.5);
  });
  it('passes through numbers', () => {
    expect(money(3.14)).toBe(3.14);
  });
  it('falls back to 0 for junk / null / undefined', () => {
    expect(money('abc')).toBe(0);
    expect(money(null)).toBe(0);
    expect(money(undefined)).toBe(0);
    expect(money(NaN)).toBe(0);
  });
});

describe('round2()', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01); // EPSILON nudge — not 1.00
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2.674999)).toBe(2.67);
  });
});

describe('lineTotal()', () => {
  it('multiplies quantity * unit price and rounds', () => {
    expect(lineTotal(3, 9.99)).toBe(29.97);
  });
  it('parses string inputs', () => {
    expect(lineTotal('2', '10.005')).toBe(20.01);
  });
});

describe('sumLineItems()', () => {
  it('sums line totals without float drift', () => {
    const items = [
      { quantity: 1, unit_price: 0.1 },
      { quantity: 1, unit_price: 0.2 },
    ];
    expect(sumLineItems(items)).toBe(0.3); // not 0.30000000000000004
  });

  it('sum equals the sum of individual displayed line totals', () => {
    const items = [
      { quantity: 3, unit_price: 9.99 }, // 29.97
      { quantity: 2, unit_price: 4.5 }, // 9.00
      { quantity: 7, unit_price: 1.33 }, // 9.31
    ];
    const displayed = items.map((i) => lineTotal(i.quantity, i.unit_price));
    const displayedSum = round2(displayed.reduce((a, b) => a + b, 0));
    expect(sumLineItems(items)).toBe(displayedSum);
    expect(sumLineItems(items)).toBe(48.28);
  });

  it('defaults missing quantity to 1 and missing price to 0 (consistent with subtotal)', () => {
    expect(sumLineItems([{ unit_price: 5 }])).toBe(5); // qty defaults to 1
    expect(sumLineItems([{ quantity: 4 }])).toBe(0); // price defaults to 0
  });

  it('returns 0 for an empty list', () => {
    expect(sumLineItems([])).toBe(0);
  });
});

describe('documentTotal()', () => {
  it('computes subtotal - discount + tax rounded to cents', () => {
    expect(documentTotal(100, 10, 5)).toBe(95);
    expect(documentTotal('100.00', '0', '8.25')).toBe(108.25);
  });
  it('does not drift on fractional cents', () => {
    expect(documentTotal(0.1, 0, 0.2)).toBe(0.3);
  });
  it('clamps a total at 0 when the discount exceeds subtotal + tax (#1497)', () => {
    // A fixed discount larger than the subtotal must not yield a negative total.
    expect(documentTotal(100, 500, 0)).toBe(0);
    expect(documentTotal(100, 130, 8.25)).toBe(0);
    // Exactly covered → 0, not a tiny negative.
    expect(documentTotal(100, 100, 0)).toBe(0);
  });
});
