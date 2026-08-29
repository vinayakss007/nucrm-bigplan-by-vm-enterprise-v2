import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn().mockResolvedValue(null);

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      dashboardLayouts: {
        findFirst: mockFindFirst,
      },
    },
  },
}));

vi.mock('@/components/tenant/dashboard/widget-registry', () => ({
  getWidgetsForPlan: vi.fn((_planId: string) => [
    { id: 'stats-contacts', defaultSize: '1x1' },
    { id: 'stats-pipeline', defaultSize: '1x1' },
  ]),
}));

vi.mock('@/drizzle/schema/dashboard', () => ({
  dashboardLayouts: {
    tenantId: 'tenant_id',
    userId: 'user_id',
    isDefault: 'is_default',
    id: 'id',
    updatedAt: 'updated_at',
    layout: 'layout',
    name: 'name',
    source: 'source',
    createdAt: 'created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
  desc: vi.fn(() => true),
}));

vi.mock('@/lib/modules/industry-templates', () => ({
  INDUSTRY_TEMPLATES: {
    saas: {
      defaultDashboardLayout: [
        { widget: 'stats-revenue', position: 0, size: '1x1' },
      ],
    },
  },
}));

describe('per-role dashboard defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(null);
  });

  it('getRoleDefaultLayout returns a layout for known roles', async () => {
    const { getRoleDefaultLayout } = await import('@/lib/dashboard/layout-defaults');

    const adminLayout = getRoleDefaultLayout('admin');
    expect(adminLayout).not.toBeNull();
    expect(adminLayout!.length).toBeGreaterThan(0);
    expect(adminLayout![0]).toHaveProperty('widget');
    expect(adminLayout![0]).toHaveProperty('size', '1x1');

    const salesLayout = getRoleDefaultLayout('sales_rep');
    expect(salesLayout).not.toBeNull();
  });

  it('getRoleDefaultLayout returns null for unknown roles', async () => {
    const { getRoleDefaultLayout } = await import('@/lib/dashboard/layout-defaults');
    expect(getRoleDefaultLayout('mystery_role')).toBeNull();
    expect(getRoleDefaultLayout('')).toBeNull();
  });

  it('resolveDashboardLayout uses the role layout when no saved/industry layout exists', async () => {
    const { resolveDashboardLayout } = await import('@/lib/dashboard/layout-resolver');
    const result = await resolveDashboardLayout('t1', 'u1', 'free', null, 'sales_rep');
    expect(result.source).toBe('role');
    expect(result.layout.length).toBeGreaterThan(0);
    // Sales rep default should lead with pipeline widgets.
    expect(result.layout[0].widget).toBe('stats-pipeline');
  });

  it('resolveDashboardLayout prefers industry over role when both apply', async () => {
    const { resolveDashboardLayout } = await import('@/lib/dashboard/layout-resolver');
    const result = await resolveDashboardLayout('t1', 'u1', 'free', 'saas', 'admin');
    expect(result.source).toBe('industry');
  });

  it('falls back to plan when no role/industry layout matches', async () => {
    const { resolveDashboardLayout } = await import('@/lib/dashboard/layout-resolver');
    const result = await resolveDashboardLayout('t1', 'u1', 'free', null, 'mystery_role');
    expect(result.source).toBe('plan');
    expect(result.layout.length).toBeGreaterThan(0);
  });
});