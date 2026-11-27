// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed leads load only logged to console and rendered the normal
 * "No leads yet / Start building your pipeline" empty state over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/leads',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LeadsClientNew from '@/components/tenant/leads-client-new';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(leadResponse: Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) =>
    String(input).includes('/api/tenant/leads?') ? leadResponse : resp({ data: [] })));
  render(<LeadsClientNew
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
    teamMembers={[]} companies={[]} contacts={[]} stats={[]} sources={[]}
    tenantId="t1" userId="u1"
  />);
}

async function openQuickAdd(productsResponse: Response, servicesResponse: Response) {
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/tenant/leads?')) return resp({ data: [], total: 0 });
    if (url.includes('/api/tenant/products?')) return productsResponse;
    if (url.includes('/api/tenant/services?')) return servicesResponse;
    return resp({ data: [] });
  });
  vi.stubGlobal('fetch', mock);
  render(<LeadsClientNew
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
    teamMembers={[]} companies={[]} contacts={[]} stats={[]} sources={[]}
    tenantId="t1" userId="u1"
  />);
  fireEvent.click(await screen.findByRole('button', { name: /new lead/i }));
  return mock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: leads list distinguishes a failed load from an empty pipeline', () => {
  it('a refused load shows an explicit error, not the empty pipeline prompt', async () => {
    mount(resp({ error: 'leads offline' }, false, 500));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Could not load leads');
    expect(screen.queryByText('Start building your pipeline')).toBeNull();
  });

  it('a genuine empty pipeline still shows the normal prompt', async () => {
    mount(resp({ data: [], total: 0 }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('No leads yet')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('#3408: quick-add lead pickers distinguish a failed catalogue read from an empty one', () => {
  const okCatalogue = () => resp({ data: [] });

  it('names the failed product read instead of showing a bare "No product" picker', async () => {
    await openQuickAdd(resp({ error: 'products offline' }, false, 500), okCatalogue());
    await waitFor(() => expect(screen.getByText(/Products could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/does not mean none exist/)).toBeTruthy();
    expect(screen.queryByText('No product')).toBeNull();
    expect(screen.getByText('Products unavailable — see error above')).toBeTruthy();
  });

  it('names the failed service read alongside a healthy product picker', async () => {
    await openQuickAdd(okCatalogue(), resp({ error: 'services offline' }, false, 503));
    await waitFor(() => expect(screen.getByText(/Services could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No service')).toBeNull();
    expect(screen.getByText('No product')).toBeTruthy();
  });

  it('re-runs the failed catalogue read from its retry button', async () => {
    const mock = await openQuickAdd(resp({ error: 'offline' }, false, 500), okCatalogue());
    await waitFor(() => expect(screen.getByText(/Products could not be loaded/)).toBeTruthy());
    const before = mock.mock.calls.filter(([input]) => String(input).includes('/api/tenant/products?')).length;
    fireEvent.click(screen.getAllByRole('button', { name: /try again/i })[0]);
    await waitFor(() => {
      const after = mock.mock.calls.filter(([input]) => String(input).includes('/api/tenant/products?')).length;
      expect(after).toBe(before + 1);
    });
  });

  it('keeps the ordinary placeholders when both catalogues answer empty', async () => {
    await openQuickAdd(okCatalogue(), okCatalogue());
    await waitFor(() => expect(screen.getByText('No product')).toBeTruthy());
    expect(screen.getByText('No service')).toBeTruthy();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });
});
