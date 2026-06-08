import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('follow-ups API route - GET', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('module loads with GET and POST exports', async () => {
    const mod = await import('@/app/api/tenant/follow-ups/route');
    expect(mod.GET).toBeDefined();
    expect(mod.POST).toBeDefined();
  });
});

describe('follow-ups API route - [id]', () => {
  it('module loads with PATCH and DELETE exports', async () => {
    const mod = await import('@/app/api/tenant/follow-ups/[id]/route');
    expect(mod.PATCH).toBeDefined();
    expect(mod.DELETE).toBeDefined();
  });
});

describe('follow-ups dashboard data API', () => {
  it('module loads with GET export', async () => {
    const mod = await import('@/app/api/tenant/dashboard/widgets/follow-ups/route');
    expect(mod.GET).toBeDefined();
  });
});

describe('follow-ups widget registry', () => {
  it('widget registered in widget-registry', async () => {
    const { getWidget } = await import('@/components/tenant/dashboard/widget-registry');
    const widget = getWidget('follow-ups-list');
    expect(widget).toBeDefined();
    expect(widget?.name).toBe('Follow Ups');
    expect(widget?.apiEndpoint).toBe('/api/tenant/dashboard/widgets/follow-ups');
  });

  it('widget registered in widget-grid', async () => {
    const { WidgetGrid } = await import('@/components/tenant/dashboard/widget-grid');
    expect(WidgetGrid).toBeDefined();
  });
});

describe('follow-ups sidebar navigation', () => {
  it('sidebar component loads', async () => {
    const mod = await import('@/components/tenant/layout/sidebar');
    expect(mod.default).toBeDefined();
  });
});

describe('MissedFollowUpBadge logic', () => {
  it('returns null for missedDays <= 0', async () => {
    const { MissedFollowUpBadge } = await import('@/components/tenant/follow-ups/missed-followup-badge');
    const result = MissedFollowUpBadge({ missedDays: 0 });
    expect(result).toBeNull();
  });

  it('renders urgent for >7 days', async () => {
    const { MissedFollowUpBadge } = await import('@/components/tenant/follow-ups/missed-followup-badge');
    const result = MissedFollowUpBadge({ missedDays: 10 });
    expect(result.props.className).toContain('bg-red-100');
  });

  it('renders warning for >3 days', async () => {
    const { MissedFollowUpBadge } = await import('@/components/tenant/follow-ups/missed-followup-badge');
    const result = MissedFollowUpBadge({ missedDays: 5 });
    expect(result.props.className).toContain('bg-orange-100');
  });

  it('renders normal for <=3 days', async () => {
    const { MissedFollowUpBadge } = await import('@/components/tenant/follow-ups/missed-followup-badge');
    const result = MissedFollowUpBadge({ missedDays: 2 });
    expect(result.props.className).toContain('bg-amber-100');
  });
});
