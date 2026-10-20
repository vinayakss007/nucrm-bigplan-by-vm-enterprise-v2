// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/analytics/page.tsx`, the platform dashboard, which reads from TWO
 * sources (`/api/superadmin/tenants` and `/api/superadmin/monitoring`) and used to judge them by
 * ONE collapsed flag: `tenantsQuery.error?.message ?? monitoringQuery.error?.message`, handed to
 * `if (fetchError) return …`.
 *
 * Two wrongs followed from that. A refusal on the second read was reported in the first read's
 * words whenever both failed (`??` always takes the left message), so the operator could not tell
 * which of the two had gone quiet. And because `useApiQuery` keeps `data` when a revalidation of
 * an already-answered query fails, the ordinary state "the dashboard is on screen and one refresh
 * was refused" blanked the entire dashboard — growth curve, plan mix, status distribution, every
 * total — behind an error screen. That is strictly worse than the pages the earlier slices of
 * this issue fixed: those merely went silent, this one took away data the operator was reading.
 *
 * So the assertions here run BOTH ways on purpose: a refused monitoring refresh must not make the
 * tenants read look broken, and a refused tenants refresh must not blank the growth series. The
 * never-answered half keeps its outage sentence (#2829's work) but only over the space its own
 * read feeds, and the takeover survives only when both reads are empty-handed. Every aggregate
 * derived from a read — the `X total organizations` figure, MRR/contacts/deals/users, the plan
 * mix, the status distribution, the tenant ranking — dashes or withholds its claim on a read that
 * never answered, because zero is a number that read cannot support.
 *
 * `scripts/check-panel-error-state.mjs` cannot see any of this class (it screens for a false
 * "there are none" sentence, and this page prints none), so the rewinds at the bottom assert the
 * guard stays blind — these render tests are the only thing carrying the rule.
 *
 * Fixtures are documentation-only (`*.test` hosts, synthetic tenant ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
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

import AnalyticsPage from '@/app/superadmin/analytics/page';

const FILE = 'app/superadmin/analytics/page.tsx';
const TENANTS = '/api/superadmin/tenants';
const MONITORING = '/api/superadmin/monitoring';

// Three organizations: pro + enterprise active (MRR 79 + 199 = $278), one trialing starter.
const tenantRows = {
  data: [
    { id: 't1', name: 'Northwind Trading', plan_id: 'pro', status: 'active', current_contacts: 120, current_deals: 7, current_users: 9 },
    { id: 't2', name: 'Acme Rocket Co', plan_id: 'enterprise', status: 'active', current_contacts: 45, current_deals: 3, current_users: 4 },
    { id: 't3', name: 'Initech Testing', plan_id: 'starter', status: 'trialing', current_contacts: 8, current_deals: 0, current_users: 2 },
  ],
};
// The rolling 30-day window off app/api/superadmin/monitoring/route.ts:34-43.
const growthSeries = { tenantGrowth: [{ day: '2026-02-03', count: 2 }, { day: '2026-02-04', count: 1 }] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const pending = (): QueryResult => ({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });
/** Nothing in hand — the read never answered. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh was refused and the payload came back with it. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** The text of a stat card, label + value + sub concatenated. */
const card = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
const bothOk = () => { registry.byUrl = { [TENANTS]: ok(tenantRows), [MONITORING]: ok(growthSeries) }; };

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const mount = (node: ReactNode) => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  return render(tree(node));
};

describe('platform analytics, both reads healthy (#2872)', () => {
  beforeEach(() => { bothOk(); vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the figures the reads support and raises nothing', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('3 total organizations')).toBeTruthy();
    expect(screen.getByText('$278')).toBeTruthy();
    expect(card('MRR')).toContain('ARR $3,336');
    expect(screen.getByText('173')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.getByText(/Last 30 Days/)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(/Not counted while/)).toBeNull();
  });

  it('says the honest empties when empty is what a healthy read returned', () => {
    registry.byUrl = { [TENANTS]: ok({ data: [] }), [MONITORING]: ok({ tenantGrowth: [] }) };
    mount(<AnalyticsPage />);
    expect(screen.getByText('0 total organizations')).toBeTruthy();
    expect(screen.getByText('No recent growth data')).toBeTruthy();
    expect(screen.queryByText(/Not counted while/)).toBeNull();
    expect(alerts()).toBe('');
  });
});

describe('the organization read refused a refresh, the growth series answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [TENANTS]: staleRead(tenantRows), [MONITORING]: ok(growthSeries) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps every figure and the tenant names on screen', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('Platform Analytics')).toBeTruthy();
    expect(screen.getByText('3 total organizations')).toBeTruthy();
    expect(screen.getByText('$278')).toBeTruthy();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.queryByText(/Not counted while/)).toBeNull();
  });

  it('alerts above the kept content and names this page\'s loss', () => {
    mount(<AnalyticsPage />);
    expect(alerts()).toContain(
      'Could not refresh the organization list, so every count, chart and total below is the last read: Request failed (504). ' +
      'A tenant created, upgraded or suspended since this was fetched is not reflected in them.',
    );
    expect(alerts()).toMatch(/last read/i);
  });

  it('does not call the kept dashboard a failed load, and does not blame the growth series', () => {
    mount(<AnalyticsPage />);
    expect(alerts()).not.toMatch(/unanswered, not zero/);
    expect(alerts()).not.toMatch(/no response from the server/);
    expect(alerts()).not.toMatch(/growth series/);
    expect(screen.queryByText('No recent growth data')).toBeNull();
  });

  it('re-runs the organization read and nothing else', () => {
    mount(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[TENANTS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[MONITORING].refetch).not.toHaveBeenCalled();
  });

  it('says the server answered nothing when the refusal arrives without a message', () => {
    registry.byUrl = { ...registry.byUrl, [TENANTS]: staleRead(tenantRows, '') };
    mount(<AnalyticsPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('$278')).toBeTruthy();
  });

  it('keeps saying none exist, with the caveat, when the last read was empty', () => {
    registry.byUrl = { ...registry.byUrl, [TENANTS]: staleRead({ data: [] }) };
    mount(<AnalyticsPage />);
    expect(screen.getByText('0 total organizations')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('the growth read refused a refresh, the organization list answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [TENANTS]: ok(tenantRows), [MONITORING]: staleRead(growthSeries) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the tenant figures, so the refusal never reads as a broken list', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('3 total organizations')).toBeTruthy();
    expect(screen.getByText('$278')).toBeTruthy();
    expect(card('MRR')).toContain('ARR $3,336');
    expect(alerts()).not.toMatch(/organization list/);
    expect(screen.queryByText(/Not counted while/)).toBeNull();
  });

  it('keeps the curve and alerts inside its own card', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText(/Last 30 Days/)).toBeTruthy();
    expect(screen.queryByText('No recent growth data')).toBeNull();
    expect(alerts()).toContain(
      'Could not refresh the tenant growth series, so the curve below is the last read: Request failed (504). ' +
      'An organization that joined since this was fetched is missing from it.',
    );
    expect(alerts()).not.toMatch(/not flat/);
  });

  it('re-runs the growth read and nothing else', () => {
    mount(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[MONITORING].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[TENANTS].refetch).not.toHaveBeenCalled();
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { ...registry.byUrl, [MONITORING]: staleRead(growthSeries, '') };
    mount(<AnalyticsPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('$278')).toBeTruthy();
  });
});

