/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { isWonStageName } from '@/lib/deals/won-stage';

describe('isWonStageName (#658 — won side-effects survive stage renames)', () => {
  it('matches the canonical "Won" stage regardless of case/whitespace', () => {
    expect(isWonStageName('Won')).toBe(true);
    expect(isWonStageName('won')).toBe(true);
    expect(isWonStageName('  WON  ')).toBe(true);
  });

  it('matches common renamed winning stages', () => {
    expect(isWonStageName('Closed Won')).toBe(true);
    expect(isWonStageName('Closed - Won')).toBe(true);
    expect(isWonStageName('Closed/Won')).toBe(true);
    expect(isWonStageName('Deal Won')).toBe(true);
    expect(isWonStageName('Marked Won')).toBe(true);
    expect(isWonStageName('Sale Won')).toBe(true);
    expect(isWonStageName('CLOSED WON')).toBe(true);
  });

  it('does NOT match non-winning stages', () => {
    expect(isWonStageName('Lost')).toBe(false);
    expect(isWonStageName('Closed Lost')).toBe(false);
    expect(isWonStageName('Qualified')).toBe(false);
    expect(isWonStageName('Proposal')).toBe(false);
    expect(isWonStageName('Negotiation')).toBe(false);
    expect(isWonStageName('New')).toBe(false);
  });

  it('does NOT match negations or unrelated words containing the substring', () => {
    expect(isWonStageName('Not Won')).toBe(false);
    // "wonderful" / "unwon" must not trip the standalone-word match
    expect(isWonStageName('Wonderful Prospect')).toBe(false);
    expect(isWonStageName('Unwon')).toBe(false);
  });

  it('handles null / undefined / empty safely', () => {
    expect(isWonStageName(null)).toBe(false);
    expect(isWonStageName(undefined)).toBe(false);
    expect(isWonStageName('')).toBe(false);
    expect(isWonStageName('   ')).toBe(false);
  });
});
