// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two billing detail pages: `app/tenant/contracts/[id]` and
 * `app/tenant/subscriptions/[id]`. Each is a single-record read with the
 * "effect-toast only" shape #2872 exists for:
 *
 *     useEffect(() => { if (error) toast.error('Failed to load …'); }, [error]);
 *
 * That is the whole failure channel. TanStack Query keeps `data` when a refresh
 * of a read that already succeeded fails, and both pages branch only on
 * `if (!contract)` / `if (!subscription)` after that. So the two states collapse
 * into one screen — "Contract not found" / "Subscription not found" — permanently
 * answering for a request that either never got through, or got through and then
 * was refused on the page's own reload.
 *
 * The refused-revalidation trigger is real here, not hypothetical: every write
 * (save / status change / delete on the contract; save / pause / resume / cancel on
 * the subscription) ends in `invalidateQueries({ queryKey: <this exact record> })`,
 * so the ordinary state right after the operator acts is "kept record + error flag
 * set". Before this slice the record just edited vanished behind a fading toast, and
 * the page claimed it did not exist.
 *
 * Per page: `failed = Boolean(error) && !data` becomes an outage card that quotes the
 * reason (the false "not found" sentence becomes unreachable); `stale =
 * Boolean(error) && Boolean(data)` keeps the record's own fields — and its Edit /
 * status / Pause actions — and adds a "last read" caveat. A genuine `{ data: null }`
 * answer with no error still says "not found" with no alert. There is no derived
 * figure on either detail page — no tab label, no header total — so, unlike the list
 * pages in this epic, there is no counter to dash.
 *
 * `scripts/check-panel-error-state.mjs` reports both files clean both before and after
 * the split is rewound: "Contract not found" is not one of the empty sentences the
 * sweep recognises, which is exactly why #2829's guard never saw this class and why
 * these assertions are the only screen on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ct-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenant/contracts',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import ContractDetailPage from '@/app/tenant/contracts/[id]/page';
import SubscriptionDetailPage from '@/app/tenant/subscriptions/[id]/page';

// Both pages key the read off `useParams().id`, mocked above to 'ct-1'.
const CONTRACT = '/api/tenant/contracts/ct-1';
const SUBSCRIPTION = '/api/tenant/subscriptions/ct-1';