describe('the organization read never answered (#2829\'s half, still honest)', () => {
  beforeEach(() => { registry.byUrl = { [TENANTS]: failed(), [MONITORING]: ok(growthSeries) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('prints the outage sentence for that read, in the space it feeds, without taking the page', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('Platform Analytics')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not read the organization list — the counts and charts below are unanswered, not zero: Request failed (500)',
    );
    expect(alerts()).not.toMatch(/last read/i);
    expect(alerts()).not.toMatch(/growth series/);
  });

  it('withholds every figure that read cannot support', () => {
    mount(<AnalyticsPage />);
    expect(screen.queryByText('3 total organizations')).toBeNull();
    expect(screen.getByText('— total organizations')).toBeTruthy();
    expect(screen.queryByText('$278')).toBeNull();
    expect(card('MRR')).not.toContain('$278');
    expect(card('MRR')).toContain('—');
    expect(screen.queryByText('Northwind Trading')).toBeNull();
    expect(screen.getAllByText(/Not counted while the organization read is unavailable/)).toHaveLength(3);
  });

  it('keeps the growth series, which did answer', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText(/Last 30 Days/)).toBeTruthy();
    expect(screen.queryByText('No recent growth data')).toBeNull();
  });

  it('re-runs the organization read from its outage banner', () => {
    mount(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[TENANTS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[MONITORING].refetch).not.toHaveBeenCalled();
  });

  it('names the server when the failure arrives without a message', () => {
    registry.byUrl = { ...registry.byUrl, [TENANTS]: failed('') };
    mount(<AnalyticsPage />);
    expect(alerts()).toMatch(/unanswered, not zero: no response from the server/);
  });
});

