// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed companies refresh used to call `setCompanies(data.data || [])`
 * on any response, wiping the list into "No companies yet" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const reloadState = vi.hoisted(() => ({ reload: (async () => {}) as () => Promise<void> }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/use-delete-with-undo', () => ({
  useDeleteWithUndo: (_entity: string, reload: () => Promise<void>) => {
    reloadState.reload = reload;
    return { deleteEntity: vi.fn() };
  },
}));

import TenantCompaniesClient from '@/components/tenant/companies-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aCompany = { id: 'C1', name: 'Acme' };
const mount = (initialCompanies = [aCompany]) => render(
  <TenantCompaniesClient
    initialCompanies={initialCompanies}
    permissions={{ canCreate: true }}
    tenantId="T1" userId="U1"
  />,
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: companies client distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an error and keeps the existing companies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText(/Could not load companies/)).toBeTruthy());
    expect(screen.queryByText('No companies yet')).toBeNull();
    expect(screen.getByText('Acme')).toBeTruthy();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount([]);
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('No companies yet')).toBeTruthy());
    expect(screen.queryByText(/Could not load companies/)).toBeNull();
  });

  it('a successful refresh renders the new data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [{ id: 'C2', name: 'Globex' }] })));
    mount();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('Globex')).toBeTruthy());
    expect(screen.queryByText(/Could not load companies/)).toBeNull();
  });
});
