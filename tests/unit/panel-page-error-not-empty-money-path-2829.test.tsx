// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the money path. Eight pages: `invoices`, `quotes`, `orders`,
 * `contracts`, `subscriptions`, `tickets`, `offers`, `follow-ups`.
 *
 * These are the eight the baseline described the same way — "binds `error` and toasts it,
 * then prints the sentence anyway" — and that phrasing is the whole defect: a toast is gone
 * in four seconds and the sentence stays on screen as long as the page is open. So a failed
 * read of the invoice list leaves the tenant looking at "No invoices found" on the page that
 * bills them, and a failed read of `offers` prints, under its own unannounced red banner,
 * "No offers yet. Create a quote and send it to a buyer." — an instruction to duplicate a
 * quote that exists.
 *
 * Two of the eight are worth stating precisely, because the baseline note reads like a bug
 * report and is not one for them:
 *   - `follow-ups` and `offers` DID already suppress their absence copy on failure; both
 *     derive a truthy `error` and gate the sentence on `!error`. What they lacked was an
 *     affordance the guard (or a screen reader) recognises — a styled div, no `role="alert"`,
 *     no retry. Their fix is the banner becoming `InlineErrorState`, not the branch.
 *   - `tickets` made a second claim on failure: the "Want to automate support?" module upsell
 *     renders whenever the ticket list is empty, so a refused read pitched the WhatsApp
 *     integration as though no customer had ever written in. It is gated on the failure now,
 *     and there is a case for it, because that block is two `div`s away from the list and is
 *     exactly the kind of adjacent claim a slice that only edits the list branch leaves true.
 *
 * Per page, four cases: failed read → `role="alert"` naming the failure, a working "Try
 * again" bound to that query's `refetch`, and no absence copy; succeeded-and-empty → the
 * sentence and no alert; rows → the row and no alert.
 *
 * The half the guard cannot see is the stats row. `invoices`, `orders`, `contracts` and
 * `subscriptions` compute their header cards (`Outstanding`, `Revenue`, `Total Value`,
 * `MRR`/`ARR`) by reducing the same array the list renders, so a refused read reported the
 * tenant's money as zero *above* the banner saying the read failed — and an owner reads
 * "$0 outstanding" as "everyone paid". Those cards now render `—` for an unread list and the
 * real total, or a true `$0.00`, for a successful one; the case asserts both, because
 * suppressing the zero as well would lose a fact the endpoint actually answered.
 *
 * Plus the opposite failure mode. Six of these pages filter client-side (`search` narrows
 * `filtered`), so routing every empty branch to the banner would turn "nothing MATCHES your
 * search" into a fake outage — the assertion is that a search miss stays the sentence.
 * `tickets` is deliberately not in that case: its search goes to the server through the
 * query string, so typing changes the URL rather than emptying an array.
 *
 * Not in this slice: `contacts` reads on four of these pages. Those already fail loudly
 * enough to name (they toast) and their dropdown has no absence sentence to lie with, so
 * they stay a short option list — a known remaining shape, not an oversight here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
}));

import InvoicesPage from '@/app/tenant/invoices/page';
import QuotesPage from '@/app/tenant/quotes/page';
import OrdersPage from '@/app/tenant/orders/page';
import ContractsPage from '@/app/tenant/contracts/page';
import SubscriptionsPage from '@/app/tenant/subscriptions/page';
import TicketsPage from '@/app/tenant/tickets/page';
import OffersPage from '@/app/tenant/offers/page';
import FollowUpsPage from '@/app/tenant/follow-ups/page';

/** The URL each page asks for, exactly as it builds it. A drift here is the test failing for
 *  the right reason: the page started asking for something else. */
const URLS = {
  invoices: '/api/tenant/invoices',
  quotes: '/api/tenant/quotes',
  orders: '/api/tenant/orders',
  contracts: '/api/tenant/contracts',
  subscriptions: '/api/tenant/subscriptions',
  tickets: '/api/tenant/tickets?limit=50&offset=0',
  offers: '/api/tenant/offers?page=1&pageSize=25',
  followUps: '/api/tenant/follow-ups?limit=20&offset=0',
} as const;

