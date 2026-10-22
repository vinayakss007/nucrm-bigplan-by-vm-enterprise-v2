// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/dev/dashboard/page.tsx`: the super-admin's own development dashboard polls four reads
 * (metrics, request log, slow queries, error log) and read only `data`/`isLoading` off each.
 *
 *     const dashboardQuery = useApiQuery<DashboardData>(['dev-dashboard'], '/api/dev/dashboard', …);
 *     const data = dashboardQuery.data ?? null;
 *     …
 *     {activeTab === 'overview' && data && (…)}   // metrics never rendered an outage — they just vanished
 *     {activeTab === 'errors' && (…errors.map(…))} // an unread error log drew an empty list
 *
 * So a metrics read that never answered left the whole Overview blank (the `data &&` gate), and the
 * error-log tab — the panel whose entire job is "did anything fail?" — drew an empty list, which reads
 * exactly like "zero errors logged" when in fact nothing had been reached. `useApiQuery` keeps `data`
 * through a refused revalidation of a read that succeeded, and every read here runs
 * `refetchInterval: 5000` with the reconnect default on, so a refused refresh over kept rows is the
 * routine state, not a corner case — and the base said nothing about it either.
 *
 * Now each read is split into `failed = Boolean(q.error) && !q.data` and
 * `stale = Boolean(q.error) && Boolean(q.data)` with a messageless-safe reason, and one extracted
 * subcomponent (`dev-read-notice.tsx`) renders the two channels per read: an outage banner where the tab
 * used to be blank, a last-read caveat over kept rows. The header's derived uptime/node figures print
 * `—` while the metrics read has not answered. No existing action is taken away by a stale read.
 *
 * RED AT BASE — measured with the page file rewound to origin/main and this file as committed:
 * **14 failed | 4 passed (18)**. With the fix: **18 passed (18)**. The four that pass at base are the
 * controls that never needed the new branch: an all-healthy Overview drawing its metrics, an in-flight
 * read showing the spinner, and the guard-baseline/overlap ratchets. The fourteen that fail are every
 * per-read outage and last-read caveat (metrics, request log, slow queries, error log — none of which the
 * base could say), the dashed uptime/node figures over an unread read, and the source/extracted-component
 * ratchets pinning the split and the notice file the base did not have.
 *
 * Fixtures are documentation-only (no real host/path; the rows are invented).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));

import DevelopmentDashboard from '@/app/dev/dashboard/page';

const URLS = {
  dash: '/api/dev/dashboard',
  logs: '/api/dev/logs?limit=50',
  queries: '/api/dev/queries?limit=50&slow=true',
  errors: '/api/dev/errors?limit=20',
} as const;

const METRICS = {
  timestamp: '2026-01-01T00:00:00.000Z', uptime: 90, nodeVersion: 'v20.0.0',
  stats: { uptime: '1m', totalRequests: 7, totalErrors: 3, errorRate: '42%', avgResponseTime: '12ms', avgQueryTime: '4ms', totalQueries: 20, slowQueries: 1 },
  dbStats: { tables: 51, totalRows: 1000, activeConnections: 2 },
  memory: { rss: 120, heapUsed: 60, heapTotal: 90, external: 5 },
  environment: { nodeEnv: 'development', DATABASE_URL: 'configured' },
};
const LOGS = { requests: [{ method: 'GET', path: '/api/contacts', status: 200, duration: 12, timestamp: 1_700_000_000_000 }] };
const QSLOW = { queries: [{ sql: 'select 1', duration: 500, timestamp: 1_700_000_000_000 }] };
const ELOGS = { errors: [{ message: 'kaboom', context: 'contacts', timestamp: '2026-01-01T00:00:00.000Z' }] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const refused = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const mute = (data?: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn(),
});

const allHealthy = () => ({
  [URLS.dash]: ok(METRICS), [URLS.logs]: ok(LOGS), [URLS.queries]: ok(QSLOW), [URLS.errors]: ok(ELOGS),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const claimsOutsideAlerts = (re: RegExp) =>
  screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);

function mount(reads: Partial<Record<string, QueryResult>>) {
  registry.byUrl = { ...(allHealthy() as Record<string, QueryResult>), ...reads } as Record<string, QueryResult>;
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DevelopmentDashboard />
    </QueryClientProvider>,
  );
}
const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { registry.byUrl = {}; });
afterEach(() => { cleanup(); });

