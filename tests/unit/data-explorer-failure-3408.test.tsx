// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the superadmin data explorer's on-demand search and its edit/delete
 * writes used raw fetch with no status check: a refused search rendered a
 * zero-record table, and a refused write closed the dialog / refreshed as if
 * it had landed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/query/client', () => ({
  useApiQuery: () => ({ data: { summary: {} }, error: null, isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import SuperAdminDataExplorer from '@/app/superadmin/data-explorer/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const zeroResult = { results: {}, totalAcrossAll: 0, query: 'acme' };
const dealResult = {
  totalAcrossAll: 1,
  query: 'acme',
  results: {
    deals: {
      total: 1, page: 1, limit: 50,
      data: [{ id: 'D1', title: 'Big deal', stage: 'new', value: '100', contact_name: 'Ada', created_at: '2026-11-18T00:00:00Z' }],
    },
  },
};

function mount(handler: (url: string, init?: RequestInit) => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init) as Promise<Response>));
  render(<SuperAdminDataExplorer />);
}

async function search() {
  fireEvent.change(screen.getByPlaceholderText(/Search across ALL tenants/), { target: { value: 'acme' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: data explorer failures are not empty/zero results', () => {
  it('a failed search shows an error, not a zero-record table', async () => {
    mount(async () => resp({ error: 'search unavailable' }, false, 500));
    await search();
    await waitFor(() => expect(screen.getByText('search unavailable')).toBeTruthy());
    expect(screen.queryByText(/records found/)).toBeNull();
  });

  it('a genuine zero result still renders normally', async () => {
    mount(async () => resp(zeroResult));
    await search();
    await waitFor(() => expect(screen.getByText(/0 records found/)).toBeTruthy());
    expect(screen.queryByText('search unavailable')).toBeNull();
  });

  it('a refused edit keeps the dialog open and shows the error', async () => {
    mount(async (_url, init) => {
      if (init?.method === 'PUT') return resp({ error: 'table not editable' }, false, 400);
      return resp(dealResult);
    });
    await search();
    await waitFor(() => expect(screen.getByRole('button', { name: /Deals/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }));
    await waitFor(() => expect(screen.getByTitle('Edit')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Edit'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByText(/Edit failed: table not editable/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
  });
});
