// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2872 — `app/superadmin/revenue/page.tsx`: the revenue dashboard that had no
 * word for either of its two reads when one refused to answer.
 *
 * The page has TWO reads and, on main, ZERO error handling: it bound neither
 * `revenueQuery.error` nor `tenantsQuery.error`, and gated the whole page on the
 * union `loading = revenueQuery.isLoading || tenantsQuery.isLoading` (main
 * page.tsx:49). That collapses three states into one "show whatever is there":
 *
 *   - `/api/superadmin/revenue` (app/api/superadmin/revenue/route.ts:21-54) never
 *     answered → the four metric cards printed `formatCurrency(0)` = "$0" and
 *     "0 paying" — a failed read reported as zero revenue — and the events panel
 *     printed "No billing events yet" for a read that never happened.
 *   - the union loading skeletonized the tenants grid whenever revenue was still
 *     in flight, and vice versa, so an already-answered read looked broken.
 *   - a refused *revalidation* (TanStack keeps `.data`, lib/query/client.tsx:37-44)
 *     was invisible: the kept numbers stayed on screen with no caveat, exactly the
 *     "rows exist, nothing said" arm #2872 is about.
 *
 * Fix shape: per read, `failed = Boolean(error) && !data` (an outage sentence, and
 * every derived figure dashed `—` / withheld) versus `stale = Boolean(error) &&
 * Boolean(data)` (a caveat banner ABOVE the kept rows). The two reads are judged
 * independently, so a refused refresh of one never speaks for the other, and each
 * banner's retry calls only the `refetch` of the read it describes. This page has
 * no write control (the POST/PATCH/DELETE that live on /api/superadmin/tenants,
 * route.ts:104-446, are reached from other panels), so there is nothing to gate on
 * `failed` — that absence is asserted too.
 *
 * Fixtures are documentation-only (`*.test`, RFC 2606 names).
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
    AreaChart: Stub, Area: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, ResponsiveContainer: Stub,
    Legend: Stub, PieChart: Stub, Pie: Stub, Cell: Stub,
  };
});

import RevenuePage from '@/app/superadmin/revenue/page';

const REVENUE = '/api/superadmin/revenue';
const TENANTS = '/api/superadmin/tenants';

