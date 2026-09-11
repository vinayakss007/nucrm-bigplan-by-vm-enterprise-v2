import { describe, it, expect } from 'vitest';
import { getIndustryDefaultLayout } from '@/lib/dashboard/layout-defaults';

describe('layout-defaults', () => {
  describe('getIndustryDefaultLayout', () => {
    it('returns the default layout for a valid industry', () => {
      const layout = getIndustryDefaultLayout('real_estate');
      expect(layout).toBeDefined();
      expect(Array.isArray(layout)).toBe(true);
      if (layout) {
        expect(layout.length).toBeGreaterThan(0);
        // Verify expected shape
        layout.forEach(item => {
          expect(item).toHaveProperty('widget');
          expect(item).toHaveProperty('position');
          expect(item).toHaveProperty('size');
        });
      }
    });

    it('returns null for an invalid industry', () => {
      const layout = getIndustryDefaultLayout('unknown_industry');
      expect(layout).toBeNull();
    });
  });
});
