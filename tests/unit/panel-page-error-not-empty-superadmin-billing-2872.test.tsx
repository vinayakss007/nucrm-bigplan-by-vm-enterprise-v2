// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `superadmin/billing` (2 reads, no error branch at all before this).
 *
 * The page binds both reads as whole result objects (`plansQuery`, `tenantsQuery`) and
 * read only `.data`/`.isLoading`. `useApiQuery` keeps `data` through a refused
 * revalidation, so:
 *   - a failed plans read collapsed the grid to zero cards — a false "no plans" — and,
 *     worse, the create/edit flow could then be pressed against a grid that never
 *     answered;
 *   - a failed tenants read collapsed `planCounts` to `{active:0, trialing:0}` for every
 *     plan, printing "0 Active / 0 Trialing" under real plans — an all-clear on subscriber
 *     counts that a dead read has no authority to give.
 *
 * Measured by running this suite before/after the fix (origin/main's copy restored to a
 * scratch dir for the RED run):
 *   BEFORE — red 7 / green 2 of 9 (the guard-green ratchet and the fully-answered silence).
 *   AFTER  — red 0 / green 9.
 *
 * House rules applied: an empty grid becomes an explicit outage; derived counts print
 * `—`, never `0`, when their read has not answered; a stale read keeps the cards and the
 * "New Plan" action stays clickable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import BillingPage from '@/app/superadmin/billing/page';

const PLANS = '/api/superadmin/plans';
const TENANTS = '/api/superadmin/tenants';

// TEST-NET-style ids + RFC 2606 hostnames where any appear: public repo, no real data.
const plan = (id: string, name: string, price: number) => ({
  id, name, price_monthly: price, price_yearly: price * 10, max_users: 5, max_contacts: 1000,
  max_deals: 500, max_automations: 5, max_forms: 3, max_api_calls_day: 1000, max_storage_gb: 1,
  features: ['contacts', 'deals'], sort_order: 1,
});
const plansAnswer = { data: [plan('pro', 'Pro', 49), plan('free', 'Free', 0)] };
const tenantsAnswer = {
  data: [
    { plan_id: 'pro', status: 'active' },
    { plan_id: 'pro', status: 'active' },
    { plan_id: 'pro', status: 'trialing' },
    { plan_id: 'free', status: 'active' },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('billing plans grid: an outage is not "no plans" (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [PLANS]: ok(plansAnswer), [TENANTS]: ok(tenantsAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('replaces the empty grid with an explicit outage', () => {
    registry.byUrl[PLANS] = failed('Request failed (503)');
    wrapped(<BillingPage />);
    expect(alerts()).toMatch(/plans/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).toMatch(/failed request|not .*no plans|empty/i);
    expect(screen.queryByText('Pro')).toBeNull();
  });

  it('keeps the cards and flags a refused refresh the last read', () => {
    registry.byUrl[PLANS] = staleRead(plansAnswer);
    wrapped(<BillingPage />);
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // Reachability: the create action stays clickable over a stale read.
    expect(screen.getByRole('button', { name: /new plan/i })).toBeTruthy();
  });

  it('re-runs the plans read from the outage banner and issues no write', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    registry.byUrl[PLANS] = failed('Request failed (503)');
    wrapped(<BillingPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /plans/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PLANS].refetch).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('billing subscriber counts: print —, never 0, when the tenant read has not answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [PLANS]: ok(plansAnswer), [TENANTS]: ok(tenantsAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows em-dashes and an outage caveat instead of a false all-clear', () => {
    registry.byUrl[TENANTS] = failed('Request failed (502)');
    wrapped(<BillingPage />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(alerts()).toMatch(/tenant|subscri|count/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
  });

  it('keeps the counts and flags them the last read on a refused refresh', () => {
    registry.byUrl[TENANTS] = staleRead(tenantsAnswer, 'Request failed (503)');
    wrapped(<BillingPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(screen.getByText('Pro')).toBeTruthy();
  });
});

describe('billing: fallback text and the fully-answered page (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [PLANS]: ok(plansAnswer), [TENANTS]: ok(tenantsAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('prints the fallback reason for a messageless error, never "undefined"', () => {
    registry.byUrl[PLANS] = failed('');
    wrapped(<BillingPage />);
    expect(alerts()).toMatch(/no response from the server/i);
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('shows the real subscriber counts with no alert when both reads answered', () => {
    wrapped(<BillingPage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('Pro')).toBeTruthy();
    // pro → 2 active, free → 1 active: real numbers, not — and not all zeros.
    expect(screen.getByText('2')).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/billing/page.tsx';

  it('splits the two states apart and keeps the fallback text', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    // Object-bound spelling: `Boolean(plansQuery.error) && !plansQuery.data` — the dot is
    // part of the read, so the tolerant form matches both destructured and object queries.
    expect(src).toMatch(/Boolean\([^)]*[Ee]rror[^)]*\)\s*&&\s*!/);
    expect(src).toMatch(/&&\s*Boolean\(/);
    expect(src).toMatch(/\.message \|\| 'no response from the server'/);
    expect(src).not.toMatch(/if \(\w*[Ee]rror\)\s*toast\.error/);
  });

  it('keeps #2829\'s guard green, with no new baseline entry', () => {
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout + res.stderr).not.toContain(FILE);
  });
});