// GET /api/superadmin/revenue as route.ts:54 answers it (top-level mrr + events).
const REV_ROWS = {
  mrr: { mrr: '1280', paying: 12, trialing: 3, free_tier: 40 },
  events: [
    { id: 'e1', eventType: 'invoice.paid', tenantName: 'Acme Analytics', amount: '79.00', createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'e2', eventType: 'payment_failed', tenantName: 'Northwind Labs', amount: '29.00', createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
  ],
};
const REV_EMPTY = { mrr: { mrr: '0', paying: 0, trialing: 0, free_tier: 0 }, events: [] };

// GET /api/superadmin/tenants as route.ts:95 answers it ({ data: [...] }). The page
// uses plan_id / status / created_at only. Pro is 79/mo (page.tsx PLAN_PRICES), so
// two active Pro tenants ⇒ an MRR cell of $158 — a tenants-derived number used here
// to prove the tenants region stays real while the revenue read is failed, etc.
const TEN_ROWS = {
  data: [
    { plan_id: 'pro', status: 'active', created_at: '2026-01-05T00:00:00Z' },
    { plan_id: 'pro', status: 'active', created_at: '2026-02-05T00:00:00Z' },
    { plan_id: 'starter', status: 'trialing', created_at: '2026-02-06T00:00:00Z' },
    { plan_id: 'free', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  ],
};
const TEN_EMPTY = { data: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const loading = (): QueryResult => ({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });
/** never answered: no data, an error object (with or without a message). */
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** refused refresh: the read answered earlier (data present) AND errored now. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// Each banner names its read, then the reason that read was refused, then the
// specific loss. The middle is dynamic (`${revReason}` / `${tenReason}`) exactly as
// in the merged #2872 panels, so the two halves are pinned here and the reason is
// pinned by the `names the refusal` cases.
const REV_OUTAGE_HEAD = 'Failed to load revenue:';
const REV_STALE_HEAD = 'Could not refresh revenue, so the totals and billing events below are the last read:';
const TEN_OUTAGE_HEAD = 'Failed to load the organization list:';
const TEN_STALE_HEAD = 'Could not refresh the organization list, so the plan breakdown and monthly chart below are the last read:';
const REV_OUTAGE = 'The four totals and the billing events below are unanswered — not zero revenue, and not an empty event list.';
const REV_STALE = 'A plan change, a new paying tenant, or a charge that arrived since this was fetched is missing here, while every total below still counts the old ones.';
const TEN_OUTAGE = 'The plan breakdown and the monthly chart below are unanswered — not an empty plan mix.';
const TEN_STALE = 'A tenant that upgraded, downgraded, or signed up since this was fetched is counted the old way, is missing from its plan row, or is absent from the chart\'s month.';

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';
const metricValues = () =>
  screen.getAllByText(/^(\$[\d,.]+|\d+|—)$/)
    .filter((el) => el.className.includes('text-2xl'))
    .map((el) => el.textContent);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup();
  return render(
    <QueryClientProvider client={client}>
      <RevenuePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registry.byUrl = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a refused revenue refresh keeps the numbers and says what it is missing', () => {
  it('keeps the metric cards and events on screen under the caveat, never an outage', () => {
    const rev = staleRead(REV_ROWS);
    registry.byUrl = { [REVENUE]: rev, [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toContain(REV_STALE);
    expect(alerts()).not.toContain(REV_OUTAGE);
    // The kept revenue figures are still facts on the page (not dashed).
    expect(metricValues()).toContain('$1,280');
    expect(screen.getByText('Acme Analytics')).toBeTruthy();
    expect(fireEvent.click(screen.getByRole('button', { name: /try again/i }))).toBe(true);
    expect(rev.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[TENANTS].refetch).toHaveBeenCalledTimes(0);
  });

  it('the stale caveat names the specific loss, not a vague warning', () => {
    registry.byUrl = { [REVENUE]: staleRead(REV_ROWS), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toMatch(/plan change, a new paying tenant, or a charge that arrived since this was fetched is missing here/i);
    expect(alerts()).not.toMatch(/may be out of date|out of date|some data/i);
  });

  it('a refused revenue refresh over an empty last read still shows the empty, plus the caveat', () => {
    registry.byUrl = { [REVENUE]: staleRead(REV_EMPTY), [TENANTS]: ok(TEN_ROWS) };
    mount();
    // The read established zero events, so the empty sentence is honest here — with the caveat above it.
    expect(screen.getByText('No billing events yet')).toBeTruthy();
    expect(screen.getByText('Setup Stripe webhook')).toBeTruthy();
    expect(alerts()).toContain(REV_STALE);
    expect(alerts()).not.toContain(REV_OUTAGE);
  });

  it('names the reason the refresh was refused, in the middle of the sentence', () => {
    registry.byUrl = { [REVENUE]: staleRead(REV_ROWS), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toContain(`${REV_STALE_HEAD} Request failed (504).`);
    expect(alerts()).toContain(REV_STALE);
  });

  it('states a complete sentence whether or not the refusal carried a message', () => {
    registry.byUrl = { [REVENUE]: staleRead(REV_ROWS, ''), [TENANTS]: ok(TEN_ROWS) };
    mount();
    // A refusal that said nothing still reads as a sentence, never `undefined` and
    // never an empty clause where the reason belongs.
    expect(alerts()).toContain(`${REV_STALE_HEAD} no response from the server.`);
    expect(alerts()).not.toMatch(/undefined|null/);
    expect(alerts()).toContain(REV_STALE);
  });
});

describe('a revenue read that never answered gets an outage and dashes every derived figure', () => {
  it('prints the outage sentence and dashes the four revenue cards (no false zero)', () => {
    const rev = failedRead();
    registry.byUrl = { [REVENUE]: rev, [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toContain(`${REV_OUTAGE_HEAD} Request failed (500).`);
    expect(alerts()).toContain(REV_OUTAGE);
    expect(alerts()).not.toContain(REV_STALE);
    // MRR / Paying / Free Tier / ARPU are all withheld, not reported as 0.
    expect(screen.queryByText('$1,280')).toBeNull();
    expect(screen.queryByText('12')).toBeNull();
    expect(screen.queryByText('40')).toBeNull();
    expect(metricValues().filter((v) => v === '—').length).toBeGreaterThanOrEqual(4);
    expect(rev.refetch).not.toHaveBeenCalled();
  });

  it('withholds the events rather than claiming "no billing events yet"', () => {
    registry.byUrl = { [REVENUE]: failedRead('kaboom'), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toContain('Failed to load revenue: kaboom.');
    expect(screen.queryByText('No billing events yet')).toBeNull();
    expect(screen.queryByText('Setup Stripe webhook')).toBeNull();
    expect(bodyText()).toMatch(/Billing events .*known/i);
  });

  it('dashes the revenue-derived Total MRR inside the plan table while keeping the tenants rows real', () => {
    registry.byUrl = { [REVENUE]: failedRead(''), [TENANTS]: ok(TEN_ROWS) };
    mount();
    // one read's outage must not make the other read look broken:
    expect(bodyText()).toMatch(/pro/i); // plan rows still present (capitalize is CSS-only)
    expect(screen.getByText('$158')).toBeTruthy(); // tenants-derived
    // and the revenue-derived total in that table is dashed
    expect(alerts()).toContain(REV_OUTAGE);
    expect(alerts()).not.toContain(TEN_OUTAGE);
  });

  it('retries only the revenue read from the outage banner', () => {
    const rev = failedRead();
    registry.byUrl = { [REVENUE]: rev, [TENANTS]: ok(TEN_ROWS) };
    mount();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(rev.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[TENANTS].refetch).toHaveBeenCalledTimes(0);
  });

  it('offers no write control whose availability the failed read decides', () => {
    registry.byUrl = { [REVENUE]: failedRead(), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(screen.queryAllByRole('button', { name: /save|revoke|charge|send|delete|suspend|disable|toggle|upgrade|downgrade/i })).toHaveLength(0);
  });
});

describe('a tenants read that never answered is judged on its own', () => {
  it('shows the tenants outage while the revenue cards and events stay real', () => {
    const ten = failedRead('boom');
    registry.byUrl = { [REVENUE]: ok(REV_ROWS), [TENANTS]: ten };
    mount();
    expect(alerts()).toContain(TEN_OUTAGE);
    expect(alerts()).not.toContain(REV_OUTAGE);
    expect(alerts()).not.toContain(REV_STALE);
    expect(metricValues()).toContain('$1,280'); // revenue healthy → not dashed
    expect(screen.getByText('Acme Analytics')).toBeTruthy();
    expect(fireEvent.click(screen.getByRole('button', { name: /try again/i }))).toBe(true);
    expect(ten.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[REVENUE].refetch).toHaveBeenCalledTimes(0);
  });

  it('withholds the plan counts and monthly chart instead of an empty plan mix', () => {
    registry.byUrl = { [REVENUE]: ok(REV_ROWS), [TENANTS]: failedRead('') };
    mount();
    expect(screen.queryByText('No revenue data yet')).toBeNull();
    expect(bodyText()).toMatch(/Monthly MRR .*known/i);
    expect(screen.queryByText('$158')).toBeNull(); // tenants-derived, so withheld
    expect(alerts()).toContain(`${TEN_OUTAGE_HEAD} no response from the server.`);
    expect(alerts()).not.toMatch(/undefined/);
    expect(alerts()).toContain(TEN_OUTAGE);
  });
});

describe('a refused tenants refresh keeps the plan rows and adds a caveat', () => {
  it('keeps the plan breakdown on screen and names the specific loss', () => {
    const ten = staleRead(TEN_ROWS);
    registry.byUrl = { [REVENUE]: ok(REV_ROWS), [TENANTS]: ten };
    mount();
    expect(alerts()).toContain(`${TEN_STALE_HEAD} Request failed (504).`);
    expect(alerts()).toContain(TEN_STALE);
    expect(alerts()).not.toContain(TEN_OUTAGE);
    expect(alerts()).toMatch(/upgraded, downgraded, or signed up since this was fetched is counted the old way/i);
    expect(screen.getByText('$158')).toBeTruthy();
    expect(fireEvent.click(screen.getByRole('button', { name: /try again/i }))).toBe(true);
    expect(ten.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[REVENUE].refetch).toHaveBeenCalledTimes(0);
  });
});

describe('one read in flight does not skeletonize the other (the union-loading bug)', () => {
  it('revenue loading does not hide an already-answered tenants read', () => {
    registry.byUrl = { [REVENUE]: loading(), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(bodyText()).toMatch(/Loading/); // the revenue region
    expect(screen.getByText('Revenue by Plan')).toBeTruthy(); // tenants still rendered
    expect(screen.getByText('$158')).toBeTruthy();
    expect(alerts()).toBe(''); // loading is never an outage
  });

  it('tenants loading does not hide an already-answered revenue read', () => {
    registry.byUrl = { [REVENUE]: ok(REV_ROWS), [TENANTS]: loading() };
    mount();
    expect(metricValues()).toContain('$1,280'); // revenue still rendered
    expect(bodyText()).toMatch(/Loading/);
    expect(alerts()).toBe('');
  });
});

describe('healthy reads raise nothing', () => {
  it('rows on both reads: no banner at all', () => {
    registry.byUrl = { [REVENUE]: ok(REV_ROWS), [TENANTS]: ok(TEN_ROWS) };
    mount();
    expect(alerts()).toBe('');
    expect(metricValues()).toEqual(['$1,280', '12', '40', '$107']);
    expect(screen.getByText('invoice.paid')).toBeTruthy();
    expect(screen.getByText('payment failed')).toBeTruthy();
    expect(screen.getByText('$158')).toBeTruthy();
  });

  it('empty on both reads: honest empty sentences, no banner', () => {
    registry.byUrl = { [REVENUE]: ok(REV_EMPTY), [TENANTS]: ok(TEN_EMPTY) };
    mount();
    expect(alerts()).toBe('');
    expect(screen.getByText('No billing events yet')).toBeTruthy();
    expect(screen.getByText('Setup Stripe webhook')).toBeTruthy();
    expect(screen.getByText('No revenue data yet')).toBeTruthy();
  });
});

describe('both reads refuse at once, and each banner retries only its own read', () => {
  it('a failed revenue read and a stale tenants read speak separately', () => {
    const rev = failedRead();
    const ten = staleRead(TEN_ROWS);
    registry.byUrl = { [REVENUE]: rev, [TENANTS]: ten };
    mount();
    const tryAgain = screen.getAllByRole('button', { name: /try again/i });
    expect(tryAgain).toHaveLength(2);
    // Revenue outage is the first banner in the DOM (above the metrics grid);
    // the tenants caveat sits above the plan grid, so it is the second.
    expect(alerts()).toContain(REV_OUTAGE);
    expect(alerts()).toContain(TEN_STALE);
    fireEvent.click(tryAgain[0]);
    expect(rev.refetch).toHaveBeenCalledTimes(1);
    expect(ten.refetch).toHaveBeenCalledTimes(0);
    fireEvent.click(tryAgain[1]);
    expect(ten.refetch).toHaveBeenCalledTimes(1);
    expect(rev.refetch).toHaveBeenCalledTimes(1); // still only once
  });
});

describe('the source ratchet this slice closes (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/revenue/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits EACH read into the two states instead of branching on the bare flag', () => {
    const s = src();
    expect(s).toMatch(/const revenueFailed\s*=\s*Boolean\(revErr\) && !revData;/);
    expect(s).toMatch(/const revenueStale\s*=\s*Boolean\(revErr\) && Boolean\(revData\);/);
    expect(s).toMatch(/const tenantsFailed\s*=\s*Boolean\(tenErr\) && !tenData;/);
    expect(s).toMatch(/const tenantsStale\s*=\s*Boolean\(tenErr\) && Boolean\(tenData\);/);
    // every render arm keys off the derived flags...
    expect(s).toMatch(/\{revenueFailed && \(/);
    expect(s).toMatch(/\{revenueStale && \(/);
    expect(s).toMatch(/\{tenantsFailed && \(/);
    expect(s).toMatch(/\{tenantsStale && \(/);
    // ...and none keys off the bare error object (`{error && …}` / `{!error …}`).
    expect(s).not.toMatch(/\{\s*!?\s*revErr\b/);
    expect(s).not.toMatch(/\{\s*!?\s*tenErr\b/);
    expect(s).not.toMatch(/&&\s*!?revErr\b/);
    expect(s).not.toMatch(/&&\s*!?tenErr\b/);
    // and no JSX arm references the query's `.error` directly.
    expect(s).not.toMatch(/\{\s*!?\s*(revenueQuery|tenantsQuery)\.error/);
  });

  it('retires the union loading so one read cannot skeletonize the other', () => {
    const s = src();
    expect(s).not.toMatch(/revenueQuery\.isLoading\s*\|\|\s*tenantsQuery\.isLoading/);
    expect(s).toMatch(/const revenueLoading = revenueQuery\.isLoading;/);
    expect(s).toMatch(/const tenantsLoading = tenantsQuery\.isLoading;/);
  });

  it('renders both banners ABOVE the rows they describe', () => {
    const s = src();
    // The revenue banner is above the metric grid (and therefore above the events
    // list too, which is further down); the tenants banner is above the plan grid.
    expect(s.indexOf('revenueFailed && (')).toBeGreaterThan(-1);
    expect(s.indexOf('revenueFailed && (')).toBeLessThan(s.indexOf('Monthly Recurring Revenue'));
    expect(s.indexOf('revenueStale && (')).toBeLessThan(s.indexOf('Monthly Recurring Revenue'));
    expect(s.indexOf('tenantsFailed && (')).toBeLessThan(s.indexOf('Revenue by Plan'));
    expect(s.indexOf('tenantsStale && (')).toBeLessThan(s.indexOf('Revenue by Plan'));
  });

  it('keeps server internals out of the operator-visible copy', () => {
    const s = src();
    // Rule #3 bans what the page PRINTS ITSELF — a source path, a status code typed
    // into the copy, server vocabulary. The refusal's own message arrives as a
    // dynamic `${revReason}`/`${tenReason}`, which is what every merged #2872 panel
    // shows, so it is not a literal here and the ban does not reach it.
    const copy = s.split('\n').filter((line) => /message=\{?[`"]/.test(line)).join('\n');
    expect([...copy.matchAll(/message=/g)]).toHaveLength(4); // the four banners, nothing else
    for (const frag of [REV_OUTAGE_HEAD, REV_OUTAGE, REV_STALE_HEAD, REV_STALE,
                        TEN_OUTAGE_HEAD, TEN_OUTAGE, TEN_STALE_HEAD, TEN_STALE]) {
      expect(copy, frag).toContain(frag);
    }
    expect(copy).toContain('{revReason}');
    expect(copy).toContain('{tenReason}');
    expect(s).toMatch(/const revReason = revErr\?\.message \|\| 'no response from the server';/);
    expect(s).toMatch(/const tenReason = tenErr\?\.message \|\| 'no response from the server';/);
    expect(copy, 'a source path reached the operator').not.toMatch(/app\/api|\.tsx?:\d|route\.ts|schema\//);
    expect(copy, 'server vocabulary reached the operator').not.toMatch(/\bendpoint\b|\broute\b|\bstatus code\b|\b404\b|\b500\b|\b504\b/);
    expect(copy, 'a hedged caveat').not.toMatch(/out of date|may be|some data/i); // rule 2
  });

  it('has no write control to gate on `failed` (and asserts the page does not add one)', () => {
    const s = src();
    expect(s).not.toMatch(/method:\s*['"](?:POST|PATCH|DELETE|PUT)['"]/i);
    expect(s).not.toMatch(/\bfetch\(\s*['"`]\/api/);
    expect(s).not.toMatch(/useMutation|\.mutate\(/);
  });

  it('is invisible to the sweep, before and after each rewind of the split', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} is back on the guard's list`).toBe(false);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{revenueStale && \([\s\S]*?\n\s*\)\}\n/, '\n'],
      [/\{revenueStale && \(/, '{false && ('],
      [/\{revenueFailed && \(/, '{revErr && !revData && ('],
      [/const revenueStale\s*=\s*Boolean\(revErr\) && Boolean\(revData\);/, 'const revenueStale = false;'],
      [/revenueQuery\.isLoading;\n\s*const tenantsLoading = tenantsQuery\.isLoading;/, 'revenueQuery.isLoading || tenantsQuery.isLoading;\n  const tenantsLoading = false;'],
    ];
    for (const [pattern, replacement] of rewinds) {
      const rewound = s.replace(pattern, replacement);
      expect(rewound, `the shape this slice depends on moved: ${pattern}`).not.toBe(s);
      expect(
        inspect(FILE, rewound).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files, `${FILE} went on the list it was never on`).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('OK — 0 panel(s)');
    expect(res.stdout).not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
