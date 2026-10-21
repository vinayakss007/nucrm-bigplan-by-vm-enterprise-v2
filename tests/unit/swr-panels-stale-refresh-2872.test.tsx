// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the six panels that read through `useSWR`.
 *
 * #2849 gave these pages a failure branch, and did it properly: bind `error`, derive a *string*
 * (SWR's error is an Error OBJECT, and inlining it is the crash `leaderboards-client.tsx:54-56`
 * records), render `InlineErrorState`. This slice is the half #2849 could not look at, because it is
 * the half #2872 is about — a read that answered **before** and fails **now**.
 *
 * SWR keeps `data` when a revalidation of an already-succeeded read is refused, and all six keyed
 * their branch off the flag alone. On these panels revalidation is not exotic:
 *
 *   - the three kanban boards `mutate()` after a successful PATCH (`tasks :215`, `tickets :205`,
 *     `deals :270`), so the ordinary state one second after moving a card was the board replaced by
 *     "The task list did not load" — and the counts above it dashed while the page still held them;
 *   - `analytics` and `forecast` are pages operators sit on, so SWR's focus and reconnect
 *     revalidation fires on its own: alt-tab back through a hiccup and the whole dashboard, charts
 *     included, was swapped for an outage page whose own copy says the data "is computed from that
 *     one read";
 *   - `leaderboards` gates its chart and its ranked list on `!errorText`, so a refused revalidation
 *     hid rows the cache still had, behind a banner claiming it could not show them.
 *
 * The census that opened #2872 counted 30 pages and none of these six: it scanned `page.tsx`, and
 * these are `*-client.tsx`. `analytics` and `forecast` slip past its pattern twice over — their
 * failure branch is an early `return`, not a ternary feeding `InlineErrorState`. And
 * `check-panel-error-state.mjs` cannot see any of them at all, because its two hook patterns match
 * `useApiQuery|useQuery` only and it short-circuits when it counts zero queries.
 *
 * RED AT BASE. On `main` at `768241ef` — the last commit before PR #2894, which touches none of
 * these six files — with the product files untouched and this file as committed: 12 of the 29 cases
 * fail. Ten are the stale-state renders and the success → refused → success walk; two are the source
 * ratchets. The other 17 are #2849's outage-and-honest-empty controls, kept as pins because swapping
 * the flag for `failed` can break them: they pass at base and must keep passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type SwrStub = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  mutate: ReturnType<typeof vi.fn>;
};

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
import LeaderboardsPage from '@/app/tenant/leaderboards/leaderboards-client';

const DEALS = '/api/tenant/deals';
const PIPELINES = '/api/tenant/pipelines';
const TASKS = '/api/tenant/tasks';
const TICKETS = '/api/tenant/tickets';
const OVERVIEW = '/api/tenant/analytics/overview';
const FORECAST_DEALS = '/api/tenant/deals?limit=500';
const BOARDS = '/api/tenant/leaderboards?metric=deals_won&period=month';

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
const boardRes = {
  data: [
    { userId: 'u-1', name: 'Priya Raman', value: 14, rank: 1 },
    { userId: 'u-2', name: 'Nadia Farouk', value: 9, rank: 2 },
  ],
};

const ok = (data: unknown): SwrStub => ({ data, error: null, isLoading: false, mutate: vi.fn() });
const failed = (message = 'Request failed (500)'): SwrStub => ({
  data: undefined, error: new Error(message), isLoading: false, mutate: vi.fn(),
});
/** The state none of these six could name before this slice: rows cached, revalidation refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): SwrStub => ({
  data, error: new Error(message), isLoading: false, mutate: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert — the helper #2849 needed and this file needs again,
 * because every replacement banner here quotes the sentence it retires.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

/** The stat card under a label, as text. */
const cardFor = (label: string) =>
  screen.getByText(label).closest('.admin-card')?.textContent ?? '';

/**
 * The number under a kanban column's stat card.
 *
 * `tasks` and `tickets` print each column name twice — once in the stat row, once as the column
 * header on the board itself — and only the first is the card #2872 dashes. The stat label is a
 * `<p class="text-xs text-muted-foreground">`, the header a `<span class="text-sm font-semibold">`,
 * so the tag is what tells them apart.
 */
const statValue = (label: string) => {
  const p = screen.getAllByText(label).find((el) => el.tagName === 'P');
  return p?.closest('.admin-card')?.querySelector('.text-lg')?.textContent ?? '';
};

const draw = (node: ReactNode) => {
  cleanup();
  return render(node);
};

