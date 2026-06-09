import { describe, it, expect } from 'vitest';
import { getScoreTier, getScoreTierConfig } from '@/lib/scoring';

describe('getScoreTier', () => {
  it('returns hot for scores >= 70', () => {
    expect(getScoreTier(100)).toBe('hot');
    expect(getScoreTier(70)).toBe('hot');
    expect(getScoreTier(85)).toBe('hot');
  });

  it('returns warm for scores 40-69', () => {
    expect(getScoreTier(40)).toBe('warm');
    expect(getScoreTier(55)).toBe('warm');
    expect(getScoreTier(69)).toBe('warm');
  });

  it('returns cold for scores < 40', () => {
    expect(getScoreTier(0)).toBe('cold');
    expect(getScoreTier(39)).toBe('cold');
    expect(getScoreTier(-5)).toBe('cold');
  });
});

describe('getScoreTierConfig', () => {
  it('returns hot config', () => {
    const cfg = getScoreTierConfig('hot');
    expect(cfg.label).toBe('Hot');
    expect(cfg.color).toContain('red');
  });

  it('returns warm config', () => {
    const cfg = getScoreTierConfig('warm');
    expect(cfg.label).toBe('Warm');
    expect(cfg.color).toContain('amber');
  });

  it('returns cold config', () => {
    const cfg = getScoreTierConfig('cold');
    expect(cfg.label).toBe('Cold');
    expect(cfg.color).toContain('blue');
  });
});
