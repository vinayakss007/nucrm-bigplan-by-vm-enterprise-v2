// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/tenant/settings/billing`, the billing overview.
 *
 * Measured against `origin/main`'s copy of `app/tenant/settings/billing/page.tsx` (scratch
 * worktree, `npx vitest run tests/unit/panel-page-error-not-empty-billing-overview-stale-2872.test.tsx`):
 *   BEFORE the fix: 12 tests, 10 red, 2 green (the healthy pair).
 *   AFTER  the fix: 12 tests, 0 red, 12 green.
 *
 * Two reads, neither of which binds `error`: `/api/tenant/workspace` and
 * `/api/tenant/plans`. Their failure states were folded into the ordinary "nothing here"
 * render, in the two ways this epic keeps finding:
 *
 *   - `if (!workspace) return null` — a workspace read that failed renders a **blank page**.
 *     No heading, no plan, no usage, no upgrade path, no retry, no reason. The operator's
 *     only clue is that the screen is empty. The `!workspace` arm is also what an answered
 *     "this tenant has no workspace row" hits, so the outage and the answer share a branch.
 *   - `plans = plansData?.data ?? []` — a plans read that failed leaves `currentPlan`
 *     undefined, so the usage bars silently fall back to `?? 500` and `?? 1` and print
 *     "1,200 / 500 (240%)"-style limits the tenant never had, `upgradablePlans` collapses to
 *     `[]` and the whole "Upgrade Your Plan" card disappears — a plan catalogue that did not
 *     load reads as a catalogue with nothing in it.
 *
 * The Stripe buttons are the reason `stale` has to keep the rows: after a checkout the
 * page revalidates, and a refused refresh must not hide the plan the payment just bought.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import BillingPage from '@/app/tenant/settings/billing/page';

const WORKSPACE = '/api/tenant/workspace';
const PLANS = '/api/tenant/plans';

const workspaceRead = {
  data: {
    plan_id: 'pro',
    status: 'active',
    stripe_customer_id: 'cus_0a1b2c',
    current_contacts: 1200,
    current_users: 6,
    trial_ends_at: null,
  },
};
const plansRead = {
  data: [
    { id: 'pro', name: 'Pro', price_monthly: 59, max_contacts: 5000, max_users: 10, max_automations: 20 },
    { id: 'scale', name: 'Scale', price_monthly: 99, max_contacts: 20000, max_users: 25, max_automations: 100 },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('billing overview: a workspace read that failed is not a blank screen (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('reports the outage instead of rendering nothing', () => {
    registry.byUrl = { [WORKSPACE]: failed('Request failed (503)'), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    expect(alerts()).toMatch(/Failed to load this workspace's billing state/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    expect(bodyText()).not.toMatch(/No further plan/i);
  });

  it('re-runs the workspace read from the banner, and issues no write', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [WORKSPACE]: failed(), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[WORKSPACE].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the plan it read and calls it the last read when the refresh is refused', () => {
    registry.byUrl = { [WORKSPACE]: staleRead(workspaceRead), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    expect(bodyText()).toMatch(/Current Plan/);
    expect(screen.getByText('pro')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load this workspace's billing state/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('leaves every billing action reachable over a stale workspace read', () => {
    registry.byUrl = { [WORKSPACE]: staleRead(workspaceRead), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    const portal = screen.getByRole('button', { name: /manage billing/i });
    expect(portal.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /upgrade to scale/i }).disabled).toBe(false);
  });

  it('says "no response from the server" for a messageless failure, and never `undefined`', () => {
    registry.byUrl = { [WORKSPACE]: failed(''), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(bodyText()).not.toMatch(/undefined/);
  });
});

describe('billing overview: a plan catalogue that did not load is not an empty catalogue (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('still renders the plan it read, and names the catalogue outage', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: failed('Request failed (502)') };
    wrapped(<BillingPage />);
    // Reachability: the current plan and its Stripe controls are not the plans read's region.
    expect(bodyText()).toMatch(/Current Plan/);
    expect(screen.getByRole('button', { name: /manage billing/i }).disabled).toBe(false);
    expect(alerts()).toMatch(/Failed to load the plan list/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('prints `—` instead of a made-up limit when the catalogue is unanswered', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: failed() };
    wrapped(<BillingPage />);
    expect(bodyText()).toMatch(/1,200 \/ —/);
    expect(bodyText()).not.toMatch(/1,200 \/ 500/);
    expect(bodyText()).toMatch(/Not read/);
  });

  it('keeps the upgrade options and calls them the last read', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: staleRead(plansRead) };
    wrapped(<BillingPage />);
    expect(screen.getByRole('button', { name: /upgrade to scale/i })).toBeTruthy();
    expect(bodyText()).toMatch(/1,200 \/ 5,000/);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load the plan list/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('re-runs the plan read from its banner without touching the workspace read', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: failed() };
    wrapped(<BillingPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /plan list/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PLANS].refetch).toHaveBeenCalled();
    expect(registry.byUrl[WORKSPACE].refetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('prints the absence sentence, with no alert, when the catalogue answered with nothing to move to', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: ok({ data: [plansRead.data[0]] }) };
    wrapped(<BillingPage />);
    expect(bodyText()).toMatch(/No further plan/i);
    expect(alerts()).toBe('');
  });

  it('prints the caveat AND the absence sentence when a refused refresh sat on an empty catalogue', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: staleRead({ data: [plansRead.data[0]] }) };
    wrapped(<BillingPage />);
    expect(bodyText()).toMatch(/No further plan/i);
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing alarming for a plan and a catalogue it read', () => {
    registry.byUrl = { [WORKSPACE]: ok(workspaceRead), [PLANS]: ok(plansRead) };
    wrapped(<BillingPage />);
    expect(alerts()).toBe('');
    expect(bodyText()).toMatch(/1,200 \/ 5,000/);
    expect(bodyText()).not.toMatch(/No further plan/i);
  });
});
