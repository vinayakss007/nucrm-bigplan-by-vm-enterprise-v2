// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2849 — six `useSWR` reads the #2829 guard cannot see, on five pages.
 *
 * `check-panel-error-state.mjs` finds bound queries with `QUERY_RE` /
 * `OBJECT_QUERY_RE`, which match only `useApiQuery|useQuery`, and then
 * short-circuits (`if (!queries) return { offends: false }`). So every one of
 * these five files answers `{"offends":false}` — the same output a file with no
 * data reads at all produces — while a failed read still renders a sentence
 * about the tenant's data, or a `₹0`/`0%` that reads as a measurement.
 *
 * Four of the six reads destructure no `error`. Two bind it and use it for one
 * thing: ending the spinner (`analytics-client.tsx:47`, `forecast-client.tsx:39`).
 *
 * Each site gets the same three-way check the #2823/#2829/#2841 suites use,
 * because any one assertion alone can be satisfied by a page that cheats:
 *   - read fails      → the failure is on screen, the false claim is not;
 *   - read succeeds,
 *     returns nothing → the sentence is on screen and no alert (a page that
 *                       KNOWS there are none is allowed to say so);
 *   - read succeeds
 *     with rows       → the rows are on screen and neither message is.
 *
 * The `not.toThrow()` assertions are not decoration: SWR's `error` is an Error
 * OBJECT, and rendering it as a React child is the crash that
 * `leaderboards-client.tsx:53-55` records. A fix that inlines `{error}` would
 * satisfy the copy assertions and take the page to the error boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

type SwrStub = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  mutate: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, SwrStub> }));

