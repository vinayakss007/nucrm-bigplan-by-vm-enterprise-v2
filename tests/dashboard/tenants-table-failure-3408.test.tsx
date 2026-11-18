// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed tenants refresh used to render "No tenants found" over an
 * outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import TenantsDataTable from '@/components/superadmin/tenants-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aTenant = {
  id: 'T1', name: 'Acme', slug: 'acme', plan_id: 'pro', status: 'active',
  trial_ends_at: null, billing_email: 'billing@acme.test', current_users: 2,
  current_contacts: 10, created_at: '2026-11-18T00:00:00Z',
};

function mount(initialTenants: typeof aTenant[]) {
  render(<TenantsDataTable initialTenants={initialTenants} />);
}

async function triggerReload() {
  fireEvent.change(screen.getByPlaceholderText('Search tenants by name, email, or slug...'), {
    target: { value: 'needle' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: tenants list distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an error banner, not "No tenants found"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'list offline' }, false, 500)));
    mount([aTenant]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load tenants/)).toBeTruthy());
    expect(screen.queryByText('No tenants found')).toBeNull();
  });

  it('a failed refresh over an empty list does not claim an empty platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'list offline' }, false, 500)));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('Tenant list unavailable')).toBeTruthy());
    expect(screen.queryByText('No tenants found')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No tenants found')).toBeTruthy());
    expect(screen.queryByText(/Could not load tenants/)).toBeNull();
  });
});
