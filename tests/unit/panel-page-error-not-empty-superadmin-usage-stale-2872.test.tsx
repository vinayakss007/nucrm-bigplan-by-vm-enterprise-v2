// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2872 — `app/superadmin/usage/page.tsx`: the fleet-wide usage panel that could
 * not say it was holding an old read.
 *
 * One read (`/api/superadmin/usage`, page.tsx:53-56), and after #2829 the page had
 * exactly one judgement about it: `usageError`. That is the outage judgement, and
 * TanStack does not hand back an outage when a refresh is refused — it hands back
 * the last successful payload *plus* an error. The measured consequence on main:
 *
 *   - the rows, the 80% warning and the growth chart all kept rendering (they read
 *     `data`, which is still there), so the refused refresh was invisible;
 *   - the absence arm `!loading && !usageError && !tenants.length` (page.tsx:150)
 *     went false, so a read that had answered "no tenants" and then refused to
 *     refresh showed neither the absence it established nor any tell;
 *   - the outage arm `usageError && !tenants.length` fired instead whenever a
 *     *search* emptied the kept rows, telling the operator the fleet never came
 *     back while the fleet was on the page one row up.
 *
 * `failed` is the first of those, `stale` the second. The channel matters here more
 * than on most pages: #2829's red `role="alert"` box now means one thing —
 * nobody read the fleet — and tests/unit/panel-page-error-not-empty-2829.test.tsx:310
 * pins that a kept read raises no alert, which is why the caveat below is a polite
 * `role="status"` notice rather than a second alert.
 *
 * What the read actually is (app/api/superadmin/usage/route.ts): `tenantUsage` is
 * one row per tenant joined to its plan (:40-44), restricted to status
 * active/trialing (:42) and capped at 100 rows ordered by contact count (:44), with
 * `contact_pct`/`user_pct` computed server-side as contacts/maxContacts and
 * users/maxUsers (:37-38) — the page's 80% warning is derived from those two at
 * page.tsx:90, and deals have no percentage at all. `growth` is a fleet-wide sum of
 * contacts/deals/users per snapshot day over 30 days (:46-59), and the GET itself
 * writes a snapshot first (:22). So the stale caveat names those quantities, and
 * the healthy read's numbers stay on screen rather than going to `—`.
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
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, ResponsiveContainer: Stub,
  };
});

import UsagePage from '@/app/superadmin/usage/page';

const USAGE = '/api/superadmin/usage';

const northwind = {
  id: 'n1', name: 'Northwind Trading', status: 'active', plan_id: 'pro',
  current_contacts: 812, current_deals: 44, current_users: 9,
  max_contacts: 1000, max_deals: 200, max_users: 20, contact_pct: 81, user_pct: 45,
};
const kestrel = {
  id: 'n2', name: 'Kestrel Logistics', status: 'trialing', plan_id: 'starter',
  current_contacts: 60, current_deals: 4, current_users: 18,
  max_contacts: 200, max_deals: 50, max_users: 20, contact_pct: 30, user_pct: 90,
};
const wayne = {
  id: 'n3', name: 'Wayne Enterprises', status: 'active', plan_id: 'enterprise',
  current_contacts: 120, current_deals: 12, current_users: 5,
  max_contacts: 5000, max_deals: 1500, max_users: 100, contact_pct: 2, user_pct: 5,
};