vi.mock('swr', () => ({
  default: (key: string) =>
    registry.byUrl[key] ?? { data: undefined, error: null, isLoading: false, mutate: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// jsdom has no ResizeObserver, which recharts' ResponsiveContainer needs.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub,
    Cell: Stub, Legend: Stub, AreaChart: Stub, Area: Stub,
  };
});

import DealsKanban from '@/app/tenant/deals/kanban/kanban-client';
import TasksKanban from '@/app/tenant/tasks/kanban/kanban-client';
import TicketsKanban from '@/app/tenant/tickets/kanban/kanban-client';
import AnalyticsPage from '@/app/tenant/analytics/analytics-client';
import ForecastPage from '@/app/tenant/analytics/forecast/forecast-client';

const DEALS = '/api/tenant/deals';
const PIPELINES = '/api/tenant/pipelines';
const TASKS = '/api/tenant/tasks';
const TICKETS = '/api/tenant/tickets';
const OVERVIEW = '/api/tenant/analytics/overview';
const FORECAST_DEALS = '/api/tenant/deals?limit=500';

const ok = (data: unknown): SwrStub => ({ data, error: null, isLoading: false, mutate: vi.fn() });
const failed = (message = 'Request failed (500)'): SwrStub => ({
  data: undefined, error: new Error(message), isLoading: false, mutate: vi.fn(),
});

const taskRow = {
  id: 't1', title: 'Renew the hosting contract', description: null, priority: 'medium',
  status: 'pending', dueDate: null, due_date: null, assignedTo: null, assignee_name: null,
  contactId: null, firstName: null, lastName: null, first_name: null, last_name: null,
  created_at: '2026-10-01T00:00:00Z',
};
const ticketRow = {
  id: 'k1', subject: 'The invoice PDF will not open', body: 'x', status: 'open',
  priority: 'high', category: 'billing', created_at: '2026-10-01T00:00:00Z',
  first_name: 'Priya', last_name: 'Kulkarni', assigned_name: null,
};
const dealRow = {
  id: 'd1', title: 'Annual support retainer', amount: '180000', stageId: 'discovery',
  closeDate: null, assignedTo: null, contactId: null, probability: 30,
  createdAt: '2026-10-01T00:00:00Z',
};
/** A pipeline whose stage names are NOT the component's built-in defaults. */
const pipelinesRes = {
  data: [{
    id: 'p1', isDefault: true, stages: [
      { id: 'discovery', name: 'Discovery' },
      { id: 'pilot', name: 'Pilot' },
    ],
  }],
};
const overviewRes = {
  data: {
    deals: { byStage: [
      { stageId: 's1', stageName: 'won', count: 3, revenue: 150000 },
      { stageId: 's2', stageName: 'lead', count: 5, revenue: 250000 },
    ] },
    contacts: {
      bySource: [{ source: 'referral', count: 12 }],
      byStatus: [{ status: 'active', count: 9 }],
    },
    tasks: { total: 10, completed: 4, open: 6, overdue: 2 },
    timeseries: { weekly: [{ weekStart: '2026-10-05', contacts: 3, deals: 1 }] },
  },
};

/** Every alert's text joined — one page can raise more than one failure. */
function alerts(): string {
  return screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
}

/**
 * Matches of `re` that are NOT inside an alert.
 *
 * Each replacement banner quotes the sentence it is retiring — `"No tasks" would
 * mean this workspace has none` — so a bare `queryByText(/No tasks/)` finds the
 * alert's own explanatory copy and reports the false claim as still standing.
 * The claim that must go is the one the page makes in its own voice: the
 * per-column empty state, the KPI row, the chart.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const SPECS: {
  name: string; Page: () => ReactNode; urls: string[];
  empty: RegExp; rows: string; kpi?: RegExp;
}[] = [
  { name: 'tasks board', Page: TasksKanban, urls: [TASKS], empty: /No tasks/, rows: 'Renew the hosting contract' },
  { name: 'tickets board', Page: TicketsKanban, urls: [TICKETS], empty: /No tickets/, rows: 'The invoice PDF will not open' },
  { name: 'deals board', Page: DealsKanban, urls: [DEALS], empty: /No deals/, rows: 'Annual support retainer' },
];

describe('a failed useSWR read is not reported as "there are none" (#2849)', () => {
  beforeEach(() => { registry.byUrl = {}; });

  for (const s of SPECS) {
    it(`${s.name}: the failure replaces the empty sentence`, () => {
      for (const u of s.urls) registry.byUrl[u] = failed();
      if (s.name === 'deals board') registry.byUrl[PIPELINES] = ok(pipelinesRes);
      expect(() => render(<s.Page />)).not.toThrow();
      expect(alerts()).toMatch(/did not load|could not be read|failed/i);
      expect(claimsOutsideAlerts(s.empty), `${s.name}: still claims the board is empty`).toEqual([]);
    });

    it(`${s.name}: a successful empty read keeps its honest sentence, no alert`, () => {
      for (const u of s.urls) registry.byUrl[u] = ok({ data: [] });
      if (s.name === 'deals board') registry.byUrl[PIPELINES] = ok(pipelinesRes);
      render(<s.Page />);
      expect(screen.getAllByText(s.empty).length).toBeGreaterThan(0);
      expect(alerts()).toBe('');
    });

    it(`${s.name}: rows on a successful read render, with no failure state`, () => {
      for (const u of s.urls) registry.byUrl[u] = ok({ data: [] });
      if (s.name === 'deals board') {
        registry.byUrl[PIPELINES] = ok(pipelinesRes);
        registry.byUrl[DEALS] = ok({ data: [dealRow] });
      } else if (s.name === 'tasks board') {
        registry.byUrl[TASKS] = ok({ data: [taskRow] });
      } else {
        registry.byUrl[TICKETS] = ok({ data: [ticketRow] });
      }
      render(<s.Page />);
      expect(screen.getByText(s.rows)).toBeTruthy();
      expect(alerts()).toBe('');
    });

    it(`${s.name}: the retry re-runs the read that failed`, () => {
      for (const u of s.urls) registry.byUrl[u] = failed();
      if (s.name === 'deals board') registry.byUrl[PIPELINES] = ok(pipelinesRes);
      render(<s.Page />);
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(registry.byUrl[s.urls[0]].mutate).toHaveBeenCalled();
    });
  }

  it('analytics: an unread overview is not shown as 0% and ₹0', () => {
    registry.byUrl[OVERVIEW] = failed('Request failed (401)');
    expect(() => render(<AnalyticsPage />)).not.toThrow();
    expect(alerts()).toMatch(/analytics|overview|did not load|could not be read/i);
    expect(screen.queryByText('Open Pipeline')).toBeNull();
    expect(screen.queryByText('Win Rate')).toBeNull();
    expect(screen.queryByText(/No data — add lead sources to contacts/)).toBeNull();
  });

  it('analytics: a successful read renders the KPI row with no alert', () => {
    registry.byUrl[OVERVIEW] = ok(overviewRes);
    render(<AnalyticsPage />);
    expect(screen.getByText('Open Pipeline')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('analytics: a successful read that answers "no sources" still says so', () => {
    registry.byUrl[OVERVIEW] = ok({ data: { contacts: { bySource: [], byStatus: [] } } });
    render(<AnalyticsPage />);
    expect(screen.getByText(/No data — add lead sources to contacts/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('analytics: the retry re-runs the overview read', () => {
    registry.byUrl[OVERVIEW] = failed();
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[OVERVIEW].mutate).toHaveBeenCalled();
  });

  it('forecast: an unread deal list is not shown as an empty forecast', () => {
    registry.byUrl[FORECAST_DEALS] = failed('Request failed (500)');
    expect(() => render(<ForecastPage />)).not.toThrow();
    expect(alerts()).toMatch(/deal|forecast|did not load|could not be read/i);
    expect(screen.queryByText('Total Pipeline')).toBeNull();
    expect(screen.queryByText('Weighted Forecast')).toBeNull();
    expect(screen.queryByText('No deals found')).toBeNull();
  });

  it('forecast: a successful read renders the projections with no alert', () => {
    registry.byUrl[FORECAST_DEALS] = ok({ data: [dealRow] });
    render(<ForecastPage />);
    expect(screen.getByText('Total Pipeline')).toBeTruthy();
    expect(screen.queryByText('No deals found')).toBeNull();
    expect(alerts()).toBe('');
  });

  it('forecast: a successful read with no deals still says "No deals found"', () => {
    registry.byUrl[FORECAST_DEALS] = ok({ data: [] });
    render(<ForecastPage />);
    expect(screen.getByText('No deals found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('forecast: the retry re-runs the deals read', () => {
    registry.byUrl[FORECAST_DEALS] = failed();
    render(<ForecastPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[FORECAST_DEALS].mutate).toHaveBeenCalled();
  });
});

describe('the deals board\'s second read (#2849)', () => {
  beforeEach(() => { registry.byUrl = {}; });

  it('names the stage read that failed instead of substituting its built-in defaults', () => {
    registry.byUrl[DEALS] = ok({ data: [dealRow] });
    registry.byUrl[PIPELINES] = failed('Request failed (500)');
    expect(() => render(<DealsKanban />)).not.toThrow();
    // DEFAULT_STAGES (lead/qualified/proposal/negotiation/won/lost) must not be
    // presented as this workspace's pipeline while that read is unread.
    expect(alerts()).toMatch(/stage|pipeline/i);
    expect(screen.queryByText('Qualified')).toBeNull();
    expect(screen.queryByText('Negotiation')).toBeNull();
  });

  it('renders the pipeline it was actually told, with no alert', () => {
    registry.byUrl[DEALS] = ok({ data: [dealRow] });
    registry.byUrl[PIPELINES] = ok(pipelinesRes);
    render(<DealsKanban />);
    expect(screen.getByText('Discovery')).toBeTruthy();
    expect(screen.getByText('Pilot')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('re-runs the stage read, not the deals read, when its retry is clicked', () => {
    registry.byUrl[DEALS] = ok({ data: [dealRow] });
    registry.byUrl[PIPELINES] = failed();
    render(<DealsKanban />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PIPELINES].mutate).toHaveBeenCalled();
    expect(registry.byUrl[DEALS].mutate).not.toHaveBeenCalled();
  });

  it('answers about the deals read alone when only that read failed', () => {
    // The deals banner stands in for the whole board region, so the known-good
    // stage columns do not render either. That is the honest outcome for this
    // shape: a column of an unread deal list has nothing to say, and a page that
    // drew the columns anyway would put "No deals" in each of them. What must go
    // is that per-column claim, and only the deals read may be retried.
    registry.byUrl[DEALS] = failed();
    registry.byUrl[PIPELINES] = ok(pipelinesRes);
    render(<DealsKanban />);
    expect(alerts()).toMatch(/deal list did not load/i);
    expect(claimsOutsideAlerts(/No deals/).length).toBe(0);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[DEALS].mutate).toHaveBeenCalled();
    expect(registry.byUrl[PIPELINES].mutate).not.toHaveBeenCalled();
  });

  it('does not present the summary cards as measurements of an unread pipeline', () => {
    registry.byUrl[DEALS] = failed();
    registry.byUrl[PIPELINES] = ok(pipelinesRes);
    render(<DealsKanban />);
    for (const label of ['Total Deals', 'Pipeline Value', 'Won Deals', 'Won Value']) {
      const card = screen.getByText(label).closest('.admin-card')?.textContent ?? '';
      expect(card, `${label} states a number the page never read`).toContain('—');
    }
  });
});