describe('the growth read never answered', () => {
  beforeEach(() => { registry.byUrl = { [TENANTS]: ok(tenantRows), [MONITORING]: failed('Request failed (503)') }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('takes over the curve\'s card and no other', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('Platform Analytics')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not read the tenant growth series — the curve is missing here, not flat: Request failed (503)',
    );
    expect(alerts()).not.toMatch(/organization list/);
    // An absent curve is not a flat one, and not "no growth" either.
    expect(screen.queryByText('No recent growth data')).toBeNull();
  });

  it('leaves the organization figures standing at their real values', () => {
    mount(<AnalyticsPage />);
    expect(screen.getByText('3 total organizations')).toBeTruthy();
    expect(screen.getByText('$278')).toBeTruthy();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.queryByText(/Not counted while/)).toBeNull();
  });

  it('re-runs the growth read from its outage banner', () => {
    mount(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[MONITORING].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[TENANTS].refetch).not.toHaveBeenCalled();
  });

  it('names the server when the failure arrives without a message', () => {
    registry.byUrl = { ...registry.byUrl, [MONITORING]: failed('') };
    mount(<AnalyticsPage />);
    expect(alerts()).toMatch(/not flat: no response from the server/);
  });
});

describe('both reads never answered — the takeover is still allowed (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = { [TENANTS]: failed('Request failed (500)'), [MONITORING]: failed('Request failed (503)') };
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows one outage card naming both reads with their own words', () => {
    mount(<AnalyticsPage />);
    expect(alerts()).toContain(
      'Platform analytics has nothing to show — neither the organization list (Request failed (500)) ' +
      'nor the tenant growth series (Request failed (503)) answered.',
    );
    expect(screen.queryByText('Platform Analytics')).toBeNull();
    expect(screen.queryByText(/total organizations/)).toBeNull();
    expect(screen.queryByText(/Not counted while/)).toBeNull();
  });

  it('re-runs both reads instead of reloading the document on the operator', () => {
    mount(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[TENANTS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[MONITORING].refetch).toHaveBeenCalledTimes(1);
  });
});

