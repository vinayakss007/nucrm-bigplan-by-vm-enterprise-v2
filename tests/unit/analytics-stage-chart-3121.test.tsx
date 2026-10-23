// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3121 — the "Deals by Stage" chart drew its bars from `Object.entries(STAGE_COLORS)`,
 * i.e. from the six seeded stage NAMES, while the KPI row above it drew from the
 * server's `deals.byStage` rows. A tenant's `deal_stages.name` is editable per
 * workspace, so any stage named something else looked up to `undefined`, failed the
 * `.filter(s => s.count > 0)`, and vanished: the measured payload below (14 deals in
 * three stages) handed the `BarChart` `[]` — an empty frame with no bars and no
 * empty-state line to notice.
 *
 * Each case is a pair again, so neither half can be faked:
 *  - the rows the server returned must reach the chart (fails at base);
 *  - what was already correct must stay correct — the six default names still get
 *    their six colours, and a stage the map does not know still gets SOME colour
 *    rather than the `|| '#7c3aed'` the old `<Cell>` lookup could only ever reach
 *    through dead code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

type SwrStub = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  mutate: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, SwrStub> }));
const charts = vi.hoisted(() => ({
  bar: [] as { data: Record<string, unknown>[]; layout?: string }[],
  cells: [] as { fill?: string }[],
  yAxis: [] as { tickFormatter?: (v: unknown) => string; width?: number }[],
}));

vi.mock('swr', () => ({
  default: (key: string) =>
    registry.byUrl[key] ?? { data: undefined, error: null, isLoading: false, mutate: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// Captured at the chart boundary: `data` is what the page decided to draw, which is
// exactly the thing #3121 got wrong. recharts itself is not under test.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: ({ data, layout, children }: { data?: Record<string, unknown>[]; layout?: string; children?: ReactNode }) => {
      charts.bar.push({ data: data ?? [], layout });
      return <div>{children}</div>;
    },
    Bar: Stub,
    XAxis: Stub,
    YAxis: (props: { tickFormatter?: (v: unknown) => string; width?: number }) => {
      charts.yAxis.push(props);
      return null;
    },
    CartesianGrid: Stub,
    Tooltip: Stub,
    ResponsiveContainer: Stub,
    PieChart: Stub,
    Pie: Stub,
    Cell: (props: { fill?: string }) => {
      charts.cells.push(props);
      return null;
    },
    Legend: Stub,
    AreaChart: Stub,
    Area: Stub,
  };
});

import AnalyticsPage from '@/app/tenant/analytics/analytics-client';

const OVERVIEW = '/api/tenant/analytics/overview';
const uuid = (n: string) => `11111111-1111-4111-8111-00000000${n}`;

const ok = (data: unknown): SwrStub => ({ data, error: null, isLoading: false, mutate: vi.fn() });

const overview = (rows: { stageName: string; count: number; revenue: number }[]) => ({
  data: {
    deals: { byStage: rows.map((r, i) => ({ stageId: uuid(`2${i}`), ...r })) },
    contacts: { bySource: [], byStatus: [] },
    tasks: { total: 0, completed: 0, open: 0, overdue: 0 },
    timeseries: { weekly: [] },
  },
});

/** The vertical bar chart is the stage chart; the other two are horizontal. */
const stageChart = () => {
  const found = charts.bar.find(c => c.layout === 'vertical');
  if (!found) throw new Error('no vertical BarChart rendered');
  return found.data;
};

describe('the Deals by Stage chart draws the stages the server returned (#3121)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    charts.bar = [];
    charts.cells = [];
    charts.yAxis = [];
  });

  it('draws a renamed pipeline instead of an empty plot', () => {
    // The measured payload from the issue: 14 deals, three tenant-authored stages,
    // and — at base — `[]` handed to the BarChart.
    registry.byUrl[OVERVIEW] = ok(overview([
      { stageName: 'Discovery', count: 4, revenue: 400 },
      { stageName: 'Closed Won', count: 8, revenue: 4200000 },
      { stageName: 'Closed Lost', count: 2, revenue: 0 },
    ]));
    render(<AnalyticsPage />);
    expect(stageChart().map(r => [r.stage, r.count, r.value])).toEqual([
      ['Discovery', 4, 400],
      ['Closed Won', 8, 4200000],
      ['Closed Lost', 2, 0],
    ]);
    // Discovery is not in the preference map, so it takes a positional colour; the
    // renamed won/lost stages keep the map's meaning (#658's vocabulary), and never
    // a colour that belongs to a different outcome.
    expect(charts.cells.map(c => c.fill)).toEqual(['#7c3aed', '#10b981', '#ef4444']);
  });

  it('still colours the six default stage names the way it always did', () => {
    registry.byUrl[OVERVIEW] = ok(overview([
      { stageName: 'Lead', count: 1, revenue: 10 },
      { stageName: 'Qualified', count: 1, revenue: 20 },
      { stageName: 'Proposal', count: 1, revenue: 30 },
      { stageName: 'Negotiation', count: 1, revenue: 40 },
      { stageName: 'Won', count: 1, revenue: 50 },
      { stageName: 'Lost', count: 1, revenue: 0 },
    ]));
    render(<AnalyticsPage />);
    expect(stageChart().map(r => r.color)).toEqual([
      '#94a3b8', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
    ]);
  });

  it('groups names that differ only by case into one bar, keeping the first label', () => {
    registry.byUrl[OVERVIEW] = ok(overview([
      { stageName: 'Lead', count: 1, revenue: 10 },
      { stageName: 'lead', count: 2, revenue: 20 },
      { stageName: 'LEAD ', count: 1, revenue: 0 },
    ]));
    render(<AnalyticsPage />);
    const rows = stageChart();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: 'Lead', count: 4, value: 30, color: '#94a3b8' });
  });

  it('gives every unknown stage its own palette colour, so bars stay distinguishable', () => {
    registry.byUrl[OVERVIEW] = ok(overview([
      { stageName: 'Discovery', count: 1, revenue: 10 },
      { stageName: 'Demo', count: 1, revenue: 20 },
      { stageName: 'Trial', count: 1, revenue: 30 },
    ]));
    render(<AnalyticsPage />);
    const fills = charts.cells.map(c => c.fill);
    expect(new Set(fills).size).toBe(3);
    expect(fills).toContain('#7c3aed');
  });

  it('truncates a long tenant-authored label instead of clipping it in the 90px axis', () => {
    registry.byUrl[OVERVIEW] = ok(overview([
      { stageName: 'Negotiating annual renewal terms', count: 1, revenue: 10 },
      { stageName: 'Discovery', count: 1, revenue: 20 },
    ]));
    render(<AnalyticsPage />);
    const axis = charts.yAxis.find(a => a.width === 90);
    expect(axis?.tickFormatter).toBeTypeOf('function');
    expect(axis?.tickFormatter?.('Negotiating annual renewal terms')).toBe('Negotiating a…');
    expect(axis?.tickFormatter?.('Discovery')).toBe('Discovery');
  });

  it('says so when there is nothing to chart, instead of rendering an empty frame', () => {
    registry.byUrl[OVERVIEW] = ok(overview([]));
    render(<AnalyticsPage />);
    expect(screen.getByText('No deals to chart yet')).toBeInTheDocument();
    expect(charts.bar.some(c => c.layout === 'vertical')).toBe(false);
  });
});
