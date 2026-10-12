// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2231 — deals pipeline stats/table:
 *   - a 500 replying `{ error }` must render an explicit error affordance with
 *     retry and keep the previously shown deals, instead of silently becoming
 *     a "0 deals" false-empty pipeline;
 *   - global filter searches are debounced and racing requests are aborted,
 *     so an earlier slow response can't overwrite a newer one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), pathname: '/tenant/deals' }),
}));
// Radix dropdown internals aren't under test; keep the DOM small.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuLabel: () => null,
  DropdownMenuCheckboxItem: () => null,
  DropdownMenuSeparator: () => null,
}));

import DealsDataTable from '@/components/tenant/deals-data-table';

const deal = {
  id: 'd1', title: 'Big Enterprise Deal', amount: 50000, stage_name: 'lead',
  close_date: null, first_name: 'Ada', last_name: 'Lovelace', company_name: 'Analytical Co',
  assigned_to: null, created_at: '2026-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function mountDeals(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <DealsDataTable
      initialDeals={[deal]}
      contacts={[]}
      companies={[]}
      teamMembers={[]}
      permissions={{ canCreate: true, canEdit: true, canDelete: true }}
    />,
  );
}

function typeInSearch(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Search deals by title, contact, or company...'), { target: { value } });
}

const dealsCalls = () => vi.mocked(fetch).mock.calls.filter(c => String(c[0]).startsWith('/api/tenant/deals?'));

describe('DealsDataTable error vs false-empty (#2231)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a 500 on reload shows an error + retry and keeps the previous deals/stats — not a "0 total" pipeline', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/deals?')) return jsonResponse({ error: 'pipeline aggregate timed out' }, false, 500);
      return jsonResponse({ data: [], fields: [] });
    });
    mountDeals(fetchMock);

    expect(screen.getByText('Big Enterprise Deal')).toBeTruthy();
    expect(screen.getByText('1 total')).toBeTruthy();

    typeInSearch('enterprise');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Failed to load deals');
    expect(screen.getByRole('alert').textContent).toContain('pipeline aggregate timed out');
    expect(screen.getByRole('alert').textContent).toContain('Try again');
    // No false-empty: the earlier row and total remain visible.
    expect(screen.getByText('Big Enterprise Deal')).toBeTruthy();
    expect(screen.getByText('1 total')).toBeTruthy();
  });

  it('recovers cleanly on retry after the API comes back', async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/deals?')) {
        return fail
          ? jsonResponse({ error: 'down' }, false, 500)
          : jsonResponse({ data: [{ ...deal, title: 'Recovered Deal' }], total: 1 });
      }
      return jsonResponse({ data: [], fields: [] });
    });
    mountDeals(fetchMock);
    // Query matches both the old and the recovered title so the table's
    // client-side filter doesn't hide the row we assert on.
    typeInSearch('deal');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fail = false;
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Recovered Deal')).toBeTruthy();
  });

  it('a genuine empty result set still renders the empty pipeline (error and empty are not merged)', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/deals?')) return jsonResponse({ data: [], total: 0 });
      return jsonResponse({ data: [], fields: [] });
    });
    mountDeals(fetchMock);
    typeInSearch('nomatch');
    await waitFor(() => expect(screen.getByText('0 total')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No deals yet')).toBeTruthy();
  });

  it('debounces per-keystroke fetches and aborts the superseded in-flight request', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/deals?')) {
        signals.push((init?.signal ?? new AbortController().signal) as AbortSignal);
        return jsonResponse({ data: [deal], total: 1 });
      }
      return jsonResponse({ data: [], fields: [] });
    });
    mountDeals(fetchMock);

    // Three rapid keystrokes → still exactly one /api/tenant/deals request
    // once the 350ms debounce window passes.
    typeInSearch('a');
    typeInSearch('ab');
    typeInSearch('abc');
    await waitFor(() => expect(dealsCalls().length).toBe(1));
    await new Promise(r => setTimeout(r, 450));
    expect(dealsCalls().length).toBe(1);

    // A follow-up search aborts the superseded request's signal path: the
    // newest request must own the UI.
    typeInSearch('abcd');
    await waitFor(() => expect(dealsCalls().length).toBe(2));
    expect(signals[0]!.aborted).toBe(true); // superseded → can no longer clobber results
    expect(signals[1]!.aborted).toBe(false);
  });
});
