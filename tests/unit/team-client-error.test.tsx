// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2231 — team roster resilience:
 *   - a failed GET /members reload after an invite keeps the previous roster
 *     on screen and shows an explicit error + retry, instead of wiping the
 *     list to "0 active members" (false empty);
 *   - cancelInvite must not toast success when the DELETE 500s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/confirm-dialog', () => ({
  // Run the destructive action immediately — the confirm UX isn't under test.
  confirmThen: (_msg: string, action: () => Promise<void> | void) => action(),
}));
// No <Toaster/> is mounted in jsdom, so assert on the toast API directly.
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import TeamSettingsClient from '@/components/tenant/settings/team-client';

const members = [
  { id: 'm1', user_id: 'u1', full_name: 'Ada Sales', email: 'ada@corp.test', role_slug: 'sales_rep', role_name: 'Sales Rep' },
];
const invitations = [
  { id: 'inv1', email: 'pending@corp.test', role_slug: 'viewer', expires_at: new Date(Date.now() + 86400000).toISOString() },
];
const roles = [
  { id: 'r1', slug: 'sales_rep', name: 'Sales Rep' },
  { id: 'r2', slug: 'viewer', name: 'Viewer' },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function renderClient() {
  return render(
    <TeamSettingsClient
      members={members as never}
      invitations={invitations as never}
      roles={roles as never}
      _tenantId="tenant-1"
      currentUserId="me"
    />,
  );
}

describe('TeamSettingsClient error vs empty (#2231)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the roster and shows retry when the post-invite reload fails', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tenant/invite/send' && init?.method === 'POST') return jsonResponse({ ok: true });
      if (url === '/api/tenant/members') return jsonResponse({ error: 'members table is unavailable' }, false, 500);
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();

    fireEvent.click(screen.getByText('Add Team Member'));
    fireEvent.change(screen.getByPlaceholderText('colleague@company.com'), { target: { value: 'new@corp.test' } });
    fireEvent.click(screen.getByText('Send Invite'));

    // Invite succeeded → reload ran → GET /members 500s.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Failed to refresh roster');
    expect(screen.getByRole('alert').textContent).toContain('Try again');
    // The false-empty ("0 active members") must NOT happen — prior rows stay.
    expect(screen.getByText('Ada Sales')).toBeTruthy();
    expect(screen.getByText('1 active member')).toBeTruthy();
  });

  it('a successful reload still replaces the roster normally', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tenant/invite/send' && init?.method === 'POST') return jsonResponse({ ok: true });
      if (url === '/api/tenant/members') {
        return jsonResponse({ data: [...members, { id: 'm2', user_id: 'u2', full_name: 'Grace Newcomer', email: 'grace@corp.test', role_slug: 'viewer' }], invitations: [] });
      }
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();

    fireEvent.click(screen.getByText('Add Team Member'));
    fireEvent.change(screen.getByPlaceholderText('colleague@company.com'), { target: { value: 'grace@corp.test' } });
    fireEvent.click(screen.getByText('Send Invite'));

    await waitFor(() => expect(screen.getByText('Grace Newcomer')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancelInvite surfaces the failure instead of toasting success on a 500', async () => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/invite/')) return jsonResponse({ error: 'invite lock' }, false, 500);
      if (url === '/api/tenant/members') return jsonResponse({ data: members, invitations });
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();

    fireEvent.click(screen.getByText('Cancel', { selector: 'button' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // #2231: the old code toasted success even when the DELETE 500ed.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.some(c => String(c[0]).includes('invite lock'))).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('changeRole toasts a network error instead of silently no-oping', async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/tenant/members' && init?.method === 'PATCH') return Promise.reject(new TypeError('Failed to fetch'));
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderClient();

    // The role <select> displays the option label ("Sales Rep"), value is the slug.
    const select = screen.getByDisplayValue('Sales Rep');
    fireEvent.change(select, { target: { value: 'viewer' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The roster state must be untouched, and the user must be told — the old
    // code had no catch, so a network drop was a silent no-op.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network error — role was not updated'));
    expect(screen.getByText('Ada Sales')).toBeTruthy();
  });
});
