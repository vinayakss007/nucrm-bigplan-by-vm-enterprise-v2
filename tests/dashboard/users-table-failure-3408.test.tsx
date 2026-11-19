// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed refresh of the superadmin user list used to render
 * "No users found", indistinguishable from a genuinely empty directory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import UsersDataTable from '@/components/superadmin/users-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aUser = {
  id: 'U1', email: 'ada@x.io', full_name: 'Ada', is_super_admin: false,
  email_verified: true, last_seen_at: null, created_at: '2026-11-18T00:00:00Z',
};

function mount(initialUsers: typeof aUser[]) {
  render(<UsersDataTable initialUsers={initialUsers} />);
}

async function triggerReload() {
  fireEvent.change(screen.getByPlaceholderText('Search by email or name...'), {
    target: { value: 'needle' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: user list distinguishes a failed refresh from an empty directory', () => {
  it('a failed refresh shows an error banner, not "No users found"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'directory offline' }, false, 500)));
    mount([aUser]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load users/)).toBeTruthy());
    expect(screen.queryByText('No users found')).toBeNull();
  });

  it('a failed refresh over an empty list does not claim an empty directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'directory offline' }, false, 500)));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('User directory unavailable')).toBeTruthy());
    expect(screen.queryByText('No users found')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No users found')).toBeTruthy());
    expect(screen.queryByText(/Could not load users/)).toBeNull();
  });
});
