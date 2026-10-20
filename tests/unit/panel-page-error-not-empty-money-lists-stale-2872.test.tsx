// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — second slice: the money trio (`orders`, `quotes`, `subscriptions`).
 *
 * All three already survived #2829's question — asked in
 * `panel-page-error-not-empty-money-path-2829.test.tsx` — "does a refused read answer with a
 * 'there are none' sentence?" They do not. This slice answers the other half, the one #2872
 * exists for: what happens when a read that **answered before** fails **now**.
 *
 * TanStack keeps `data` when a refetch of a query that already succeeded fails, so a page
 * branching on the error flag alone spends the ordinary post-save state deleting the rows —
 * and on these three pages the rows are money: the order the operator just created, the
 * subscription whose MRR the header card is supposed to show.
 *
 * This is not a background-revalidation flicker. Each page invalidates its own list key after
 * every mutation (`orders/page.tsx:99`, `quotes/page.tsx:96`, `subscriptions/page.tsx:67`) and
 * `lib/query/client.tsx:51-52` sets `refetchOnWindowFocus: false` with `retry: 2`, so the state
 * arrives after two failed retries — which is to say, right after they pressed the button.
 *
 * Three shapes, all of which were broken here:
 *   - the list branch read the bare error flag, so a refused refresh hid live rows;
 *   - the header cards guarded on the same bare flag, so a refused refresh printed `—` above
 *     a table it was also counting (and `quotes` had **no** guard at all, so it reported a
 *     firm `0` total for a tenant whose quotes it had not read — #2829's original offence,
 *     surviving in the one page the census did not look at);
 *   - `filtered.length === 0` printed "No orders/quotes/subscriptions found" over a read that
 *     had just returned rows, inventing an empty tenant.
 *
 * `orders` and `quotes` also carry a secondary read the guard cannot see at all: the contacts
 * list, which feeds `getContactName` (so every row's Contact column falls back to `-`) and the
 * Contact filter (so it offers nobody). An unread contact list was indistinguishable from
 * orders that have no contact.
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
}));

import toast from 'react-hot-toast';
import OrdersPage from '@/app/tenant/orders/page';
import QuotesPage from '@/app/tenant/quotes/page';
import SubscriptionsPage from '@/app/tenant/subscriptions/page';

/** The URL each page asks for, exactly as it builds it. */
const ORDERS = '/api/tenant/orders';
const QUOTES = '/api/tenant/quotes';
const SUBS = '/api/tenant/subscriptions';
const CONTACTS = '/api/tenant/contacts';

