// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed leads refresh used to set an empty list in the catch and
 * render "No leads …" (plus an "add leads" prompt) over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/client-logger', () => ({ clientLogWarn: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LeadsClient from '@/components/tenant/leads-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aLead = {
  id: 'L1', title: 'Big deal', lead_status: 'new', first_name: 'Ada', last_name: 'Lovelace',
  email: 'ada@x.io', company_id: null, owner_id: null, created_at: '2026-11-18T00:00:00Z',
};
const mount = () => render(
  <LeadsClient
    initialLeads={[]} companies={[]} teamMembers={[]} permissions={{ canCreate: true }}
    totalCount={0} tenantId="T1" userId="U1"
  />,
);

function stubFetch(listResponse: Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes('/api/tenant/contacts?')) return listResponse;
    return resp({ data: [] });
  });
}

function stubByUrl(overrides: Record<string, Response>) {
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/tenant/contacts?')) return resp({ data: [] });
    const key = Object.keys(overrides).find(k => url.includes(k));
    return key ? overrides[key] : resp({ data: [], fields: [] });
  });
  return mock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: leads client distinguishes a failed refresh from an empty pipeline', () => {
  it('a failed refresh shows an error, not "No leads"', async () => {
    stubFetch(resp({ error: 'offline' }, false, 500));
    mount();
    await waitFor(() => expect(screen.getByText('Leads could not be loaded.')).toBeTruthy());
    expect(screen.queryByText(/No leads/)).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    stubFetch(resp({ data: [] }));
    mount();
    await waitFor(() => expect(screen.getByText(/No leads/)).toBeTruthy());
    expect(screen.queryByText('Leads could not be loaded.')).toBeNull();
  });

  it('a successful refresh still renders the leads', async () => {
    stubFetch(resp({ data: [aLead] }));
    mount();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText('Leads could not be loaded.')).toBeNull();
  });
});

describe('#3408: leads option lists distinguish a failed read from an empty one', () => {
  it('names the failed product catalogue read instead of an empty picker', async () => {
    stubByUrl({ '/api/tenant/products': resp({ error: 'offline' }, false, 500) });
    mount();
    await waitFor(() => expect(screen.getByText(/Lead option lists could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/products/)).toBeTruthy();
  });

  it('names the failed segments read', async () => {
    stubByUrl({ '/api/tenant/segments': resp({ error: 'forbidden' }, false, 403) });
    mount();
    await waitFor(() => expect(screen.getByText(/Lead option lists could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/segments/)).toBeTruthy();
  });

  it('re-runs the failed catalogue read from the retry button', async () => {
    const mock = stubByUrl({ '/api/tenant/products': resp({ error: 'offline' }, false, 500) });
    mount();
    await waitFor(() => expect(screen.getByText(/Lead option lists could not be loaded/)).toBeTruthy());
    const before = mock.mock.calls.filter(([input]) => String(input).includes('/api/tenant/products')).length;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => {
      const after = mock.mock.calls.filter(([input]) => String(input).includes('/api/tenant/products')).length;
      expect(after).toBe(before + 1);
    });
  });

  it('shows no option alert when every catalogue answers empty', async () => {
    const mock = stubByUrl({});
    mount();
    await waitFor(() => expect(mock.mock.calls.filter(([input]) => String(input).includes('/api/tenant/products')).length).toBe(1));
    expect(screen.queryByText(/Lead option lists could not be loaded/)).toBeNull();
  });
});
