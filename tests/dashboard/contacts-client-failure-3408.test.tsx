// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed contacts search used to render "No contacts yet" over an
 * outage (the toast fired only on a thrown network error, not a 500 body).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/contacts',
}));
vi.mock('@/hooks/use-open-create-param', () => ({ useOpenCreateParam: () => {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/tenant/import-modal', () => ({ default: () => null }));

import TenantContactsClient from '@/components/tenant/contacts-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result));
  render(<TenantContactsClient
    initialContacts={[]} companies={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true, canViewAll: true }}
    tenantId="t1" userId="u1"
  />);
}

async function search() {
  fireEvent.change(screen.getByPlaceholderText('Search by name, email, company...'), {
    target: { value: 'ada' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0), { timeout: 3000 });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: contacts client distinguishes a failed search from an empty list', () => {
  it('a refused search shows an explicit error, not "No contacts yet"', async () => {
    mount(resp({ error: 'search offline' }, false, 500));
    await search();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Could not load contacts');
    expect(screen.queryByText('No contacts yet')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    mount(resp({ data: [], total: 0 }));
    await search();
    await waitFor(() => expect(screen.getByText('No contacts match your filters')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