const NOW = '2026-03-04T10:00:00.000Z';
const orderRows = {
  orders: [
    { id: 'o1', orderNumber: 'SO-3312', title: 'Forklift fleet', status: 'confirmed', orderDate: NOW, expectedDeliveryDate: null, totalAmount: '12500.00', contactId: 'ct1' },
    { id: 'o2', orderNumber: 'SO-3313', title: 'Pallet jacks', status: 'shipped', orderDate: NOW, expectedDeliveryDate: null, totalAmount: '2400.00', contactId: 'ct1' },
  ],
};
const quoteRows = {
  quotes: [
    { id: 'q1', quoteNumber: 'QT-1187', title: 'Warehouse rollout', status: 'sent', subtotal: '8000.00', totalAmount: '8000.00', contactId: 'ct1', expiresAt: null, createdAt: NOW },
  ],
};
const subRows = {
  data: [
    { id: 's1', name: 'Fleet telemetry', planName: 'Pro', status: 'active', startDate: NOW, currentPeriodEnd: null, amount: '129.00', billingFrequency: 'monthly', autoRenew: true },
  ],
};
const contactRows = { contacts: [{ id: 'ct1', firstName: 'Kestrel', lastName: 'Vane', email: 'kestrel@example.test' }] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state none of these three pages could reach before this slice. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
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

describe('orders: a refused refresh keeps the rows the operator just saved (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the rows and calls them the last read, with the reason', () => {
    registry.byUrl = { [ORDERS]: staleRead(orderRows), [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    expect(screen.getByText('SO-3312')).toBeTruthy();
    expect(screen.getByText(/Could not refresh the orders/)).toBeTruthy();
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence is gone: the list is not unread, the refresh was.
    expect(alerts()).not.toContain('Failed to load orders');
  });

  it('still counts the last read instead of printing — above the rows it is displaying', () => {
    registry.byUrl = { [ORDERS]: staleRead(orderRows), [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('$14900.00')).toBeTruthy();
  });

  it('binds the last-read banner to the orders query, so Try again re-runs the read that failed', () => {
    const result = staleRead(orderRows);
    registry.byUrl = { [ORDERS]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a list that never answered is still an outage: banner, reason, and the cards unavailable', () => {
    registry.byUrl = { [ORDERS]: failed('Request failed (500)'), [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    expect(screen.queryByText('SO-3312')).toBeNull();
    expect(alerts()).toContain('Failed to load orders');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [ORDERS]: ok({ orders: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    expect(screen.getByText('No orders found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('separates a filtered miss from an empty tenant, and keeps the count the read established', () => {
    registry.byUrl = { [ORDERS]: ok(orderRows), [CONTACTS]: ok(contactRows) };
    wrapped(<OrdersPage />);
    fireEvent.change(screen.getByPlaceholderText(/search orders/i), { target: { value: 'zzz-no-such-row' } });
    expect(screen.getByText(/No order matches this search — the read returned 2/)).toBeTruthy();
    expect(screen.queryByText('No orders found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats an unread contacts list as unread, not as orders that have no contact', () => {
    registry.byUrl = { [ORDERS]: ok(orderRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<OrdersPage />);
    expect(screen.getByText('SO-3312')).toBeTruthy();
    expect(alerts()).toContain('Failed to load contacts');
    expect(alerts()).toContain('not the same as these orders having no contact');
  });

  it('says the contacts are the last read when the refresh of a populated list fails', () => {
    registry.byUrl = { [ORDERS]: ok(orderRows), [CONTACTS]: staleRead(contactRows) };
    wrapped(<OrdersPage />);
    expect(within(screen.getByRole('table')).getAllByText('Kestrel Vane')).toHaveLength(2);
    expect(alerts()).toContain('working from the last read');
    expect(alerts()).not.toContain('Failed to load contacts');
  });

  it('does not offer an empty contact picker when the picker could not be read', () => {
    registry.byUrl = { [ORDERS]: ok(orderRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<OrdersPage />);
    fireEvent.click(screen.getByRole('button', { name: /create order/i }));
    expect(screen.getByText(/nobody to pick from/)).toBeTruthy();
    expect(screen.queryByText('Select contact...')).toBeNull();
  });

  it('keeps "no contacts saved yet" for the read that genuinely came back empty', () => {
    registry.byUrl = { [ORDERS]: ok(orderRows), [CONTACTS]: ok({ contacts: [] }) };
    wrapped(<OrdersPage />);
    fireEvent.click(screen.getByRole('button', { name: /create order/i }));
    expect(screen.getByText('Select contact...')).toBeTruthy();
    expect(screen.getByText(/No contacts saved yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('quotes: the four header cards stop reporting 0 for a list that was never read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('refuses to count an unread list — this is the guard #2829 left behind', () => {
    registry.byUrl = { [QUOTES]: failed('Request failed (500)'), [CONTACTS]: ok(contactRows) };
    wrapped(<QuotesPage />);
    // Before this slice the cards read `value: quotes.length` with no guard at all, so an
    // outage printed a firm 0 Total / 0 Accepted / 0 Pending / 0 Lost.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(alerts()).toContain('Failed to load quotes');
  });

  it('keeps the rows and names them the last read when a refresh fails', () => {
    const result = staleRead(quoteRows);
    registry.byUrl = { [QUOTES]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<QuotesPage />);
    expect(screen.getByText('QT-1187')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the quotes');
    expect(alerts()).toContain('Request failed (504)');
    // A stale read still counts: the rows are on screen.
    expect(screen.queryByText('—')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [QUOTES]: ok({ quotes: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<QuotesPage />);
    expect(screen.getByText('No quotes found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('separates a filtered miss from an empty tenant', () => {
    registry.byUrl = { [QUOTES]: ok(quoteRows), [CONTACTS]: ok(contactRows) };
    wrapped(<QuotesPage />);
    fireEvent.change(screen.getByPlaceholderText(/search quotes/i), { target: { value: 'zzz-no-such-row' } });
    expect(screen.getByText(/No quote matches this search — the read returned 1/)).toBeTruthy();
    expect(screen.queryByText('No quotes found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives the unread contacts list its own failure, instead of a Contact column of dashes', () => {
    registry.byUrl = { [QUOTES]: ok(quoteRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<QuotesPage />);
    expect(alerts()).toContain('Failed to load contacts');
    fireEvent.click(screen.getByRole('button', { name: /create quote/i }));
    expect(screen.getByText(/nobody to pick from/)).toBeTruthy();
    expect(screen.queryByText('Select contact...')).toBeNull();
  });
});

describe('subscriptions: a refused refresh does not delete an MRR the tenant still has (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the card and calls it the last read, and keeps MRR counting', () => {
    const result = staleRead(subRows);
    registry.byUrl = { [SUBS]: result };
    wrapped(<SubscriptionsPage />);
    expect(screen.getByText('Fleet telemetry')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the subscriptions');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText('—')).toBeNull();
    // The MRR card and the row's own price are the same number; both must be live.
    expect(screen.getAllByText('$129.00')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a list that never answered is still an outage, and the money is unavailable rather than zero', () => {
    registry.byUrl = { [SUBS]: failed('Request failed (500)') };
    wrapped(<SubscriptionsPage />);
    expect(screen.queryByText('Fleet telemetry')).toBeNull();
    expect(alerts()).toContain('Failed to load subscriptions');
    expect(alerts()).toContain('Request failed (500)');
    // Total, Active, MRR, ARR — no $0.00 standing in for a read that did not happen.
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [SUBS]: ok({ data: [] }) };
    wrapped(<SubscriptionsPage />);
    expect(screen.getByText('No subscriptions found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('separates a filtered miss from an empty tenant', () => {
    registry.byUrl = { [SUBS]: ok(subRows) };
    wrapped(<SubscriptionsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search subscriptions/i), { target: { value: 'zzz-no-such-row' } });
    expect(screen.getByText(/No subscription matches.*the read returned 1/)).toBeTruthy();
    expect(screen.queryByText('No subscriptions found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the failure once, not once per render, now that the state is sustained', () => {
    // #2829 made this state survive on screen with a working search box in front of it. The
    // toast used to fire from the render body, so every keystroke re-announced one error.
    registry.byUrl = { [SUBS]: staleRead(subRows) };
    const view = wrapped(<SubscriptionsPage />);
    view.rerender(tree(<SubscriptionsPage />));
    view.rerender(tree(<SubscriptionsPage />));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/orders/page.tsx',
    'app/tenant/quotes/page.tsx',
    'app/tenant/subscriptions/page.tsx',
  ];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} renders the miss and the absence as the same sentence`).toMatch(/length > 0 \?/);
    }
  });

  it('announces a failed read from an effect, not from the render body', () => {
    // The render-body toast was `subscriptions`' shape; a sustained stale state turned it into
    // a toast per keystroke. The two sibling pages already had theirs inside `useEffect`.
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} toasts during render`).not.toMatch(/^\s*if \(\w*[Ee]rror\)\s*toast\.error/m);
    }
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each
    // had to undo.
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never have been baselined — it was already visible to the guard`)
        .not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks whether the file binds an error and renders one failure affordance. All
    // three pages did that before this slice — which is why they were never on the baseline,
    // and why #2872 is a separate epic rather than another #2829 slice.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*stale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`)
        .not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
    }
  });

  it('is not something the counters could have caught either', async () => {
    // The specific blindness this slice exists for: `error ? '—' : n` is correct-looking code
    // that reports an unread list over a list the page is still showing. Stripping it back to
    // the bare flag leaves the guard, the file-size ratchet and every #2829 assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src.replace(/\bfailed \? '—'/g, "errorFlag ? '—'").replace(/const failed = [^\n]*\n/g, 'const errorFlag = Boolean(error);\n');
      expect(bare, `${f}: the dash guard changed spelling, update this check`).not.toBe(src);
      expect(inspect(f, bare).offends, `${f} would now be visible to the guard`).toBe(false);
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
