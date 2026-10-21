// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two document records on the money path: `app/tenant/orders/[id]/page.tsx` and
 * `app/tenant/quotes/[id]/page.tsx`. Both read one record through `useApiQuery`
 * (`lib/query/client.tsx`: `staleTime: 30_000`, `retry: 2`, `refetchOnWindowFocus: false`), so a
 * revalidation of a read that already answered leaves `data` in place while `error` is set — and
 * both pages looked only at the flag.
 *
 * The census calls this the toast-only shape. It is worse than that on a `[id]` page, because the
 * page also has a sentence for a record that is not there: `useEffect(() => { if (error)
 * toast.error('Failed to load order'); }, [error])` faded after four seconds and execution fell
 * into `if (!order)`, whose durable state was **"Order not found"** above a Package icon and a
 * link back to the list. So a gateway 502 during a revalidation told the operator the order they
 * were looking at had ceased to exist, and the same page did it again for the quote. Both now
 * reach the record through `if (failed && !notFound)`.
 *
 * The refused refresh is not hypothetical weather: it is the operator's own hand. On the order
 * page `saveMutation.onSuccess` and `statusMutation.onSuccess` (every Move to…, and Cancel Order)
 * both call `invalidate()` → `invalidateQueries({ queryKey: ORDER_QUERY(id) })` — the exact key
 * the page reads. The quote page has four such writes: the same two, plus the Send-via-Email
 * dialog's `onConfirm`, which posts to `/api/tenant/offers/${id}/send` and then invalidates
 * `QUOTE_QUERY(id)`. Neither page has a Refresh button, and `id` comes from the URL, so nothing
 * else ever changes the key: right after marking an order shipped the screen was the shipped
 * order, the flag, a toast and — one render later — nothing claiming any of it.
 *
 * `id` is also why the outage branch here is `failed && !notFound`. `app/api/tenant/orders/[id]`
 * and `app/api/tenant/quotes/[id]` return 404 `{ error: 'Not found' }` only when no live row
 * matches this id **and this tenant** (`deletedAt IS NULL`), and a permission or module refusal is
 * a 403. A 404 is therefore the server answering the question that was asked about the record, so
 * it keeps "Order not found" / "Quote not found" with no alert, while a 5xx, a 403 or a refusal
 * with no message at all becomes the outage card. An answered-but-empty 2xx body stays a third
 * state, and a refused refresh on top of it says "not found" *and* the caveat.
 *
 * Status, money, terms and tracking are fields of the same response — neither page has a second
 * read (`useApiQuery<` appears once in each), so there is no sibling query to retry by accident,
 * and one refusal stales the entire document. Neither page derives a count off an array it throws
 * away either, so the figure at risk is not a `0` but the total: the outage screen therefore
 * prints no money at all rather than `$0.00`.
 *
 * Neither page ever navigated on the flag — `router.push` appears once in each, in
 * `deleteMutation.onSuccess`, which leaves a record that genuinely no longer exists. Pinned
 * anyway, because the helpdesk detail page in the same class did exactly that (#2929).
 *
 * RED AT BASE. Against the two pages as they are on `origin/main`, measured by rewinding them and
 * running this file: 19 failed | 17 passed (36). The seventeen that pass at base are the controls:
 * five per page — the record that stays actionable, the totals the cached read still prints, the
 * honest 404, the answered-but-empty 2xx and the clean success render — plus seven ratchet pins
 * that only read the source or run the guards (both navigation counts, the single-read pin, the
 * mutation toasts, the empty baseline, #2829's silence and the line ceiling). Not one stale-state
 * or outage case passes at base: the flag had no channel but a fading toast, and every one of them
 * fell into "not found". They must keep passing.
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
const pushSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
// The pages still toast for their writes; an error STATE must not be satisfiable from there, so
// every assertion below reads role="alert" inside the panel instead.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc-7' }),
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/orders',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ui/prompt-dialog', () => ({
  PromptDialog: () => null,
}));

import toast from 'react-hot-toast';
import OrderDetailPage from '@/app/tenant/orders/[id]/page';
import QuoteDetailPage from '@/app/tenant/quotes/[id]/page';

const ORDER = '/api/tenant/orders/doc-7';
const QUOTE = '/api/tenant/quotes/doc-7';

const orderRecord = {
  id: 'doc-7', orderNumber: 'ORD-1042', title: 'Pallet scanner replenishment',
  status: 'processing', orderDate: '2026-09-20T00:00:00Z',
  expectedDeliveryDate: '2026-10-15T00:00:00Z', shippedAt: null, deliveredAt: null, cancelledAt: null,
  subtotal: '4200.00', discountAmount: '200.00', taxAmount: '340.00', shippingAmount: '50.00',
  totalAmount: '4390.00', shippingAddress: 'Dock 3, Northgate', shippingCity: 'Rotterdam',
  shippingState: 'ZH', shippingCountry: 'NL', shippingPostalCode: '3011',
  trackingNumber: 'TRK-8812', shippingCarrier: 'Blisters & Co', notes: 'Hold for the second pallet.',
  customerNotes: 'Deliver before 10:00.', contactId: 'ct-1', companyId: null,
  createdAt: '2026-09-20T00:00:00Z', updatedAt: null,
};

const quoteRecord = {
  id: 'doc-7', title: 'Dock scanner rollout', quoteNumber: 'Q-2041', status: 'sent',
  subtotal: '18000.00', discount: '500.00', tax: '1400.00', totalAmount: '18900.00',
  expiresAt: '2026-11-01T00:00:00Z', notes: 'Includes two spare cradles.',
  terms: 'Net 30 from acceptance.', contactId: 'ct-1', dealId: 'dl-1',
  sentAt: '2026-10-02T00:00:00Z', acceptedAt: null, declinedAt: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null,
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could tell apart before this slice: cached record, refused refresh. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** What the route actually answers for an id that matches no live row of this tenant. */
const refused404 = (): QueryResult => ({
  data: undefined,
  error: Object.assign(new Error('Request failed (404)'), { status: 404 }),
  isLoading: false,
  refetch: vi.fn(),
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

/** `<span>Total</span>` beside `<span>$4390.00</span>`: read the money out of the row that owns
 *  it instead of matching a `$` figure somewhere else on the document. */
const moneyRow = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

beforeEach(() => {
  registry.byUrl = {};
  pushSpy.mockClear();
  vi.clearAllMocks();
  // The actionable-record cases really click a write; nothing may leave the process.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 599, json: async () => ({ error: 'unreachable in tests' }),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('order record: a refused refresh does not delete the order on screen (#2872)', () => {
  const CAVEAT = /this order is the last read/;
  const OUTAGE = /Failed to load order/;

  it('keeps the order, its status trail and its money, and calls them the last read', () => {
    const result = staleRead({ data: orderRecord });
    registry.byUrl = { [ORDER]: result };
    wrapped(<OrderDetailPage />);
    expect(screen.getByText('Order #ORD-1042')).toBeTruthy();
    expect(screen.getByText('Pallet scanner replenishment')).toBeTruthy();
    expect(screen.getByText('TRK-8812')).toBeTruthy();
    expect(alerts()).toContain('this order is the last read');
    expect(alerts()).toContain('The edit you just saved or the status you just moved may not be reflected here');
    expect(alerts()).toContain('Request failed (504)');
    // The record is on the screen, so "not found" — the state this page used to reach for any
    // error — is unreachable.
    expect(screen.queryByText('Order not found')).toBeNull();
    expect(alerts()).not.toMatch(OUTAGE);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('retries this record and not the list the back link points at', () => {
    const here = staleRead({ data: orderRecord });
    const list = ok({ data: [orderRecord] });
    registry.byUrl = { [ORDER]: here, '/api/tenant/orders': list };
    wrapped(<OrderDetailPage />);
    expect(alerts()).toMatch(CAVEAT);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(here.refetch).toHaveBeenCalledTimes(1);
    expect(list.refetch).not.toHaveBeenCalled();
  });

  it('the kept order is still actionable', () => {
    registry.byUrl = { [ORDER]: staleRead({ data: orderRecord }) };
    wrapped(<OrderDetailPage />);
    // Status moves are writes addressed by id, so the operator may keep working the record —
    // the caveat tells them what the screen may not show, it does not freeze the document.
    const move = screen.getByRole('button', { name: /move to shipped/i });
    expect(move.disabled).toBe(false);
    fireEvent.click(move);
    expect(pushSpy).not.toHaveBeenCalledWith('/tenant/orders');
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeTruthy();
  });

  it('its totals still print the numbers the last read carried', () => {
    registry.byUrl = { [ORDER]: staleRead({ data: orderRecord }) };
    wrapped(<OrderDetailPage />);
    expect(moneyRow('Subtotal')).toContain('$4200.00');
    expect(moneyRow('Total')).toContain('$4390.00');
    expect(screen.queryByText('—')).toBeNull();
  });

  it('an order that never answered is an outage, and no write is offered against its id', () => {
    registry.byUrl = { [ORDER]: failed('Request failed (500)') };
    wrapped(<OrderDetailPage />);
    expect(alerts()).toContain('Failed to load order: Request failed (500)');
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('Order not found')).toBeNull();
    expect(screen.queryByText('Order #ORD-1042')).toBeNull();
    expect(screen.queryByText('TRK-8812')).toBeNull();
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /move to shipped/i })).toBeNull();
    // Money the page never read may not appear as a zero either.
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(pushSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ORDER].refetch).toHaveBeenCalledTimes(1);
  });

  it('the outage is a banner, not a toast that fades while "not found" stays', async () => {
    registry.byUrl = { [ORDER]: failed('Request failed (500)') };
    wrapped(<OrderDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(OUTAGE), { interval: 10 });
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load order');
    expect(screen.queryByText('Order not found')).toBeNull();
  });

  it('a 404 for this id is the server answering: not found, with no alert', () => {
    registry.byUrl = { [ORDER]: refused404() };
    wrapped(<OrderDetailPage />);
    expect(screen.getByText('Order not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(document.body.textContent).not.toMatch(/Failed to load order/);
    expect(document.body.textContent).not.toMatch(/last read/);
  });

  it('a 403 refusal is an outage, not a claim that the order is gone', () => {
    registry.byUrl = { [ORDER]: failed('Request failed (403)') };
    wrapped(<OrderDetailPage />);
    expect(alerts()).toContain('Failed to load order: Request failed (403)');
    expect(screen.queryByText('Order not found')).toBeNull();
  });

  it('says "not found" with no alert when the read answered with an empty body', () => {
    registry.byUrl = { [ORDER]: ok({ data: null }) };
    wrapped(<OrderDetailPage />);
    expect(screen.getByText('Order not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [ORDER]: staleRead({ data: null }) };
    wrapped(<OrderDetailPage />);
    expect(screen.getByText('Order not found')).toBeTruthy();
    expect(alerts()).toMatch(/this page is the last read/);
    expect(alerts()).toContain('may have been deleted since it last answered');
    expect(alerts()).not.toMatch(OUTAGE);
  });

  it('a refusal that arrives without a message still names the server', () => {
    registry.byUrl = { [ORDER]: staleRead({ data: orderRecord }, '') };
    wrapped(<OrderDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Order #ORD-1042')).toBeTruthy();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [ORDER]: ok({ data: orderRecord }) };
    wrapped(<OrderDetailPage />);
    expect(screen.getByText('Order #ORD-1042')).toBeTruthy();
    expect(moneyRow('Total')).toContain('$4390.00');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('walks the path the operator walks: read, ship it, the revalidation is refused', async () => {
    registry.byUrl = { [ORDER]: ok({ data: orderRecord }) };
    const view = wrapped(<OrderDetailPage />);
    expect(screen.queryByRole('alert')).toBeNull();

    // statusMutation.onSuccess invalidates ORDER_QUERY(id); the retry is refused, `data` stays.
    registry.byUrl = { [ORDER]: staleRead({ data: { ...orderRecord, status: 'shipped' } }) };
    view.rerender(tree(<OrderDetailPage />));
    await waitFor(() => expect(alerts()).toMatch(CAVEAT), { interval: 10 });
    expect(screen.getByText('Order #ORD-1042')).toBeTruthy();
    expect(alerts()).not.toMatch(OUTAGE);

    registry.byUrl = { [ORDER]: ok({ data: { ...orderRecord, status: 'shipped' } }) };
    view.rerender(tree(<OrderDetailPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('quote record: a refused refresh does not unmake the quote it just sent (#2872)', () => {
  const CAVEAT = /this quote is the last read/;
  const OUTAGE = /Failed to load quote/;

  it('keeps the quote, its terms and its action row, and calls them the last read', () => {
    const result = staleRead({ data: quoteRecord });
    registry.byUrl = { [QUOTE]: result };
    wrapped(<QuoteDetailPage />);
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
    expect(screen.getByText('#Q-2041')).toBeTruthy();
    expect(screen.getByText('Net 30 from acceptance.')).toBeTruthy();
    expect(alerts()).toContain('this quote is the last read');
    expect(alerts()).toContain('the email you just sent may not be reflected here');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText('Quote not found')).toBeNull();
    expect(alerts()).not.toMatch(OUTAGE);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('retries this quote and not the list the back link points at', () => {
    const here = staleRead({ data: quoteRecord });
    const list = ok({ data: [quoteRecord] });
    registry.byUrl = { [QUOTE]: here, '/api/tenant/quotes': list };
    wrapped(<QuoteDetailPage />);
    expect(alerts()).toMatch(CAVEAT);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(here.refetch).toHaveBeenCalledTimes(1);
    expect(list.refetch).not.toHaveBeenCalled();
  });

  it('the kept quote is still actionable', () => {
    registry.byUrl = { [QUOTE]: staleRead({ data: quoteRecord }) };
    wrapped(<QuoteDetailPage />);
    // Send / Accept / Decline / the email dialog all invalidate this same key, so they are the
    // very actions whose revalidation was refused — and they stay usable against the quote's id.
    const accept = screen.getByRole('button', { name: /^accept$/i });
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    expect(pushSpy).not.toHaveBeenCalledWith('/tenant/quotes');
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /send via email/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeTruthy();
  });

  it('its totals still print the numbers the last read carried', () => {
    registry.byUrl = { [QUOTE]: staleRead({ data: quoteRecord }) };
    wrapped(<QuoteDetailPage />);
    expect(moneyRow('Subtotal')).toContain('$18000.00');
    expect(moneyRow('Total')).toContain('$18900.00');
    expect(screen.queryByText('—')).toBeNull();
  });

  it('a quote that never answered is an outage, and no write is offered against its id', () => {
    registry.byUrl = { [QUOTE]: failed('Request failed (500)') };
    wrapped(<QuoteDetailPage />);
    expect(alerts()).toContain('Failed to load quote: Request failed (500)');
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('Quote not found')).toBeNull();
    expect(screen.queryByText('Dock scanner rollout')).toBeNull();
    expect(screen.queryByRole('button', { name: /^accept$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /send via email/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(pushSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[QUOTE].refetch).toHaveBeenCalledTimes(1);
  });

  it('the outage is a banner, not a toast that fades while "not found" stays', async () => {
    registry.byUrl = { [QUOTE]: failed('Request failed (500)') };
    wrapped(<QuoteDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(OUTAGE), { interval: 10 });
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load quote');
    expect(screen.queryByText('Quote not found')).toBeNull();
  });

  it('a 404 for this id is the server answering: not found, with no alert', () => {
    registry.byUrl = { [QUOTE]: refused404() };
    wrapped(<QuoteDetailPage />);
    expect(screen.getByText('Quote not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(document.body.textContent).not.toMatch(/Failed to load quote/);
    expect(document.body.textContent).not.toMatch(/last read/);
  });

  it('a 403 refusal is an outage, not a claim that the quote is gone', () => {
    registry.byUrl = { [QUOTE]: failed('Request failed (403)') };
    wrapped(<QuoteDetailPage />);
    expect(alerts()).toContain('Failed to load quote: Request failed (403)');
    expect(screen.queryByText('Quote not found')).toBeNull();
  });

  it('says "not found" with no alert when the read answered with an empty body', () => {
    registry.byUrl = { [QUOTE]: ok({ data: null }) };
    wrapped(<QuoteDetailPage />);
    expect(screen.getByText('Quote not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [QUOTE]: staleRead({ data: null }) };
    wrapped(<QuoteDetailPage />);
    expect(screen.getByText('Quote not found')).toBeTruthy();
    expect(alerts()).toMatch(/this page is the last read/);
    expect(alerts()).toContain('may have been deleted since it last answered');
    expect(alerts()).not.toMatch(OUTAGE);
  });

  it('a refusal that arrives without a message still names the server', () => {
    registry.byUrl = { [QUOTE]: staleRead({ data: quoteRecord }, '') };
    wrapped(<QuoteDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [QUOTE]: ok({ data: quoteRecord }) };
    wrapped(<QuoteDetailPage />);
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
    expect(moneyRow('Total')).toContain('$18900.00');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('walks the path the operator walks: read, send it, the revalidation is refused', async () => {
    registry.byUrl = { [QUOTE]: ok({ data: quoteRecord }) };
    const view = wrapped(<QuoteDetailPage />);
    expect(screen.queryByRole('alert')).toBeNull();

    // The email dialog's onConfirm posts, toasts and invalidates QUOTE_QUERY(id) — the flag lands
    // one tick after the action, which is why this waits rather than asserting inline.
    registry.byUrl = { [QUOTE]: staleRead({ data: { ...quoteRecord, status: 'viewed' } }) };
    view.rerender(tree(<QuoteDetailPage />));
    await waitFor(() => expect(alerts()).toMatch(CAVEAT), { interval: 10 });
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
    expect(alerts()).not.toMatch(OUTAGE);

    registry.byUrl = { [QUOTE]: ok({ data: { ...quoteRecord, status: 'viewed' } }) };
    view.rerender(tree(<QuoteDetailPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const ORDER_FILE = 'app/tenant/orders/[id]/page.tsx';
  const QUOTE_FILE = 'app/tenant/quotes/[id]/page.tsx';

  it('separates the outage, the 404 and the stale read on both records', () => {
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never splits the outage from the refused refresh`)
        .toMatch(/const failed = Boolean\(error\) && !data;/);
      expect(src, `${f} keeps the record without saying it is the last read`)
        .toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
      expect(src, `${f} prints a raw error that can be undefined`)
        .toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
      // The record's own id is in the key, so a 404 is an answer about the record, not an outage.
      expect(src, `${f} folds "does not exist" into "could not load"`)
        .toMatch(/const notFound = failed && error\?\.status === 404;/);
      expect(src, `${f} still routes any error at the not-found sentence`)
        .toMatch(/if \(failed && !notFound\) \{/);
      expect(src).toMatch(/\{stale && \(/);
      expect(src).toMatch(/InlineErrorState/);
    }
  });

  it('retires the effect toast that carried the read failure on both records', () => {
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts during render`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still routes a page state through an effect toast`)
        .not.toMatch(/useEffect\(\(\) => \{\s*if \(\w*[Ee]rror\) toast\.error/);
      // Nothing on either page needs an effect now the read state lives in the banner.
      expect(src, `${f} keeps an effect for the read state`).not.toMatch(/\buseEffect\b/);
    }
  });

  it('never navigates away from the record on the flag', () => {
    const PAGES: [string, string, string][] = [
      [ORDER_FILE, 'orders', 'Order deleted'],
      [QUOTE_FILE, 'quotes', 'Quote deleted'],
    ];
    for (const [f, list, deletedToast] of PAGES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} pushes to the list when the flag is set`)
        .not.toMatch(/if \(error\)[\s\S]{0,120}router\.push/);
      expect(src, `${f} pushes the operator off the record on a failed read`)
        .not.toMatch(/failed[\s\S]{0,120}router\.push/);
      // The only way back to the list is a delete that succeeded — which leaves a record that
      // genuinely no longer exists.
      expect(src.match(new RegExp(`router\\.push\\('/tenant/${list}'\\)`, 'g'))).toHaveLength(1);
      expect(src, `${f} returns to the list somewhere other than a completed delete`)
        .toMatch(new RegExp(`toast\\.success\\('${deletedToast}'\\);\\s*router\\.push\\('/tenant/${list}'\\)`));
    }
  });

  it('leaves the quote page’s one other navigation where it belongs', () => {
    // Converting an accepted quote to an invoice goes to the invoice it just created, on the
    // success path of that POST — never off a read flag.
    const src = readFileSync(join(ROOT, QUOTE_FILE), 'utf8');
    expect(src.match(/router\.push/g)).toHaveLength(2);
    expect(src).toMatch(/if \(res\.ok\) \{[\s\S]{0,160}router\.push\(`\/tenant\/invoices/);
  });

  it('leaves each page with one read, so its caveat has no sibling to mis-wire', () => {
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src.match(/useApiQuery</g), `${f} grew a second read`).toHaveLength(1);
    }
    const orderSrc = readFileSync(join(ROOT, ORDER_FILE), 'utf8');
    expect(orderSrc).toMatch(/invalidateQueries\(\{ queryKey: ORDER_QUERY\(id\) \}\)/);
    expect(orderSrc.match(/invalidate\(\);/g)).toHaveLength(2);
    const quoteSrc = readFileSync(join(ROOT, QUOTE_FILE), 'utf8');
    expect(quoteSrc).toMatch(/invalidateQueries\(\{ queryKey: QUOTE_QUERY\(id\) \}\)/);
    // save, status move, and the Send-via-Email dialog.
    expect(quoteSrc.match(/invalidate\(\);/g)).toHaveLength(3);
  });

  it('keeps the mutation toasts the actions still need', () => {
    expect(readFileSync(join(ROOT, ORDER_FILE), 'utf8')).toMatch(/onError: \(\) => toast\.error\('Failed to update order'\)/);
    expect(readFileSync(join(ROOT, ORDER_FILE), 'utf8')).toMatch(/onError: \(\) => toast\.error\('Failed to change status'\)/);
    expect(readFileSync(join(ROOT, QUOTE_FILE), 'utf8')).toMatch(/onError: \(\) => toast\.error\('Failed to update quote'\)/);
    expect(readFileSync(join(ROOT, QUOTE_FILE), 'utf8')).toMatch(/onError: \(\) => toast\.error\('Failed to change status'\)/);
  });

  it('keeps #2829’s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never a count — three other slices are landing on this branch simultaneously.
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      expect(files, `${f} should never have been baselined`).not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks whether a file binds `error` and renders one failure affordance. Both
    // records did that at base — the pages toast for the flag, and the "not found" sentence is
    // not in its EMPTY_SENTENCE vocabulary — so it calls them clean today and called them clean
    // with the split rewound. These render tests are the only thing standing in its place.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const rewind = src
        .replace('const failed = Boolean(error) && !data;', 'const failed = Boolean(error);')
        .replace(/\n\s*\{stale && \([\s\S]*?\n\s*\)\}\n/g, '\n');
      expect(rewind, `${f}: the split changed shape, update this check`).not.toBe(src);
      expect(inspect(f, src).offends, `${f} was already visible to the guard`).toBe(false);
      expect(inspect(f, rewind).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('does not teach the #2829 money-path suite to speak about a kept read', () => {
    const prior = readFileSync(
      join(ROOT, 'tests/unit/panel-page-error-not-empty-money-path-2829.test.tsx'), 'utf8',
    );
    expect(prior).not.toMatch(/last read/);
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [ORDER_FILE, QUOTE_FILE]) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
