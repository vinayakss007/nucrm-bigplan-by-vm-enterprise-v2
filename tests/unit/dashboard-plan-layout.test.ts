import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPlanDefaultLayout } from '@/lib/dashboard/layout-defaults';
import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';

vi.mock('@/components/tenant/dashboard/widget-registry', () => ({
  getWidgetsForPlan: vi.fn(),
}));

// We need to mock industry templates although they aren't directly used by getPlanDefaultLayout,
// because they are exported from the module and might have side effects or be required by the bundler.
vi.mock('@/lib/modules/industry-templates', () => ({
  INDUSTRY_TEMPLATES: {},
}));


describe('getPlanDefaultLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates layout based on widgets and caches the result', () => {
    vi.mocked(getWidgetsForPlan).mockReturnValue([
      { id: 'widget-1', defaultSize: '2x2', component: {} as any, name: 'Widget 1', description: 'Desc 1', category: 'stats' },
      { id: 'widget-2', defaultSize: '1x1', component: {} as any, name: 'Widget 2', description: 'Desc 2', category: 'stats' },
    ]);

    const planName = 'Premium';

    // First call
    const layout1 = getPlanDefaultLayout(planName);

    expect(getWidgetsForPlan).toHaveBeenCalledTimes(1);
    expect(getWidgetsForPlan).toHaveBeenCalledWith('premium');
    expect(layout1).toEqual([
      { widget: 'widget-1', position: 0, size: '2x2' },
      { widget: 'widget-2', position: 1, size: '1x1' },
    ]);

    // Second call - should use cache
    const layout2 = getPlanDefaultLayout('PREMIUM');

    expect(getWidgetsForPlan).toHaveBeenCalledTimes(1); // Still 1
    expect(layout2).toBe(layout1); // Exact same reference
  });

  it('handles empty widget lists', () => {
    vi.mocked(getWidgetsForPlan).mockReturnValue([]);

    const layout = getPlanDefaultLayout('empty-plan');

    expect(getWidgetsForPlan).toHaveBeenCalledWith('empty-plan');
    expect(layout).toEqual([]);
  });
});
