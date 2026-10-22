// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/tenant/settings/billing/subscription`, the subscription console.
 *
 * Measured against `origin/main`'s copy of
 * `app/tenant/settings/billing/subscription/page.tsx` (scratch worktree,
 * `npx vitest run tests/unit/panel-page-error-not-empty-billing-subscription-stale-2872.test.tsx`):
 *   BEFORE the fix: 15 tests, 13 red, 2 green (the healthy read, and #2829's guard already
 *     passing — these pages were never on its baseline, which is exactly why they needed a
 *     suite of their own: they bind an error-free render and never claim "there are none").
 *   AFTER  the fix: 15 tests, 0 red, 15 green.
 *
 * Three reads (`/api/tenant/billing/subscription`, `/api/tenant/plans`,
 * `/api/tenant/workspace`), none of them binding `error`; every failure of every one of
 * them lands in the same place as an answer:
 *
 *   - `if (!workspace) return null` — a workspace read that failed renders **nothing at all**
 *     (that arm is also where an answered "no workspace row" goes, so the outage and the
 *     answer are the same screen).
 *   - `subscription?.currentPeriodStart ? … : 'N/A'` — a subscription read that never
 *     answered claims the period is "N/A" and the next bill is **"Free forever"**, because
 *     `currentPrice` is `0` when `currentPlan` is undefined.
 *   - `{currentPlan?.features?.length || 0} included` and
 *     `{currentPlan?.maxUsers || 0} users, {currentPlan?.maxContacts || 0} contacts` — a
 *     plans read that failed prints **`0 included`** and **`0 users, 0 contacts`**: the
 *     limits a paid plan does not have. The usage bars then invent `?? 500` / `?? 1`.
 *   - the comparison modal maps `[...plans].sort(...)` — an unanswered catalogue opens as an
 *     empty grid, which is the "you have no plans to move to" claim in its worst place: the
 *     screen the operator uses to pick a plan.
 *
 * Every action here is a live billing write (upgrade, downgrade, cancel, resume), and each
 * ends in `window.location.reload()`. A refused refresh therefore has to keep the buttons
 * clickable and say plainly which read the visitor is looking at — folding `stale` into
 * `failed` would strand an operator mid-downgrade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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

import SubscriptionPage from '@/app/tenant/settings/billing/subscription/page';

const SUBSCRIPTION = '/api/tenant/billing/subscription';
const PLANS = '/api/tenant/plans';
const WORKSPACE = '/api/tenant/workspace';

const periodStart = '2026-03-01T00:00:00.000Z';
const periodEnd = '2026-04-01T00:00:00.000Z';
const startLabel = new Date(periodStart).toLocaleDateString();
const endLabel = new Date(periodEnd).toLocaleDateString();

const subscriptionRead = {
  data: {
    planId: 'pro',
    planName: 'Pro',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  },
};
const workspaceRead = {
  data: {
    plan_id: 'pro',
    status: 'active',
    stripe_customer_id: 'cus_9f8e7d',
    current_contacts: 1200,
    current_users: 6,
  },
};
const plansRead = {
  data: [
    {
      id: 'pro', name: 'Pro', description: 'For growing teams', priceMonthly: 59,
      maxUsers: 10, maxContacts: 5000, maxDeals: 2000, maxAutomations: 20, maxStorageGb: 50,
      features: [{ k: 'ai' }, { k: 'sla' }],
    },
    {
      id: 'scale', name: 'Scale', description: 'For large books', priceMonthly: 99,
      maxUsers: 25, maxContacts: 20000, maxDeals: 9999, maxAutomations: 100, maxStorageGb: 200,
      features: [{ k: 'ai' }, { k: 'sla' }, { k: 'sso' }],
    },
  ],
};

const healthy = () => ({
  [SUBSCRIPTION]: ok(subscriptionRead),
  [PLANS]: ok(plansRead),
  [WORKSPACE]: ok(workspaceRead),
});
function ok(data: unknown): QueryResult {
  return { data, error: null, isLoading: false, refetch: vi.fn() };
}
function failed(message = 'Request failed (500)'): QueryResult {
  return { data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn() };
}
function staleRead(data: unknown, message = 'Request failed (504)'): QueryResult {
  return { data, error: new Error(message), isLoading: false, refetch: vi.fn() };
}

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';
const openComparison = () => {
  fireEvent.click(screen.getByRole('button', { name: /upgrade plan/i }));
};

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('subscription console: a workspace read that failed is not a blank screen (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('reports the outage instead of rendering nothing', () => {
    registry.byUrl = { ...healthy(), [WORKSPACE]: failed('Request failed (503)') };
    wrapped(<SubscriptionPage />);
    expect(alerts()).toMatch(/Failed to load this workspace's billing state/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    // No fabricated usage: the bars never got their numbers.
    expect(bodyText()).not.toMatch(/1,200/);
  });

  it('re-runs the workspace read from the banner, and issues no write', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { ...healthy(), [WORKSPACE]: failed() };
    wrapped(<SubscriptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[WORKSPACE].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the plan and every button when the workspace refresh is refused', () => {
    registry.byUrl = { ...healthy(), [WORKSPACE]: staleRead(workspaceRead) };
    wrapped(<SubscriptionPage />);
    expect(screen.getByRole('button', { name: /cancel subscription/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /manage billing/i }).disabled).toBe(false);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/Failed to load this workspace's billing state/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });
});