describe('the tasks board keeps its columns through a refused reload (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('moves a card, the revalidation is refused, and the board stays up', () => {
    // handleDragEnd PATCHes and then calls mutate() on success (tasks :215), so this is the page's
    // state one second after the operator moved a card — not a corner case.
    const result = staleRead({ data: [taskRow] });
    registry.byUrl[TASKS] = result;
    draw(<TasksKanban />);
    expect(screen.getByText('Renew the hosting contract')).toBeTruthy();
    expect(alerts()).toContain('the columns below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toContain('did not load');
    expect(result.mutate).not.toHaveBeenCalled();
  });

  it('counts the tasks it is holding instead of dashing four cards', () => {
    registry.byUrl[TASKS] = staleRead({ data: [taskRow] });
    draw(<TasksKanban />);
    expect(statValue('Pending')).toBe('1');
    expect(statValue('Completed')).toBe('0');
    expect(statValue('On Hold')).not.toContain('—');
  });

  it('the stale banner retries the task read', () => {
    const result = staleRead({ data: [taskRow] });
    registry.byUrl[TASKS] = result;
    draw(<TasksKanban />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.mutate).toHaveBeenCalledTimes(1);
  });

  it('a read that never answered is still an outage: dashed cards, no columns, no "No tasks"', () => {
    registry.byUrl[TASKS] = failed();
    draw(<TasksKanban />);
    expect(statValue('Pending')).toBe('—');
    expect(claimsOutsideAlerts(/No tasks/)).toEqual([]);
    expect(alerts()).toContain('did not load');
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('a successful read says nothing about freshness', () => {
    registry.byUrl[TASKS] = ok({ data: [taskRow] });
    draw(<TasksKanban />);
    expect(screen.getByText('Renew the hosting contract')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the tickets board does the same (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('keeps the board and names the read it is standing on', () => {
    registry.byUrl[TICKETS] = staleRead({ data: [ticketRow] });
    draw(<TicketsKanban />);
    expect(screen.getByText('The invoice PDF will not open')).toBeTruthy();
    expect(alerts()).toContain('the columns below are the last read');
    expect(alerts()).not.toContain('did not load');
  });

  it('shows the real column counts under a stale read', () => {
    registry.byUrl[TICKETS] = staleRead({ data: [ticketRow] });
    draw(<TicketsKanban />);
    expect(statValue('Open')).toBe('1');
    expect(statValue('Closed')).toBe('0');
  });

  it('keeps the outage branch for a list that never answered', () => {
    registry.byUrl[TICKETS] = failed();
    draw(<TicketsKanban />);
    expect(statValue('Open')).toBe('—');
    expect(alerts()).toContain('did not load');
    expect(claimsOutsideAlerts(/No tickets/)).toEqual([]);
  });
});

describe('the deals board splits its two reads apart (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('a refused deals revalidation keeps the board and the four summary numbers', () => {
    // deals :270 — mutate() after a successful PATCH.
    const result = staleRead({ data: [dealRow] });
    registry.byUrl = { [DEALS]: result, [PIPELINES]: ok(pipelinesRes) };
    draw(<DealsKanban />);
    expect(screen.getByText('Annual support retainer')).toBeTruthy();
    expect(alerts()).toContain('the board below is the last read');
    expect(alerts()).not.toContain('did not load');
    for (const label of ['Total Deals', 'Pipeline Value', 'Won Deals', 'Won Value']) {
      expect(cardFor(label), `${label} dashed over a list the page is showing`).not.toContain('—');
    }
    expect(cardFor('Total Deals')).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.mutate).toHaveBeenCalledTimes(1);
  });

  it('a refused stage revalidation keeps the pipeline it did return, and retries that read', () => {
    // The stages read is secondary: deals are current, only the column list is the last read.
    const stages = staleRead(pipelinesRes);
    registry.byUrl = { [DEALS]: ok({ data: [dealRow] }), [PIPELINES]: stages };
    draw(<DealsKanban />);
    expect(screen.getByText('Discovery')).toBeTruthy();
    expect(screen.getByText('Pilot')).toBeTruthy();
    expect(alerts()).toContain('the columns below are the last read');
    expect(alerts()).toContain('pipeline stages');
    expect(alerts()).not.toContain('has no stages to draw');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(stages.mutate).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[DEALS].mutate).not.toHaveBeenCalled();
  });

  it('keeps the two outage banners distinct when both reads never answered', () => {
    registry.byUrl = { [DEALS]: failed(), [PIPELINES]: failed() };
    draw(<DealsKanban />);
    // Deals first: the board has nothing to draw either way, and the deals read is the one that
    // would take the summary cards with it.
    expect(alerts()).toContain('The deal list did not load');
    expect(screen.queryByText(/last read/)).toBeNull();
    for (const label of ['Total Deals', 'Won Deals']) expect(cardFor(label)).toContain('—');
  });

  it('says nothing about freshness when both reads answer', () => {
    registry.byUrl = { [DEALS]: ok({ data: [dealRow] }), [PIPELINES]: ok(pipelinesRes) };
    draw(<DealsKanban />);
    expect(screen.getByText('Annual support retainer')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the two dashboards stop swapping themselves for an outage page (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('analytics keeps its KPI row over a refused focus revalidation', () => {
    const result = staleRead(overviewRes);
    registry.byUrl[OVERVIEW] = result;
    draw(<AnalyticsPage />);
    // The whole page used to be an early `return` on the flag — and its own copy said every figure
    // "is computed from that one read", which is exactly why the cache matters.
    expect(screen.getByText('Open Pipeline')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
    expect(alerts()).toContain('every figure below is the last read');
    expect(alerts()).not.toMatch(/did not load/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.mutate).toHaveBeenCalledTimes(1);
  });

  it('analytics still takes the page down when the overview never answered', () => {
    registry.byUrl[OVERVIEW] = failed('Request failed (401)');
    draw(<AnalyticsPage />);
    expect(screen.queryByText('Open Pipeline')).toBeNull();
    expect(alerts()).toMatch(/did not load/);
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('analytics says nothing when the read answers', () => {
    registry.byUrl[OVERVIEW] = ok(overviewRes);
    draw(<AnalyticsPage />);
    expect(screen.getByText('Open Pipeline')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('forecast keeps its cards and its chart over a refused revalidation', () => {
    const result = staleRead({ data: [dealRow] });
    registry.byUrl[FORECAST_DEALS] = result;
    draw(<ForecastPage />);
    expect(screen.getByText('Total Pipeline')).toBeTruthy();
    expect(screen.getByText('Weighted Forecast')).toBeTruthy();
    expect(alerts()).toContain('the projection below is the last read');
    expect(claimsOutsideAlerts(/No deals found/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.mutate).toHaveBeenCalledTimes(1);
  });

  it('forecast is still an outage page when the deal list never answered', () => {
    registry.byUrl[FORECAST_DEALS] = failed();
    draw(<ForecastPage />);
    expect(screen.queryByText('Total Pipeline')).toBeNull();
    expect(alerts()).toMatch(/did not load/);
  });

  it('forecast keeps "No deals found" for a read that really had none', () => {
    registry.byUrl[FORECAST_DEALS] = ok({ data: [] });
    draw(<ForecastPage />);
    expect(screen.getByText('No deals found')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('leaderboards stops hiding rows behind a banner that says it cannot show them (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('keeps the chart and the ranking, and labels them the last read', () => {
    const result = staleRead(boardRes);
    registry.byUrl[BOARDS] = result;
    draw(<LeaderboardsPage />);
    expect(screen.getByText('Priya Raman')).toBeTruthy();
    expect(alerts()).toContain('the ranking below is the last read');
    // The red "Failed to load leaderboard data" box is the outage branch — it must not stand here.
    expect(claimsOutsideAlerts(/Failed to load leaderboard data/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.mutate).toHaveBeenCalledTimes(1);
  });

  it('keeps the module gate as an outage, not a stale read', () => {
    // A 403 has never returned rows for this key, so `failed` — the banner and the hidden list are
    // both correct here, and the stale copy would be a lie.
    const gated: SwrStub = {
      data: undefined, isLoading: false, mutate: vi.fn(),
      error: Object.assign(new Error('Forbidden'), { status: 403 }),
    };
    registry.byUrl[BOARDS] = gated;
    draw(<LeaderboardsPage />);
    expect(screen.getByText(/Leaderboards require the Analytics Pro module/)).toBeTruthy();
    expect(screen.queryByText(/last read/)).toBeNull();
    expect(screen.queryByText('Priya Raman')).toBeNull();
  });

  it('a read that never answered still hides nothing it could show', () => {
    registry.byUrl[BOARDS] = failed();
    draw(<LeaderboardsPage />);
    expect(screen.getByText(/Failed to load leaderboard data/)).toBeTruthy();
    expect(claimsOutsideAlerts(/No data for the selected period/)).toEqual([]);
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl[BOARDS] = ok(boardRes);
    draw(<LeaderboardsPage />);
    expect(screen.getByText('Nadia Farouk')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the walk off the outage: a page can leave the stale state (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });
  afterEach(cleanup);

  it('takes the caveat away when the retry succeeds', () => {
    registry.byUrl[TASKS] = staleRead({ data: [taskRow] });
    const view = draw(<TasksKanban />);
    expect(alerts()).toContain('the columns below are the last read');

    registry.byUrl[TASKS] = ok({ data: [taskRow] });
    act(() => { view.rerender(<TasksKanban />); });
    expect(screen.getByText('Renew the hosting contract')).toBeTruthy();
    expect(alerts()).toBe('');

    // And a read that then fails outright is an outage again, not a stale read.
    registry.byUrl[TASKS] = { data: undefined, error: new Error('Request failed (500)'), isLoading: false, mutate: vi.fn() };
    act(() => { view.rerender(<TasksKanban />); });
    expect(alerts()).toContain('did not load');
    expect(screen.queryByText(/last read/)).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/tasks/kanban/kanban-client.tsx',
    'app/tenant/tickets/kanban/kanban-client.tsx',
    'app/tenant/deals/kanban/kanban-client.tsx',
    'app/tenant/analytics/analytics-client.tsx',
    'app/tenant/analytics/forecast/forecast-client.tsx',
    'app/tenant/leaderboards/leaderboards-client.tsx',
  ];

  it('splits the two states apart on all six', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the refused revalidation`).toMatch(
        /const \w*[Ff]ailed = Boolean\(\w+\) && !\w+;/,
      );
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(
        /const \w*[Ss]tale = Boolean\(\w+\) && Boolean\(\w+\);/,
      );
      expect(src, `${f} still gates on the bare flag`).toMatch(
        /[Ff]ailed\s*(?:\?|&&)|if \(\w*[Ff]ailed\)/,
      );
    }
  });

  it('retires every one of the flag-only spellings #2849 left behind', () => {
    // Each page had its own way of asking the wrong question. Naming them is what keeps a future
    // edit from reintroducing one while leaving the `failed` lines in place to be grepped.
    const retired: Record<string, RegExp> = {
      'app/tenant/tasks/kanban/kanban-client.tsx': /tasksUnread \?/,
      'app/tenant/tickets/kanban/kanban-client.tsx': /ticketsUnread \?/,
      'app/tenant/deals/kanban/kanban-client.tsx': /dealsUnread \? '—'/,
      'app/tenant/analytics/analytics-client.tsx': /if \(overviewUnread\) return/,
      'app/tenant/analytics/forecast/forecast-client.tsx': /if \(dealsUnread\) \{/,
      'app/tenant/leaderboards/leaderboards-client.tsx': /!errorText &&/,
    };
    for (const [f, re] of Object.entries(retired)) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} still asks the flag the wrong way`).not.toMatch(re);
    }
  });

  it('is invisible to #2829 guard, by construction — and says so out loud', async () => {
    // The guard's two hook patterns match `useApiQuery|useQuery` only, and `inspect` short-circuits
    // to `{offends:false}` when it counts zero queries. Every one of these six files therefore
    // answers exactly what a file with no data reads at all answers. If a future edit adds a hook
    // pattern that sees `useSWR`, this check is where that becomes visible.
    const { inspect, QUERY_RE, OBJECT_QUERY_RE } = await import(
      `file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`
    );
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const re of [QUERY_RE, OBJECT_QUERY_RE]) {
        re.lastIndex = 0;
        expect(re.test(src), `${f} is now visible to the guard's hook pattern`).toBe(false);
      }
      expect(inspect(f, src).offends, `${f} would now be an offender`).toBe(false);
    }
  });

  it('is a shape the #2872 census itself could not count', () => {
    // The census that opened this epic scanned `page.tsx` and reported 30 panels; these six live in
    // `*-client.tsx`. Re-running its own pattern over `app/**` finds the three kanban boards and
    // still misses `analytics` and `forecast`, whose failure branch is an early `return` rather
    // than a ternary, and `leaderboards`, whose banner is a plain div. So the census number is a
    // floor twice over — and this file, not a regex, is the only screen on the last two shapes.
    const forPattern = (f: string) => readFileSync(join(ROOT, f), 'utf8');
    const earlyReturn = ['app/tenant/analytics/analytics-client.tsx',
      'app/tenant/analytics/forecast/forecast-client.tsx'];
    for (const f of earlyReturn) {
      const src = forPattern(f);
      // No `flag ? (<InlineErrorState` anywhere: the census pattern needs that ternary.
      expect(src, `${f} now uses the shape the census looks for`).not.toMatch(
        /\w*(?:Unread|Error|error)\s*\?\s*\(\s*<InlineErrorState/,
      );
    }
  });

  it('keeps the rest of the sweep green, and adds nothing to the baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each had to
    // undo. #2829's last slice took the list to zero; none of these six was ever on it.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    for (const f of FILES) {
      expect(files, `${f} should never have been baselined`).not.toContain(f);
    }
    const sameSuite = spawnSync('npx', ['vitest', 'run',
      'tests/unit/swr-read-failed-not-none-2849.test.tsx'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
    expect(sameSuite.status, sameSuite.stdout + sameSuite.stderr).toBe(0);
    // #2968: the nested vitest spawn alone costs ~5s idle and stretches under full-suite
    // load; the default 15s made this ratchet flaky. The spawn's own ceiling is 300s.
  }, 120_000);

  it('stays inside the line ceiling each file is allowed', () => {
    for (const f of FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