const NOW = new Date().toISOString();

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
});

const CASES: {
  name: string;
  url: keyof typeof URLS;
  page: () => ReactNode;
  /** what the page says when a successful read returned nothing */
  emptyCopy: RegExp;
  /** #2872: what it says when the read returned rows and the search dropped them. Pages that
   *  separate the two carry this; the rest still answer a miss with `emptyCopy`. */
  missCopy?: RegExp;
  /** the envelope key the page reads its list out of */
  key: 'data' | 'quotes' | 'orders' | 'contracts' | 'offers';
  /** does the page filter client-side, so a search miss has to stay the honest sentence? */
  searchable: boolean;
  row: Record<string, unknown>;
  rowCopy: RegExp;
}[] = [
  {
    name: 'Invoices',
    url: 'invoices',
    page: () => <InvoicesPage />,
    emptyCopy: /No invoices found/,
    missCopy: /No invoice matches this search/,
    key: 'data',
    searchable: true,
    row: { id: 'inv1', invoiceNumber: 'INV-2041', title: 'Northwind retainer', status: 'sent', issueDate: NOW, dueDate: NOW, totalAmount: '4200.00', balanceDue: '4200.00', contactId: 'ct1' },
    rowCopy: /INV-2041/,
  },
  {
    name: 'Quotes',
    url: 'quotes',
    page: () => <QuotesPage />,
    emptyCopy: /No quotes found/,
    key: 'quotes',
    searchable: true,
    row: { id: 'q1', quoteNumber: 'QT-1187', title: 'Warehouse rollout', status: 'sent', subtotal: '8000.00', totalAmount: '8000.00', contactId: 'ct1', expiresAt: null, createdAt: NOW },
    rowCopy: /Warehouse rollout/,
  },
  {
    name: 'Orders',
    url: 'orders',
    page: () => <OrdersPage />,
    emptyCopy: /No orders found/,
    key: 'orders',
    searchable: true,
    row: { id: 'o1', orderNumber: 'SO-3312', title: 'Forklift fleet', status: 'confirmed', orderDate: NOW, expectedDeliveryDate: null, totalAmount: '12500.00', contactId: 'ct1' },
    rowCopy: /SO-3312/,
  },
  {
    name: 'Contracts',
    url: 'contracts',
    page: () => <ContractsPage />,
    emptyCopy: /No contracts found/,
    missCopy: /No contract matches this search/,
    key: 'contracts',
    searchable: true,
    row: { id: 'c1', title: 'Master services agreement', contractNumber: 'MSA-12', contractType: 'msa', status: 'active', startDate: NOW, endDate: null, totalValue: '60000.00', contactId: 'ct1' },
    rowCopy: /Master services agreement/,
  },
  {
    name: 'Subscriptions',
    url: 'subscriptions',
    page: () => <SubscriptionsPage />,
    emptyCopy: /No subscriptions found/,
    key: 'data',
    searchable: true,
    row: { id: 's1', name: 'Fleet telemetry', planName: 'Pro', status: 'active', startDate: NOW, currentPeriodEnd: null, amount: '129.00', billingFrequency: 'monthly', autoRenew: true },
    rowCopy: /Fleet telemetry/,
  },
  {
    name: 'Tickets',
    url: 'tickets',
    page: () => <TicketsPage />,
    emptyCopy: /No tickets found/,
    key: 'data',
    // tickets searches server-side: `search` goes into the query string, so typing changes
    // the URL instead of emptying an array. The search-miss case would test the mock, not the
    // page.
    searchable: false,
    row: { id: 't1', subject: 'Scanner pairs then drops', body: 'Reproducible on dock 3.', status: 'open', priority: 'high', category: 'hardware', created_at: NOW, first_name: 'Kestrel', last_name: 'Vane', assigned_name: null },
    rowCopy: /Scanner pairs then drops/,
  },
  {
    name: 'Offers',
    url: 'offers',
    page: () => <OffersPage />,
    emptyCopy: /No offers yet/,
    key: 'offers',
    searchable: true,
    row: { id: 'of1', quote_number: 'OF-77', title: 'Pilot — three depots', status: 'sent', total_amount: '9800.00', expires_at: null, sent_at: NOW, accepted_at: null, declined_at: null, contact_id: 'ct1', contact_name: 'Kestrel Vane', contact_email: null, created_at: NOW, public_token: null, sent_to_email: null, viewed_count: 2 },
    rowCopy: /Pilot — three depots/,
  },
  {
    name: 'Follow-ups',
    url: 'followUps',
    page: () => <FollowUpsPage />,
    emptyCopy: /No follow-ups found/,
    key: 'data',
    searchable: false,
    row: { id: 'f1', title: 'Call the depot manager', description: null, dueDate: NOW, status: 'pending', missedDays: null, autoAiEnabled: null, completedAt: null, contactName: 'Kestrel Vane', leadName: null, assigneeName: null },
    rowCopy: /Call the depot manager/,
  },
];

