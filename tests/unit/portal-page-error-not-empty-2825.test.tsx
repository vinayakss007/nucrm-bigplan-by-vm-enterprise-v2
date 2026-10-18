// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2825 — the portal half: a page that reads only `{ data, isLoading }` throws
 * away the honest 5xx and renders its empty state anyway.
 *
 * Four customer pages did that (`quotes:76`, `tickets:42`, `invoices:46`,
 * `kb:38`), and the invoices one is the proof that fixing the route is not
 * enough: #2439 made `GET /api/public/invoices` answer 500 in 2026, and the
 * customer still saw "No invoices yet" every time, because the page never looked
 * at the error the route had just told the truth about.
 *
 * Each page is mounted on the production query client with `fetch` stubbed,
 * so these drive the same seam a browser would — including `apiFetcher`'s
 * ApiQueryError for the two pages that use `useApiQuery`, and the hand-written
 * `queryFn` for the two that do not.
 *
 * Asserted per page: failed read + nothing cached → `role="alert"` and NOT the
 * empty sentence; successful empty read → the empty sentence and no alert;
 * successful non-empty read → the rows. The KB page has a fourth case, because
 * its empty sentence also serves a search miss: rows + a failed refetch must
 * keep showing the rows.
 *
 * Fixture addresses are documentation-only (`corp.test`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/client';
import PortalQuotesPage from '@/app/portal/(protected)/quotes/page';
import PortalTicketsPage from '@/app/portal/(protected)/tickets/page';
import PortalInvoicesPage from '@/app/portal/(protected)/invoices/page';
import PortalKbPage from '@/app/portal/(protected)/kb/page';

const quoteRow = {
  id: '9a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d',
  quote_number: 'Q-2026-0042',
  title: 'Website rebuild',
  status: 'sent',
  total_amount: '1250.00',
  created_at: '2026-01-05T00:00:00.000Z',
};
const ticketRow = {
  id: '8a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2e',
  ticket_number: 'T-1001',
  subject: 'Portal login',
  status: 'open',
  created_at: '2026-01-05T00:00:00.000Z',
};
const invoiceRow = {
  id: '7a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2f',
  invoiceNumber: 'INV-2026-0042',
  status: 'paid',
  totalAmount: '1250.00',
  issueDate: '2026-01-05',
};
const articleRow = {
  id: '6a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c30',
  title: 'How password resets work',
  slug: 'password-resets',
  excerpt: 'What to do when the email does not arrive.',
  views: 3,
  categoryName: 'Account',
};

type Mode = { kind: 'rows'; rows: unknown[] } | { kind: 'empty' } | { kind: 'failed' };

function stubFetch(mode: Mode) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string) => {
    if (mode.kind === 'failed') {
      return { ok: false, status: 500, json: async () => ({ error: 'Failed to load' } as Record<string, unknown>) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: mode.kind === 'empty' ? [] : mode.rows }),
    };
  }));
}

function mount(Page: React.ComponentType, mode: Mode) {
  localStorage.setItem('portal_session', JSON.stringify({
    email: 'customer@corp.test',
    name: 'Casey Customer',
    permissions: { quotes: true, invoices: true, cases: true, kb: true },
  }));
  stubFetch(mode);
  // The production client minus its retry schedule: a failed query would
  // otherwise spend ~3s retrying while the page still shows its skeleton.
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}

const EMPTY_COPY: Record<string, { Page: React.ComponentType; rows: unknown[]; text: RegExp; label: string; shown: string }> = {
  quotes: { Page: PortalQuotesPage, rows: [quoteRow], text: /No quotes yet/, label: 'We could not load your quotes', shown: 'Website rebuild' },
  tickets: { Page: PortalTicketsPage, rows: [ticketRow], text: /No tickets yet/, label: 'We could not load your tickets', shown: 'Portal login' },
  invoices: { Page: PortalInvoicesPage, rows: [invoiceRow], text: /No invoices yet/, label: 'We could not load your invoices', shown: 'INV-2026-0042' },
  kb: { Page: PortalKbPage, rows: [articleRow], text: /No articles found/, label: 'We could not load the knowledge base', shown: 'How password resets work' },
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  mockRouter.replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('a failed portal read is reported as a failure (#2825)', () => {
  for (const [name, c] of Object.entries(EMPTY_COPY)) {
    it(`${name}: the alert replaces the empty sentence when the read fails`, async () => {
      mount(c.Page, { kind: 'failed' });
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(c.label);
      expect(screen.queryByText(c.text), `${name}: still claims the customer has nothing`).toBeNull();
    });

    it(`${name}: a successful empty read still gets the empty sentence`, async () => {
      mount(c.Page, { kind: 'empty' });
      await waitFor(() => expect(screen.getByText(c.text)).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it(`${name}: rows on a successful read render, with no alert`, async () => {
      mount(c.Page, { kind: 'rows', rows: c.rows });
      await waitFor(() => expect(screen.getByText(c.shown)).toBeTruthy());
      expect(screen.queryByText(c.text)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('the KB list keeps cached rows when a later refetch fails', async () => {
    mount(PortalKbPage, { kind: 'rows', rows: [articleRow] });
    await waitFor(() => expect(screen.getByText('How password resets work')).toBeTruthy());

    // Same page, second read: the rows are still on screen, so the failure must
    // not hide them (mirrors the stale-data rule #2823 pins for the panels).
    vi.unstubAllGlobals();
    stubFetch({ kind: 'failed' });
    fireEvent.change(screen.getByPlaceholderText(/search articles/i), { target: { value: 'password' } });
    expect(screen.getByText('How password resets work')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