describe('subscription console: a subscription read that failed is not a plan with no dates (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('names the outage and prints `—` rather than "N/A" and "Free forever"', () => {
    registry.byUrl = { ...healthy(), [SUBSCRIPTION]: failed('Request failed (502)') };
    wrapped(<SubscriptionPage />);
    expect(alerts()).toMatch(/Failed to load your subscription/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(bodyText()).not.toMatch(/N\/A/);
    expect(bodyText()).not.toMatch(/Free forever/);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the period it read and calls it the last read', () => {
    registry.byUrl = { ...healthy(), [SUBSCRIPTION]: staleRead(subscriptionRead) };
    wrapped(<SubscriptionPage />);
    expect(screen.getAllByText(startLabel).length).toBeGreaterThan(0);
    expect(bodyText()).toMatch(/59/);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load your subscription/i);
  });

  it('keeps the cancellation state the operator is acting on when the refresh is refused', () => {
    registry.byUrl = {
      ...healthy(),
      [SUBSCRIPTION]: staleRead({ data: { ...subscriptionRead.data, cancelAtPeriodEnd: true } }),
    };
    wrapped(<SubscriptionPage />);
    expect(screen.getByText(/Cancels at period end/i)).toBeTruthy();
    // The Resume control is the action this state exists to offer; it stays reachable.
    expect(screen.getByRole('button', { name: /resume subscription/i }).disabled).toBe(false);
    expect(alerts()).toMatch(/last read/i);
  });

  it('says "no response from the server" for a messageless failure, and never `undefined`', () => {
    registry.byUrl = { ...healthy(), [SUBSCRIPTION]: failed('') };
    wrapped(<SubscriptionPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(bodyText()).not.toMatch(/undefined/);
  });
});

describe('subscription console: an unanswered catalogue is not a tenant with no plans (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('prints `—` for the feature and limit counts the catalogue would have answered', () => {
    registry.byUrl = { ...healthy(), [PLANS]: failed('Request failed (500)') };
    wrapped(<SubscriptionPage />);
    expect(bodyText()).not.toMatch(/0 included/);
    expect(bodyText()).not.toMatch(/0 users, 0 contacts/);
    expect(bodyText()).toMatch(/1,200 \/ —/);
    expect(bodyText()).not.toMatch(/1,200 \/ 500/);
  });

  it('refuses to present the comparison as complete when the catalogue never answered', () => {
    registry.byUrl = { ...healthy(), [PLANS]: failed() };
    wrapped(<SubscriptionPage />);
    openComparison();
    expect(alerts()).toMatch(/Failed to load the plan catalogue/i);
    expect(bodyText()).not.toMatch(/No plans available/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the plan cards in the comparison and calls them the last read', () => {
    registry.byUrl = { ...healthy(), [PLANS]: staleRead(plansRead) };
    wrapped(<SubscriptionPage />);
    openComparison();
    expect(within(screen.getByRole('dialog')).getByText('Scale')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/Failed to load the plan catalogue/i);
  });

  it('re-runs the catalogue read from the comparison banner without touching the other two', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { ...healthy(), [PLANS]: failed() };
    wrapped(<SubscriptionPage />);
    openComparison();
    const banner = screen.queryAllByRole('alert').find((el) => /catalogue/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PLANS].refetch).toHaveBeenCalled();
    expect(registry.byUrl[WORKSPACE].refetch).not.toHaveBeenCalled();
    expect(registry.byUrl[SUBSCRIPTION].refetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says nothing alarming for three reads it answered', () => {
    registry.byUrl = healthy();
    wrapped(<SubscriptionPage />);
    expect(alerts()).toBe('');
    expect(screen.getAllByText(endLabel).length).toBeGreaterThan(0);
    expect(bodyText()).toMatch(/2 included/);
    expect(bodyText()).toMatch(/1,200 \/ 5,000/);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/tenant/settings/billing/subscription/page.tsx';
  const OWNED = [
    PAGE,
    'app/tenant/settings/billing/page.tsx',
    'app/tenant/ai/page.tsx',
    'app/tenant/ai/summarize/page.tsx',
    'app/health/page.tsx',
  ];

  it('bought its room by splitting the modals out, and came off the size baseline', () => {
    // 592 lines was the ceiling the file was frozen at; the comparison grid and the cancel
    // dialog moved to components/tenant/billing/ unchanged, which is what made the channels
    // below affordable without touching the ceiling.
    const lines = readFileSync(join(ROOT, PAGE), 'utf8').split('\n').length - 1;
    expect(lines, `${PAGE} is past the 500-line ceiling (${lines})`).toBeLessThanOrEqual(500);
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/file-size-baseline.json'), 'utf8'));
    expect(baseline[PAGE], 'a grandfathered ceiling that has been shed must come off the list').toBeUndefined();
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'the ratchet hint should have been acted on').not.toContain('remove them from the baseline');
    for (const extracted of [
      'components/tenant/billing/subscription-plan-comparison.tsx',
      'components/tenant/billing/subscription-cancel-dialog.tsx',
    ]) {
      expect(readFileSync(join(ROOT, extracted), 'utf8')).toBeTruthy();
    }
  });

  it('splits the two states apart on every page it touched', () => {
    for (const f of OWNED) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w*[Ee]rror\) && !/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/&& Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} routes a read failure through a toast`).not.toMatch(/if \(\w*[Ee]rror\)\s*toast\.error/);
    }
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale')
      .not.toContain('no longer offends');
  });
});
