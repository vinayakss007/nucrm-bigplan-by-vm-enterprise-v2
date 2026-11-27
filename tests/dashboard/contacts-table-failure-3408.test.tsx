// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed contacts refresh used to render "No contacts yet" over an
 * outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/contacts',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ContactsDataTable from '@/components/tenant/contacts-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aContact = {
  id: 'CO1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.io', phone: null,
  company_name: null, lead_status: 'new', lead_source: null, assigned_name: null,
  created_at: '2026-11-18T00:00:00Z',
};

function mount(initialContacts: typeof aContact[]) {
  render(<ContactsDataTable
    initialContacts={initialContacts} companies={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true, canViewAll: true }}
    totalCount={initialContacts.length} tenantId="t1" userId="u1"
  />);
}

function stubByUrl(overrides: Record<string, Response>) {
  const mock = vi.fn().mockImplementation(async (input: string) => {
    const match = Object.keys(overrides).find(k => String(input).includes(k));
    return match ? overrides[match] : resp({ data: [], total: 0, fields: [] });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function triggerReload() {
  await waitFor(() => expect(screen.getByPlaceholderText('Search contacts by name, email, or company...')).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText('Search contacts by name, email, or company...'), {
    target: { value: 'needle' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: contacts list distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an explicit error, not "No contacts yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'contacts offline' }, false, 500)));
    mount([aContact]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load contacts/)).toBeTruthy());
    expect(screen.queryByText('No contacts yet')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No contacts yet')).toBeTruthy());
    expect(screen.queryByText(/Could not load contacts/)).toBeNull();
  });
});

describe('#3408: contacts bulk-action options distinguish a failed read from an empty one', () => {
  it('names the failed option read instead of silently hiding the action', async () => {
    stubByUrl({ '/api/tenant/email-templates': resp({ error: 'templates offline' }, false, 500) });
    mount([aContact]);
    await waitFor(() => expect(screen.getByText(/Bulk action options could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/email templates/)).toBeTruthy();
    expect(screen.queryByText(/Bulk action options could not be loaded \(\)/)).toBeNull();
  });

  it('re-runs the failed option read from the retry button', async () => {
    const mock = stubByUrl({ '/api/tenant/segments': resp({ error: 'segments offline' }, false, 403) });
    mount([aContact]);
    await waitFor(() => expect(screen.getByText(/Bulk action options could not be loaded/)).toBeTruthy());
    const before = mock.mock.calls.filter(([url]) => String(url).includes('/segments')).length;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => {
      const after = mock.mock.calls.filter(([url]) => String(url).includes('/segments')).length;
      expect(after).toBe(before + 1);
    });
  });

  it('shows no option alert when every option read answered empty', async () => {
    const mock = stubByUrl({});
    mount([aContact]);
    await waitFor(() => expect(mock.mock.calls.filter(([url]) => String(url).includes('/email-templates')).length).toBe(1));
    expect(screen.queryByText(/Bulk action options could not be loaded/)).toBeNull();
  });
});