/** `{ data: [...] }`, `{ quotes: [...] }`, `{ offers: [...], pagination }`, `{ data, total }`. */
function payload(key: typeof CASES[number]['key'], rows: unknown[] | null) {
  const list = rows ?? [];
  if (key === 'offers') return { offers: list, pagination: { page: 1, pageSize: 25, total: list.length, pageCount: 1 } };
  if (key === 'data') return { data: list, total: list.length };
  return { [key]: list };
}

describe.each(CASES)('$name panel renders the failure instead of the absence (#2829)', ({ url, page, emptyCopy, missCopy, row, rowCopy, key, searchable }) => {
  it('says the read failed, with the reason, when the fetch errors', () => {
    registry.byUrl[URLS[url]] = failed('Request failed (500)');
    mount(page());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });

  it('binds "Try again" to the query that failed, so the banner is actionable', () => {
    const result = failed('Request failed (503)');
    registry.byUrl[URLS[url]] = result;
    mount(page());
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the sentence when the read succeeded and there are none', () => {
    registry.byUrl[URLS[url]] = ok(payload(key, null));
    mount(page());
    expect(screen.getByText(emptyCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the rows a successful read returns', () => {
    registry.byUrl[URLS[url]] = ok(payload(key, [row]));
    mount(page());
    expect(screen.getByText(rowCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });

  if (searchable) {
    it('keeps a search miss an honest sentence, not a fake outage (#2829)', () => {
      registry.byUrl[URLS[url]] = ok(payload(key, [row]));
      mount(page());
      const box = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
      fireEvent.change(box, { target: { value: 'zzz-no-such-row' } });
      expect(screen.queryByRole('alert')).toBeNull();
      if (missCopy) {
        // #2872: the read answered with rows, so "there are none" invents a tenant. The miss
        // gets its own sentence and keeps the count the read established.
        expect(screen.getByText(missCopy)).toBeTruthy();
        expect(screen.queryByText(emptyCopy)).toBeNull();
      } else {
        expect(screen.getByText(emptyCopy)).toBeTruthy();
      }
    });
  }
});

describe('the tickets upsell is not a diagnosis of the tenant’s inbox (#2829)', () => {
  // The "Want to automate support?" block sits under the list and renders whenever the list is
  // empty. A refused read used to leave it pitching integrations to a tenant whose tickets were
  // simply unread.
  it('stays out of the way when the read failed', () => {
    registry.byUrl[URLS.tickets] = failed('Request failed (500)');
    mount(<TicketsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load tickets');
    expect(screen.queryByText(/Want to automate support\?/)).toBeNull();
  });

  it('still appears when a successful read really has no tickets', () => {
    registry.byUrl[URLS.tickets] = ok(payload('data', null));
    mount(<TicketsPage />);
    expect(screen.getByText(/Want to automate support\?/)).toBeTruthy();
  });
});

describe('the stats row is not a financial statement about unread data (#2829)', () => {
  // Four of these pages compute their header cards from the same array the list renders.
  // Fixing only the list sentence would have left the page reporting the tenant's money as
  // zero above a banner saying the read failed — the more damaging half of the same lie,
  // because an owner reads "$0 outstanding" as "everyone paid" and moves on.
  const money: {
    name: string;
    url: keyof typeof URLS;
    page: () => ReactNode;
    key: typeof CASES[number]['key'];
    label: string;
    row: Record<string, unknown>;
    /** what the card says when the read succeeded and the money really is zero */
    sum: string;
    /** what the card says when the read succeeded and there are rows */
    trueSum: string;
  }[] = [
    { name: 'Invoices', url: 'invoices', page: () => <InvoicesPage />, key: 'data', label: 'Outstanding', row: CASES[0].row, sum: '$0.00', trueSum: '$4200.00' },
    { name: 'Orders', url: 'orders', page: () => <OrdersPage />, key: 'orders', label: 'Revenue', row: CASES[2].row, sum: '$0.00', trueSum: '$12500.00' },
    { name: 'Contracts', url: 'contracts', page: () => <ContractsPage />, key: 'contracts', label: 'Total Value', row: CASES[3].row, sum: '$0.00', trueSum: '$60000.00' },
    { name: 'Subscriptions', url: 'subscriptions', page: () => <SubscriptionsPage />, key: 'data', label: 'MRR', row: CASES[4].row, sum: '$0.00', trueSum: '$129.00' },
  ];

  const cardFor = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

  describe.each(money)('$name stats row', ({ url, page, key, label, row, sum, trueSum }) => {
    it('refuses to report zero when the read failed', () => {
      registry.byUrl[URLS[url]] = failed('Request failed (500)');
      mount(page());
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(cardFor(label)).toContain('—');
      expect(screen.queryByText('$0.00')).toBeNull();
    });

    it('reports the real total when the read succeeded', () => {
      registry.byUrl[URLS[url]] = ok(payload(key, [row]));
      mount(page());
      expect(cardFor(label)).toContain(trueSum);
    });

    it('still reports a true zero when the read succeeded and there is nothing', () => {
      registry.byUrl[URLS[url]] = ok(payload(key, null));
      mount(page());
      expect(cardFor(label)).toContain(sum);
    });
  });
});

describe('the ratchet decays by exactly the pages this slice fixed (#2829)', () => {
  const ROOT = process.cwd();
  const SCRIPT = 'scripts/check-panel-error-state.mjs';
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const FIXED = [
    'app/tenant/invoices/page.tsx',
    'app/tenant/quotes/page.tsx',
    'app/tenant/orders/page.tsx',
    'app/tenant/contracts/page.tsx',
    'app/tenant/subscriptions/page.tsx',
    'app/tenant/tickets/page.tsx',
    'app/tenant/offers/page.tsx',
    'app/tenant/follow-ups/page.tsx',
  ];

  const files = () => (JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    files: Record<string, string>;
  }).files;

  it('is green, and none of the eight still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    // A stale allowlist is the guard's only signal that a panel was honestly fixed.
    expect(res.stderr).not.toContain('no longer offends');
    for (const file of FIXED) {
      expect(files()[file], `${file} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
  });

  it('cannot be satisfied by an empty list, and pins no page by name', () => {
    const f = files();
    // A ceiling, never an equality: an exact count goes false the moment another slice
    // honestly fixes a panel, which is the landmine the first slice of this issue shipped.
    expect(Object.keys(f).length).toBeLessThanOrEqual(46);
    // The three names this case used to assert — `superadmin/modules`, then `visitors`,
    // then `pipelines` — were each deleted by the slice that fixed them, which is the
    // outcome the issue asks for. Naming a page owed was therefore a bet against every
    // other slice on the board, and it lost four times.
    // What actually stops a sweep from deleting the list to make this green is the guard
    // run above: a page dropped while it still prints an empty sentence over a failed
    // read is a NOVEL offender, and that is the failure the guard is built to report.
    for (const [file, note] of Object.entries(f)) {
      expect(note, `${file} is allowlisted with no reason attached`).toContain('#2829');
    }
  });

  it('does not push a fixed page over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