const fleet = {
  tenantUsage: [northwind, kestrel, wayne],
  growth: [
    { snapshot_date: '2026-02-01', contacts: 900, deals: 55, users: 30 },
    { snapshot_date: '2026-02-02', contacts: 992, deals: 60, users: 32 },
  ],
};
const none = { tenantUsage: [], growth: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this page could not reach: the read answered, then refused. */
const staleRead = (data: unknown = fleet, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const OUTAGE = 'Could not load tenant usage — this is a failed request, not an empty fleet.';

/** #2829's channel: nothing was read. */
const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** #2872's channel: something was read, and it is older than it looks. */
const notices = () =>
  screen.queryAllByRole('status').map((el) => el.textContent ?? '').join(' | ');
/** The amber warning line, whose count is the aggregate this page exists for. */
const warningLine = () =>
  Array.from(document.querySelectorAll('p')).map((p) => p.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';
const tenantRows = () => document.querySelectorAll('tbody tr').length;

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a refused refresh keeps the fleet and says what it is missing (#2872)', () => {
  it('names the kept read, with the reason the refresh was refused', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    expect(tenantRows()).toBe(3);
    expect(notices()).toContain('Could not refresh, so the organizations, their usage figures and the growth series below are the last read: Request failed (504)');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[USAGE].refetch).toHaveBeenCalledTimes(1);
  });

  it('names the tenant that tipped, the moved plan max, and the older row counts', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    // Not "some data may be out of date": the decision at stake is which tenant to
    // chase about its limit, and page.tsx:90 only knows what this read said.
    expect(notices()).toMatch(/crossed 80% of its contact or user limit since this was fetched/i);
    expect(notices()).toMatch(/plan whose max moved/i);
    expect(notices()).toMatch(/every count on the rows is from before the refresh failed/i);
    expect(notices()).not.toMatch(/may be out of date/i);
  });

  it('does not describe a refused refresh as a load that never happened', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    expect(alerts()).toBe('');
    expect(alerts()).not.toContain(OUTAGE);
    expect(screen.queryByText('No tenants found')).toBeNull();
  });

  it('keeps the 80% warning counting the organizations it is still showing', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    // contact_pct 81 (Northwind) and user_pct 90 (Kestrel) — Wayne is nowhere near.
    expect(warningLine()).toContain('2 organizations at 80%+ of their limits');
    expect(warningLine()).not.toMatch(/0 organizations at 80%/);
  });

  it('keeps the per-tenant figures and the growth series on screen', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.getByText('812')).toBeTruthy();
    expect(screen.getByText(/\/ 1,000/)).toBeTruthy();
    expect(screen.getByText(/Platform-wide Growth \(30 days\)/)).toBeTruthy();
    expect(bodyText()).not.toContain(OUTAGE);
  });

  it('states a reason even when the refusal carried none', () => {
    registry.byUrl = { [USAGE]: staleRead(fleet, '') };
    mount(<UsagePage />);
    expect(notices()).toContain('no response from the server');
    expect(tenantRows()).toBe(3);
  });

  it('does not mistake a search over kept rows for a fleet that never came back', () => {
    registry.byUrl = { [USAGE]: staleRead() };
    mount(<UsagePage />);
    fireEvent.change(screen.getByPlaceholderText(/Search organizations/i), { target: { value: 'zzz-no-match' } });
    expect(alerts()).not.toContain(OUTAGE);
    // The kept read is still on screen and still labelled as kept.
    expect(notices()).toMatch(/last read/i);
    // "No tenants found" here is the pre-existing wording for a search miss on a
    // healthy read (it does not know about the filter); the point of this case is
    // that the refused refresh no longer turns it into an outage claim.
    expect(screen.getByText('No tenants found')).toBeTruthy();
  });

  it('shows a refused refresh of an empty fleet as an empty fleet, plus the caveat', () => {
    registry.byUrl = { [USAGE]: staleRead(none) };
    mount(<UsagePage />);
    expect(screen.getByText('No tenants found')).toBeTruthy();
    expect(notices()).toMatch(/last read/i);
    expect(notices()).toContain('Request failed (504)');
    expect(alerts()).not.toContain(OUTAGE);
  });
});

