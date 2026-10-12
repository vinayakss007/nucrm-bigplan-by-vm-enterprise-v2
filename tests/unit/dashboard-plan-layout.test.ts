import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPlanDefaultLayout } from '@/lib/dashboard/layout-defaults';
import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';
import type { WidgetConfig } from '@/types/dashboard';

vi.mock('@/components/tenant/dashboard/widget-registry', () => ({
  getWidgetsForPlan: vi.fn(),
}));

// We need to mock industry templates although they aren't directly used by getPlanDefaultLayout,
// because they are exported from the module and might have side effects or be required by the bundler.
vi.mock('@/lib/modules/industry-templates', () => ({
  INDUSTRY_TEMPLATES: {},
}));

// getPlanDefaultLayout reads id and defaultSize only, but the mock has to hand
// back something that is a WidgetConfig, so the unused fields are filled rather
// than the object being cast — the previous `component: {} as any` named a
// field the type does not have.
const widget = (id: string, defaultSize: WidgetConfig['defaultSize']): WidgetConfig => ({
  id,
  name: `Widget ${id}`,
  description: `Desc ${id}`,
  category: 'core',
  defaultSize,
  minPlan: 'free',
  refreshInterval: 60_000,
  apiEndpoint: `/api/tenant/dashboard/${id}`,
});

describe('getPlanDefaultLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates layout based on widgets and caches the result', () => {
    vi.mocked(getWidgetsForPlan).mockReturnValue([widget('widget-1', '2x2'), widget('widget-2', '1x1')]);

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
