// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2747 — the customer portal shows every invoice as an anonymous $0 row.
 *
 * `app/portal/(protected)/invoices/page.tsx:15-22` types the row snake_case
 * (`invoice_number`, `created_at`, `total`, `amount`), but
 * `GET /api/public/invoices` answers with an explicit camelCase projection
 * (`app/api/public/invoices/route.ts:44-55`: `invoiceNumber`, `status`,
 * `totalAmount`, `amountPaid`, `balanceDue`, `currency`, `issueDate`, `dueDate`,
 * `paidAt`) — there is no `created_at`, no `total` and no `amount` in that
 * payload at all. `useApiQuery<{ data: PortalInvoice[] }>`
 * (`lib/query/client.tsx:73`) is an assertion, not a conversion, so `tsc` cannot
 * see the drift.
 *
 * What the customer sees for a real, paid, $1,250 invoice:
 *   - the Invoice cell (`:87`) falls through to `#${id.slice(0,8)}`, so the list
 *     carries an internal uuid prefix instead of the number on the document they
 *     were sent;
 *   - the Date cell (`:89`) is `formatDate(undefined)`, which is `—`
 *     (`lib/utils.ts:25`);
 *   - the Amount cell (`:90`) is `formatCurrency(undefined || undefined || 0)` =
 *     `$0` — the price column is a lie on every row;
 *   and `totalAmount` is a `decimal(15,2)` column (`drizzle/schema/billing.ts:118`)
 *   with no `pg.setTypeParser` registered anywhere in this app, so the money
 *   arrives as a string, not a number.
 *
 * `id` and `status` do line up, so the row count and the status badge look
 * healthy — those two are the controls here.
 *
 * Fixture addresses are documentation-only (`corp.test`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// A stable object: the page's session effect keys on `router`, so a fresh one per
// call re-runs the effect on every render and the loop never terminates.
const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

import { QueryProvider } from '@/lib/query/client';
import PortalInvoicesPage from '@/app/portal/(protected)/invoices/page';

/** One row exactly as route.ts:44-55 answers it. */
function apiInvoice(over: Record<string, unknown> = {}) {
  return {
    id: '9a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d',
    invoiceNumber: 'INV-2026-0042',
    status: 'paid',
    totalAmount: '1250.00',
    amountPaid: '1250.00',
    balanceDue: '0.00',
    currency: 'USD',
    issueDate: '2026-01-05',
    dueDate: '2026-02-04',
    paidAt: '2026-01-20T09:00:00.000Z',
    ...over,
  };
}

function mountPortal(rows: Record<string, unknown>[]) {
  localStorage.setItem('portal_session', JSON.stringify({
    email: 'customer@corp.test',
    name: 'Casey Customer',
    permissions: { quotes: true, invoices: true, cases: true },
  }));
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ data: rows }),
  })));
  render(<QueryProvider><PortalInvoicesPage /></QueryProvider>);
}

/** The cells of the first body row, in header order. */
function firstRowCells(): string[] {
  const tr = document.querySelector('tbody tr');
  return tr ? Array.from(tr.querySelectorAll('td')).map(td => td.textContent ?? '') : [];
}

async function mountOne(over: Record<string, unknown> = {}) {
  mountPortal([apiInvoice(over)]);
  await waitFor(() => expect(document.querySelector('tbody tr'), 'no row rendered').toBeTruthy());
}

describe('the portal invoice list reads the projection the route sends (#2747)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('names the invoice the customer was billed', async () => {
    await mountOne();
    expect(screen.getByText('INV-2026-0042')).toBeTruthy();
    expect(screen.queryByText(/^#9a7b6c5d/), 'the uuid fallback means invoiceNumber was unread').toBeNull();
  });

  it('shows the amount it is actually carrying', async () => {
    await mountOne();
    const cells = firstRowCells();
    expect(cells, cells.join(' | ')).toContain('$1,250');
    expect(screen.queryByText('$0'), 'every row priced at $0 is the money column being read wrong').toBeNull();
  });

  it('prices a partially-paid invoice from the same string column', async () => {
    await mountOne({ totalAmount: '4800.40', status: 'partially_paid' });
    expect(screen.getByText('$4,800')).toBeTruthy();
  });

  it('shows a real invoice date instead of the em-dash placeholder', async () => {
    await mountOne();
    const cells = firstRowCells();
    const dateCell = cells[1] ?? '';
    expect(dateCell, cells.join(' | ')).not.toBe('—');
    expect(dateCell).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  // Controls — already true at the base commit, must stay true.
  it('the status badge still comes through', async () => {
    await mountOne({ status: 'overdue' });
    expect(screen.getByText('overdue')).toBeTruthy();
  });

  it('one row per invoice', async () => {
    mountPortal([apiInvoice(), apiInvoice({ id: '11111111-1111-4111-8111-111111111111', invoiceNumber: 'INV-2026-0043' })]);
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(2));
    expect(screen.getByText('INV-2026-0043')).toBeTruthy();
  });

  it('an empty list keeps its empty state', async () => {
    mountPortal([]);
    await waitFor(() => expect(screen.getByText('No invoices yet')).toBeTruthy());
  });
});