const contract = {
  id: 'ct-1', title: 'Gulf Retainer', contractNumber: 'CT-0007', contractType: 'services',
  status: 'active', startDate: '2026-01-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z',
  totalValue: '24000', billingFrequency: 'quarterly', terms: 'Net 30.', notes: 'Renews annually.',
  contactId: 'c-1', companyId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
};
const subscription = {
  id: 'ct-1', name: 'Pro Plan', planName: 'Professional', status: 'active',
  startDate: '2026-02-01T00:00:00Z', currentPeriodStart: '2026-09-01T00:00:00Z',
  currentPeriodEnd: '2026-09-30T00:00:00Z', amount: '499', currency: 'USD',
  billingFrequency: 'monthly', autoRenew: true, paymentMethod: 'card', last4: '4242',
  contactId: 'c-1', companyId: null, cancelledAt: null, trialEndDate: null,
  createdAt: '2026-02-01T00:00:00Z', updatedAt: null,
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
  >
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('contract detail: a refused refresh keeps the record it loaded (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the contract fields and says they are the last read', () => {
    const result = staleRead({ data: contract });
    registry.byUrl = { [CONTRACT]: result };
    wrapped(<ContractDetailPage />);
    expect(screen.getByText('Gulf Retainer')).toBeTruthy();
    expect(screen.getByText('#CT-0007')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The outage sentence would be a lie here: the record is on the screen.
    expect(screen.queryByText(/Failed to load contract/)).toBeNull();
    expect(screen.queryByText('Contract not found')).toBeNull();
  });

  it('the kept record is still actionable', () => {
    registry.byUrl = { [CONTRACT]: staleRead({ data: contract }) };
    wrapped(<ContractDetailPage />);
    // Save / status / delete all invalidate this exact key, so this is the page's
    // state right after a write — the Edit affordance has to still be there.
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /mark as (draft|pending|expired|cancelled)/i }).length).toBeGreaterThan(0);
  });

  it('re-runs the contract read from the caveat', () => {
    const result = staleRead({ data: contract });
    registry.byUrl = { [CONTRACT]: result };
    wrapped(<ContractDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [CONTRACT]: staleRead({ data: contract }, '') };
    wrapped(<ContractDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Gulf Retainer')).toBeTruthy();
  });

  it('an unread contract is an outage, and never "Contract not found"', () => {
    registry.byUrl = { [CONTRACT]: failed('Request failed (500)') };
    wrapped(<ContractDetailPage />);
    expect(screen.queryByText('Contract not found')).toBeNull();
    expect(alerts()).toMatch(/Failed to load contract: Request failed \(500\)/);
    expect(alerts()).not.toMatch(/last read/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CONTRACT].refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine empty answer says not found with no alert', () => {
    registry.byUrl = { [CONTRACT]: ok({ data: null }) };
    wrapped(<ContractDetailPage />);
    expect(screen.getByText('Contract not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [CONTRACT]: staleRead({ data: null }) };
    wrapped(<ContractDetailPage />);
    expect(screen.getByText('Contract not found')).toBeTruthy();
    // A refused refresh must not let the page silently claim the record is gone.
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [CONTRACT]: ok({ data: contract }) };
    wrapped(<ContractDetailPage />);
    expect(screen.getByText('Gulf Retainer')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('subscription detail: a refused refresh keeps the record it loaded (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the subscription fields and says they are the last read', () => {
    const result = staleRead({ data: subscription });
    registry.byUrl = { [SUBSCRIPTION]: result };
    wrapped(<SubscriptionDetailPage />);
    expect(screen.getByText('Pro Plan')).toBeTruthy();
    expect(screen.getByText('Professional')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(screen.queryByText(/Failed to load subscription/)).toBeNull();
    expect(screen.queryByText('Subscription not found')).toBeNull();
  });

  it('the kept record is still actionable', () => {
    registry.byUrl = { [SUBSCRIPTION]: staleRead({ data: subscription }) };
    wrapped(<SubscriptionDetailPage />);
    // pause / resume / cancel / save all invalidate this exact key.
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy();
  });

  it('re-runs the subscription read from the caveat', () => {
    const result = staleRead({ data: subscription });
    registry.byUrl = { [SUBSCRIPTION]: result };
    wrapped(<SubscriptionDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [SUBSCRIPTION]: staleRead({ data: subscription }, '') };
    wrapped(<SubscriptionDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Pro Plan')).toBeTruthy();
  });

  it('an unread subscription is an outage, and never "Subscription not found"', () => {
    registry.byUrl = { [SUBSCRIPTION]: failed('Request failed (500)') };
    wrapped(<SubscriptionDetailPage />);
    expect(screen.queryByText('Subscription not found')).toBeNull();
    expect(alerts()).toMatch(/Failed to load subscription: Request failed \(500\)/);
    expect(alerts()).not.toMatch(/last read/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SUBSCRIPTION].refetch).toHaveBeenCalledTimes(1);
  });

  it('a genuine empty answer says not found with no alert', () => {
    registry.byUrl = { [SUBSCRIPTION]: ok({ data: null }) };
    wrapped(<SubscriptionDetailPage />);
    expect(screen.getByText('Subscription not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [SUBSCRIPTION]: staleRead({ data: null }) };
    wrapped(<SubscriptionDetailPage />);
    expect(screen.getByText('Subscription not found')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [SUBSCRIPTION]: ok({ data: subscription }) };
    wrapped(<SubscriptionDetailPage />);
    expect(screen.getByText('Pro Plan')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('overlap hygiene with #2829 (#2872)', () => {
  it('the read is driven entirely inside the panel, never by a fading toast', async () => {
    // A stale/failed state must be observable in the DOM, so no assertion in this
    // file can be satisfied by a `react-hot-toast` call that would disappear in four
    // seconds. The read-failure channel is the banner alone.
    registry.byUrl = { [CONTRACT]: failed('Request failed (500)') };
    wrapped(<ContractDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(/Failed to load contract/), { interval: 10 });
    expect(screen.queryByText('Contract not found')).toBeNull();
  });

  it('keeps the mutation toasts the actions still need', () => {
    // #2872 is about the read; a write still deserves transient feedback.
    for (const f of ['app/tenant/contracts/[id]/page.tsx', 'app/tenant/subscriptions/[id]/page.tsx']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8')).toMatch(/onError:.*toast\.error/);
    }
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/contracts/[id]/page.tsx',
    'app/tenant/subscriptions/[id]/page.tsx',
  ];

  it('splits the two states apart on both pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(error\) && !data/);
      expect(src, `${f} keeps the record without saying it is the last read`).toMatch(/const stale = Boolean\(error\) && Boolean\(data\)/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/error\?\.message \|\| 'no response from the server'/);
      expect(src, `${f} has no outage branch`).toMatch(/\bif \(failed\) \{/);
    }
  });

  it('retires the render-body / effect toast that carried the read failure', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still fires the load-failure toast from a useEffect`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still routes the read to an effect toast`).not.toMatch(/useEffect\(\(\) => \{\s*if \(error\) toast\.error/);
      expect(src, `${f} never bound the failure affordance`).toMatch(/InlineErrorState/);
    }
  });

  it('leaves no derived number keyed off the bare error', () => {
    for (const f of FILES) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} dashes something on the bare error`)
        .not.toMatch(/\w*[Ee]rror \? '—'/);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never have been baselined — the guard cannot see it`).not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // Rewinding the split keeps these pages invisible to the sweep, both before and
    // after: "Contract not found" is not one of the empty sentences the screen
    // recognises, so the render tests above are the only thing standing in its place.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const rewind = src.replace('const failed = Boolean(error) && !data;', 'const failed = Boolean(error);');
      expect(rewind, `${f}: the split changed shape, update this check`).not.toBe(src);
      expect(inspect(f, src).offends, `${f} was already on the guard's list`).toBe(false);
      expect(inspect(f, rewind).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