describe('all four reads answer → the dashboard is silent (#2872)', () => {
  it('renders the overview metrics and its recent requests, and says nothing about failure', () => {
    mount({});
    expect(screen.getByText('Memory RSS')).toBeTruthy();
    expect(screen.getByText('Total Requests')).toBeTruthy();
    expect(screen.getByText('/api/contacts')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the metrics read (#2872)', () => {
  it('never-answered is an outage on the Overview, not a blank screen', () => {
    mount({ [URLS.dash]: unread('Request failed (500)') });
    expect(alerts()).toContain('Failed to load the dashboard metrics: Request failed (500)');
    expect(alerts()).not.toContain('last read');
    // the metrics cards that would print a zeroed/absent number are not rendered.
    expect(claimsOutsideAlerts(/Memory RSS/)).toEqual([]);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('dashes the derived uptime and node figures while the read has not answered', () => {
    mount({ [URLS.dash]: unread() });
    expect(document.body.textContent).toContain('Node.js — • Uptime: —');
    expect(document.body.textContent).not.toMatch(/Uptime: 0/);
  });

  it('a refused refresh keeps the metrics and calls them the last read', () => {
    const dash = refused(METRICS);
    mount({ [URLS.dash]: dash });
    expect(screen.getByText('Memory RSS')).toBeTruthy();
    expect(alerts()).toContain('the metrics below are the last read: Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load the dashboard metrics/)).toEqual([]);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(dash.refetch).toHaveBeenCalledTimes(1);
  });

  it('a messageless metrics failure names the server, never undefined', () => {
    mount({ [URLS.dash]: mute() });
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('the error-log read is not allowed to look like "zero errors" (#2872)', () => {
  it('a never-answered error log shows the outage over the Errors tab', () => {
    mount({ [URLS.errors]: unread('Request failed (503)') });
    openTab('Errors');
    expect(alerts()).toContain('Failed to load the error log: Request failed (503)');
    expect(alerts()).toContain('not a verdict that there is nothing to report');
    expect(claimsOutsideAlerts(/kaboom/)).toEqual([]);
  });

  it('a refused error-log refresh keeps the rows and adds the caveat', () => {
    const errs = refused(ELOGS);
    mount({ [URLS.errors]: errs });
    openTab('Errors');
    expect(screen.getByText('kaboom')).toBeTruthy();
    expect(alerts()).toContain('the error log are the last read');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(errs.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the request-log read (#2872)', () => {
  it('an outage on the Requests tab retires the silent empty list', () => {
    mount({ [URLS.logs]: unread('Request failed (500)') });
    openTab('Requests');
    expect(alerts()).toContain('Failed to load the request log: Request failed (500)');
    expect(claimsOutsideAlerts(/\/api\/contacts/)).toEqual([]);
  });

  it('a refused refresh keeps the rows and says what it hides', () => {
    mount({ [URLS.logs]: refused(LOGS) });
    openTab('Requests');
    expect(screen.getByText('/api/contacts')).toBeTruthy();
    expect(alerts()).toContain('the request log are the last read');
  });

  it('a refused refresh over the Overview recent-requests section is named there too', () => {
    mount({ [URLS.logs]: refused(LOGS) });
    expect(screen.getByText('/api/contacts')).toBeTruthy();
    expect(alerts()).toContain('the recent requests below are the last read');
  });
});

describe('the slow-query read (#2872)', () => {
  it('never-answered shows the outage on the Queries tab', () => {
    mount({ [URLS.queries]: unread('Request failed (500)') });
    openTab('Queries');
    expect(alerts()).toContain('Failed to load the slow-query log: Request failed (500)');
    expect(claimsOutsideAlerts(/select 1/)).toEqual([]);
  });

  it('a refused refresh keeps the slow queries under a caveat', () => {
    mount({ [URLS.queries]: refused(QSLOW) });
    openTab('Queries');
    expect(screen.getByText(/select 1/)).toBeTruthy();
    expect(alerts()).toContain('the slow-query log are the last read');
  });
});

describe('reads still in flight are neither channel (#2872)', () => {
  it('a first read in flight shows the spinner and no alert', () => {
    registry.byUrl = {
      [URLS.dash]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [URLS.logs]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [URLS.queries]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [URLS.errors]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
    };
    cleanup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DevelopmentDashboard /></QueryClientProvider>);
    expect(screen.getByText('Loading dashboard...')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/dev/dashboard/page.tsx';
  const NOTICE = 'app/dev/dashboard/dev-read-notice.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits all four reads into failed / stale with a messageless-safe reason', () => {
    const s = src(FILE);
    expect(s).toMatch(/const readState = \(q:[^)]*\): DevReadState => \(\{/);
    expect(s).toMatch(/failed: Boolean\(q\.error\) && !q\.data,/);
    expect(s).toMatch(/stale: Boolean\(q\.error\) && Boolean\(q\.data\),/);
    expect(s).toMatch(/reason: q\.error\?\.message \|\| 'no response from the server',/);
    for (const name of ['dashboardQuery', 'logsQuery', 'queriesQuery', 'errorsQuery']) {
      expect(s, `${name} never got a split` ).toMatch(new RegExp(`readState\\(${name}\\)`));
    }
    expect(s).toMatch(/import DevReadNotice/);
    // the derived uptime/node figures dash while the metrics read has not answered.
    expect(s).toMatch(/data \? formatUptime\(data\.uptime\) : '—'/);
    expect(s).toMatch(/data\?\.nodeVersion \?\? '—'/);
  });

  it('renders the two channels per read in the extracted subcomponent', () => {
    const n = src(NOTICE);
    expect(n).toMatch(/if \(read\.failed\)/);
    expect(n).toMatch(/if \(read\.stale\)/);
    expect(n).toMatch(/last read/);
    expect(n).toMatch(/<InlineErrorState/);
    expect(n, 'the notice reached for a write instead of the read')
      .toMatch(/onRetry=\{onRetry\}/);
  });

  it('reuses #2829\'s guard honestly and re-runs it green', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    expect(inspect(FILE, src(FILE)).offends, 'the fixed page offends the guard').toBe(false);
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files).toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('stays inside the line ceiling', () => {
    for (const f of [FILE, NOTICE]) {
      const lines = src(f).split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves this page to one #2872 suite', () => {
    const mine = 'panel-page-error-not-empty-dev-dashboard-stale-2872.test.tsx';
    const speakers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx') && f !== mine && /2872/.test(f))
      .filter((f) => /app\/dev\/dashboard\/page/.test(readFileSync(join(ROOT, 'tests/unit', f), 'utf8')));
    expect(speakers, `${mine} is not the only #2872 suite on this page`).toEqual([]);
  });
});
