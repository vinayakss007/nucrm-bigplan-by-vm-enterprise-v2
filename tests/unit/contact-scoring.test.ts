import { describe, it, expect } from 'vitest';
import { getScoreTier, getScoreTierConfig } from '@/lib/scoring';

describe('Contact Scoring', () => {
  describe('getScoreTier', () => {
    it('returns hot for score >= 70', () => {
      expect(getScoreTier(70)).toBe('hot');
      expect(getScoreTier(85)).toBe('hot');
      expect(getScoreTier(100)).toBe('hot');
    });

    it('returns warm for score 40-69', () => {
      expect(getScoreTier(40)).toBe('warm');
      expect(getScoreTier(55)).toBe('warm');
      expect(getScoreTier(69)).toBe('warm');
    });

    it('returns cold for score < 40', () => {
      expect(getScoreTier(0)).toBe('cold');
      expect(getScoreTier(20)).toBe('cold');
      expect(getScoreTier(39)).toBe('cold');
    });

    it('handles boundary at 70', () => {
      expect(getScoreTier(70)).toBe('hot');
      expect(getScoreTier(69)).toBe('warm');
    });

    it('handles boundary at 40', () => {
      expect(getScoreTier(40)).toBe('warm');
      expect(getScoreTier(39)).toBe('cold');
    });
  });

  describe('getScoreTierConfig', () => {
    it('returns red config for hot', () => {
      const cfg = getScoreTierConfig('hot');
      expect(cfg.label).toBe('Hot');
      expect(cfg.color).toContain('red');
    });

    it('returns amber config for warm', () => {
      const cfg = getScoreTierConfig('warm');
      expect(cfg.label).toBe('Warm');
      expect(cfg.color).toContain('amber');
    });

    it('returns blue config for cold', () => {
      const cfg = getScoreTierConfig('cold');
      expect(cfg.label).toBe('Cold');
      expect(cfg.color).toContain('blue');
    });
  });
});