describe('a read that never answered still gets #2829\'s outage, and nothing else', () => {
  it('keeps the failed-request sentence word for word', () => {
    registry.byUrl = { [USAGE]: failedRead() };
    mount(<UsagePage />);
    expect(alerts()).toContain(OUTAGE);
    expect(screen.queryByText('No tenants found')).toBeNull();
    expect(notices()).toBe('');
  });

  it('prints no rows, no warning and no false zero', () => {
    registry.byUrl = { [USAGE]: failedRead() };
    mount(<UsagePage />);
    expect(tenantRows()).toBe(1); // the outage row, not a fleet
    expect(screen.queryByText('Northwind Trading')).toBeNull();
    expect(screen.queryByText('812')).toBeNull();
    expect(warningLine()).not.toMatch(/at 80%\+ of their limits/);
    expect(bodyText()).not.toMatch(/0 organizations at 80%/);
    expect(screen.queryByText(/Platform-wide Growth/)).toBeNull();
  });

  it('retries the read that failed, once', () => {
    const result = failedRead();
    registry.byUrl = { [USAGE]: result };
    mount(<UsagePage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('offers no control whose availability the failed read decides', () => {
    // Audit for #2872's first rule: this page has no per-tenant link, no raise-limit
    // action and no disable control, so there is nothing to gate. A future one must
    // not be enabled off `tenants`, which is empty precisely because the read failed.
    registry.byUrl = { [USAGE]: failedRead() };
    mount(<UsagePage />);
    expect(screen.queryAllByRole('button', { name: /raise|limit|disable|suspend|delete|open/i })).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    // The refresh button in the header stays clickable — it is the way out.
    expect(tenantRows()).toBe(1);
  });
});

describe('a fleet that is genuinely empty, and a healthy fleet, raise nothing', () => {
  it('says the empty fleet only when the read answered with one', () => {
    registry.byUrl = { [USAGE]: ok(none) };
    mount(<UsagePage />);
    expect(screen.getByText('No tenants found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(notices()).toBe('');
    expect(warningLine()).not.toMatch(/at 80%\+ of their limits/);
  });

  it('shows the rows with no caveat at all once the refresh answers', () => {
    registry.byUrl = { [USAGE]: ok(fleet) };
    mount(<UsagePage />);
    expect(tenantRows()).toBe(3);
    expect(warningLine()).toContain('2 organizations at 80%+ of their limits');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the loading row without claiming anything about the fleet', () => {
    registry.byUrl = { [USAGE]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    mount(<UsagePage />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(notices()).toBe('');
  });
});

describe('the ratchet this slice closes (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/usage/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');
  /** Whitespace-insensitive, so a reformatted old branch still trips it. */
  const tight = (s: string) => s.replace(/\s+/g, '');

  it('splits the read into the two states instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'the outage is still not separated from the kept read').toMatch(/const failed = Boolean\(usageError\) && !data;/);
    expect(s, 'the page still cannot say it is holding the last read').toMatch(/const stale = Boolean\(usageError\) && Boolean\(data\);/);
    expect(s).toMatch(/const reason = usageError\?\.message \|\| 'no response from the server';/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/\{!loading && failed && \(/);
    // #2829's branch keyed off the bare flag, which is how a kept read ended up
    // reported as an outage; the absence arm keyed off `!usageError`, which is how a
    // kept-but-empty read ended up reported as nothing at all.
    expect(tight(s), 'the outage arm is back on the bare flag').not.toContain('!loading&&usageError&&!tenants.length');
    expect(tight(s), 'the absence arm is back on the bare flag').not.toContain('!loading&&!usageError&&!tenants.length');
  });

  it('keeps #2829\'s sentence and the two channels apart', () => {
    const s = src();
    expect(s).toContain('Could not load tenant usage — this is a failed request, not an empty fleet.');
    expect(s, 'the caveat stopped naming a loss').toMatch(/crossed 80% of its contact or user limit/);
    expect(s).toContain('{reason}');
    expect(s, 'the kept-read notice went back to the outage channel').toMatch(/role="status"/);
    expect(s).toMatch(/onRetry=\{\(\) => void refetch\(\)\}/);
  });

  it('is invisible to the sweep, before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} is back on the guard's list`).toBe(false);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{stale && \([\s\S]*?\n\s*\)\}\n/g, '\n'],
      [/\{stale && \(/, '{false && ('],
      [/!loading && !failed && !tenants\.length/, '!loading && !usageError && !tenants.length'],
      [/!loading && failed && \(/, '!loading && usageError && !tenants.length && ('],
      [/const stale = Boolean\(usageError\) && Boolean\(data\);/, 'const stale = false;'],
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
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'usage went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
