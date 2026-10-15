import { describe, it, expect, vi } from 'vitest';

// #2633: industry dashboard defaults now resolve from product_templates via
// lib/templates/resolve (60s cache), not the static INDUSTRY_TEMPLATES map.
vi.mock('@/lib/templates/resolve', () => ({
  resolveTemplate: vi.fn(async (id: string) => {
    if (id === 'real_estate') {
      return {
        id: 'tpl-1', slug: 'real_estate', name: 'Real Estate', description: null, icon: null,
        modules: [], custom_fields: [], pipelines: [], automations: [], isBuiltin: true,
        defaultDashboardLayout: [
          { widget: 'stats-contacts', position: 0, size: '1x1' },
          { widget: 'activity-feed', position: 1, size: '2x1' },
        ],
      };
    }
    return null;
  }),
}));

import { getIndustryDefaultLayout } from '@/lib/dashboard/layout-defaults';

describe('layout-defaults', () => {
  describe('getIndustryDefaultLayout', () => {
    it('returns the default layout for a valid industry', async () => {
      const layout = await getIndustryDefaultLayout('real_estate');
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

    it('returns null for an invalid industry', async () => {
      const layout = await getIndustryDefaultLayout('unknown_industry');
      expect(layout).toBeNull();
    });
  });
});
