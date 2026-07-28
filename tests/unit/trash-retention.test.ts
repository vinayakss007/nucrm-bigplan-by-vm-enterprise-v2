import { describe, it, expect } from 'vitest';
import { resolveRetentionDays } from '@/app/api/tenant/trash/auto-cleanup/route';

/**
 * These guard a PERMANENT delete. Each case below was accepted by the previous
 * `parseInt(String(value))` implementation and would have destroyed the trash
 * recovery window.
 */
describe('resolveRetentionDays', () => {
  it('uses the 30-day default when unset', () => {
    expect(resolveRetentionDays(null)).toEqual({ days: 30 });
    expect(resolveRetentionDays(undefined)).toEqual({ days: 30 });
    expect(resolveRetentionDays('')).toEqual({ days: 30 });
  });

  it('accepts a valid numeric string or number', () => {
    expect(resolveRetentionDays('30')).toEqual({ days: 30 });
    expect(resolveRetentionDays(' 7 ')).toEqual({ days: 7 });
    expect(resolveRetentionDays(90)).toEqual({ days: 90 });
    expect(resolveRetentionDays(1)).toEqual({ days: 1 });
  });

  it('rejects 0 — it would purge the trash the instant anything entered it', () => {
    expect(resolveRetentionDays('0')).toEqual({ days: 30, invalidValue: '0' });
    // Numeric 0 is reported as a misconfiguration, not silently defaulted.
    expect(resolveRetentionDays(0)).toEqual({ days: 30, invalidValue: '0' });
  });

  it('rejects a negative value — the cutoff would land in the future and purge everything', () => {
    expect(resolveRetentionDays('-30')).toEqual({ days: 30, invalidValue: '-30' });
    expect(resolveRetentionDays(-1)).toEqual({ days: 30, invalidValue: '-1' });
  });

  it('rejects non-numeric strings that previously became NaN', () => {
    expect(resolveRetentionDays('abc')).toEqual({ days: 30, invalidValue: 'abc' });
    expect(resolveRetentionDays('30 days')).toEqual({ days: 30, invalidValue: '30 days' });
  });

  it('rejects objects and arrays from the jsonb column', () => {
    expect(resolveRetentionDays({ days: 30 }).days).toBe(30);
    expect(resolveRetentionDays({ days: 30 }).invalidValue).toBeDefined();
    expect(resolveRetentionDays([30]).invalidValue).toBeDefined();
  });

  it('rejects non-integers', () => {
    expect(resolveRetentionDays('1.5')).toEqual({ days: 30, invalidValue: '1.5' });
  });

  it('rejects an absurdly large window rather than clamping silently', () => {
    expect(resolveRetentionDays('99999')).toEqual({ days: 30, invalidValue: '99999' });
  });

  it('every resolved value produces a cutoff strictly in the past', () => {
    for (const input of [null, '0', '-30', 'abc', { a: 1 }, '1', '3650', '99999', '1.5']) {
      const { days } = resolveRetentionDays(input);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      expect(Number.isNaN(cutoff.getTime())).toBe(false);
      expect(cutoff.getTime()).toBeLessThan(Date.now());
    }
  });
});