describe('each read waits for itself (#2872, the `isLoading ||` half)', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('skeletonizes only while neither read has come back', () => {
    registry.byUrl = { [TENANTS]: pending(), [MONITORING]: pending() };
    const { container } = mount(<AnalyticsPage />);
    expect(container.querySelectorAll('[class*="animate-pulse"]')).toHaveLength(3);
    expect(alerts()).toBe('');
    expect(screen.queryByText(/total organizations/)).toBeNull();
  });

  it('shows an answered list while the growth series is still on its way', () => {
    registry.byUrl = { [TENANTS]: ok(tenantRows), [MONITORING]: pending() };
    mount(<AnalyticsPage />);
    expect(screen.getByText('3 total organizations')).toBeTruthy();
    expect(screen.getByText('$278')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('dashes the list figures while the organization read is on its way, without calling it a failure', () => {
    registry.byUrl = { [TENANTS]: pending(), [MONITORING]: ok(growthSeries) };
    mount(<AnalyticsPage />);
    expect(screen.getByText('— total organizations')).toBeTruthy();
    expect(screen.queryByText('$278')).toBeNull();
    expect(screen.getByText(/Last 30 Days/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the source carries the split, and the guard cannot see this class (#2872)', () => {
  const ROOT = process.cwd();
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits each read instead of collapsing the two messages', () => {
    const s = src();
    expect(s, 'the two errors are still collapsed into one message').not.toMatch(/error\?\.message \?\? /);
    expect(s, 'the collapsed flag survives under another name').not.toMatch(/fetchError/);
    expect(s).toMatch(/const tenantsFailed = Boolean\(tenantsQuery\.error\) && !tenantsQuery\.data;/);
    expect(s).toMatch(/const tenantsStale = Boolean\(tenantsQuery\.error\) && Boolean\(tenantsQuery\.data\);/);
    expect(s).toMatch(/const monitoringFailed = Boolean\(monitoringQuery\.error\) && !monitoringQuery\.data;/);
    expect(s).toMatch(/const monitoringStale = Boolean\(monitoringQuery\.error\) && Boolean\(monitoringQuery\.data\);/);
    expect(s).toMatch(/tenantsQuery\.error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/monitoringQuery\.error\?\.message \|\| 'no response from the server'/);
    expect(s, 'a refusal is still rendered only by a bare flag').toMatch(/\{tenantsStale && \(/);
    expect(s).toMatch(/\{monitoringStale && \(/);
    expect(s).toMatch(/\{tenantsFailed && \(/);
  });

  it('gates the whole-page takeover on both reads having never answered', () => {
    const s = src();
    expect(s, 'the page still hands itself over on one collapsed flag').not.toMatch(/if \(fetchError\) return/);
    expect(s).toMatch(/if \(tenantsFailed && monitoringFailed\) return \(/);
    expect(s, 'one read still skeletonizes the answered one').not.toMatch(/tenantsQuery\.isLoading \|\| monitoringQuery\.isLoading/);
    expect(s, 'a refused refresh still reloads the document, throwing the kept payload away').not.toMatch(/window\.location\.reload/);
  });

  it('dashes or withholds every figure derived from the organization read', () => {
    const s = src();
    expect(s).toMatch(/tenantsUnread\s*\?\s*'—' : tenants\.length\} total organizations/);
    // the header figure, plus a value and a sub for each of the four stat cards
    expect(s.match(/tenantsUnread\s*\?\s*'—'/g)?.length).toBe(9);
    expect(s.match(/<NotCounted\/>/g)?.length).toBe(3);
    // The growth card keeps its own outage branch ahead of the emptiness claim.
    expect(s).toMatch(/monitoringFailed \? \([\s\S]*?\) : growthData\.length \?/);
  });

  it('reports the page clean before and after each rewind — the guard is blind here', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} is on the guard's list`).toBe(false);
    const rewinds: [RegExp, string][] = [
      [/const tenantsFailed = Boolean\(tenantsQuery\.error\) && !tenantsQuery\.data;\n\s*const tenantsStale = Boolean\(tenantsQuery\.error\) && Boolean\(tenantsQuery\.data\);/,
        'const tenantsFailed = Boolean(tenantsQuery.error);'],
      [/const monitoringFailed = Boolean\(monitoringQuery\.error\) && !monitoringQuery\.data;\n\s*const monitoringStale = Boolean\(monitoringQuery\.error\) && Boolean\(monitoringQuery\.data\);/,
        'const monitoringFailed = Boolean(monitoringQuery.error);'],
      [/if \(tenantsFailed && monitoringFailed\) return \(/,
        'if (tenantsFailed || monitoringFailed) return ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      expect(s, `the shape this slice depends on moved: ${replacement}`).toMatch(pattern);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, `${FILE} went back on the list it was never on`).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the page inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
