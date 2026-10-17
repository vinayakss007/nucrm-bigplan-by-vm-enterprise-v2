// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2730 — the Team page renders itself blank after any change.
 *
 * `app/tenant/settings/team/page.tsx:26-46` hands the client a snake_case
 * roster (`user_id`, `role_slug`, `full_name`, `joined_at`, `role_name`), and
 * `components/tenant/settings/team-client.tsx:38-45` types it that way. But the
 * client's own `reload()` (`:165`) fetches `GET /api/tenant/members`, whose
 * projection is camelCase (`app/api/tenant/members/route.ts:142-156`:
 * `userId`, `roleSlug`, `fullName`, `joinedAt`, `roleName`), and `:172` puts
 * those rows straight into the same state:
 *
 *     setMembers(result.data.data || []); setInvitations(result.data.invitations || []);
 *
 * Every mutation on the page ends in `reload()` — invite (`:205-211`), role
 * change (`:237`), remove (`:249`) — so the first paint is correct and the very
 * next one is not: `{m.full_name || '—'}` (`:406`) prints an em dash for every
 * human, `isMe` (`:397`) never fires so the "You" badge and the self-protection
 * around `!isMe` (`:433`) vanish, the "Joined …" line (`:415`) disappears, the
 * role `<select value={m.role_slug}>` (`:420`) detaches from the row's real
 * role, and the reassign-target options (`:107` `value={m.user_id}`) post
 * `"undefined"` as `reassignTo`. The invitations list has the same split:
 * `page.tsx:48-54` sends `role_slug` / `expires_at`, the route returns whole
 * row
 * camelCase, and `:458` renders `{inv.role_slug?.replace('_',' ')} · expires
 * {formatDate(inv.expires_at)}`.
 *
 * The payload below is the route's real key set, not an invented one. The
 * existing #2231 suite passes snake_case fixtures, which is why the drift has
 * stayed invisible: that suite grades the component against the shape the
 * Server Component gives it, never the shape the client's own fetch returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_msg: string, action: () => Promise<void> | void) => action(),
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import TeamSettingsClient from '@/components/tenant/settings/team-client';

/** What team/page.tsx:76-89 actually passes on first render. */
const initialMembers = [
  { id: 'm1', user_id: 'u1', full_name: 'Ada Sales', email: 'ada@corp.test', role_slug: 'sales_rep', role_name: 'Sales Rep', joined_at: '2026-01-05T00:00:00.000Z' },
  { id: 'm2', user_id: 'u2', full_name: 'Ravi Admin', email: 'ravi@corp.test', role_slug: 'admin', role_name: 'Admin', joined_at: '2026-02-05T00:00:00.000Z' },
  { id: 'm3', user_id: 'u3', full_name: 'Priya Viewer', email: 'priya@corp.test', role_slug: 'viewer', role_name: 'Viewer', joined_at: '2026-03-05T00:00:00.000Z' },
];
const initialInvitations = [
  { id: 'inv1', email: 'pending@corp.test', role_slug: 'sales_rep', expires_at: new Date(Date.now() + 86400000).toISOString() },
];
const roles = [
  { id: 'r1', slug: 'sales_rep', name: 'Sales Rep' },
  { id: 'r2', slug: 'admin', name: 'Admin' },
];

/**
 * GET /api/tenant/members as it is really shaped: the members projection
 * (route.ts:142-156) and `db.select()` over `invitations` (whole-row camelCase),
 * after JSON has turned the timestamps into ISO strings.
 */
function apiPayload() {
  return {
    data: [
      { id: 'm1', userId: 'u1', roleSlug: 'sales_rep', status: 'active', joinedAt: '2026-01-05T00:00:00.000Z', fullName: 'Ada Sales', email: 'ada@corp.test', avatarUrl: null, emailVerified: true, roleName: 'Sales Rep', contactCount: 7, dealCount: 2, taskCount: 1 },
      { id: 'm2', userId: 'u2', roleSlug: 'admin', status: 'active', joinedAt: '2026-02-05T00:00:00.000Z', fullName: 'Ravi Admin', email: 'ravi@corp.test', avatarUrl: null, emailVerified: false, roleName: 'Admin', contactCount: 0, dealCount: 0, taskCount: 0 },
      { id: 'm3', userId: 'u3', roleSlug: 'viewer', status: 'active', joinedAt: '2026-03-05T00:00:00.000Z', fullName: 'Priya Viewer', email: 'priya@corp.test', avatarUrl: null, emailVerified: true, roleName: 'Viewer', contactCount: 0, dealCount: 0, taskCount: 0 },
    ],
    invitations: [
      { id: 'inv1', tenantId: 't1', email: 'pending@corp.test', roleSlug: 'sales_rep', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: new Date().toISOString(), acceptedAt: null },
    ],
    tenantId: 't1',
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function renderClient(membersFetch: () => Promise<Response>) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/tenant/members' && (!init || init.method !== 'PATCH')) return membersFetch();
    if (url === '/api/tenant/invite/send' && init?.method === 'POST') return jsonResponse({ ok: true });
    if (url === '/api/tenant/members' && init?.method === 'PATCH') return jsonResponse({ ok: true });
    return jsonResponse({ data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, ...render(
    <TeamSettingsClient
      members={initialMembers as never}
      invitations={initialInvitations as never}
      roles={roles as never}
      _tenantId="t1"
      currentUserId="u2"
    />,
  )};
}

/** Run the invite flow, whose success path always ends in reload(). */
async function inviteAndReload() {
  fireEvent.click(screen.getByText('Add Team Member'));
  fireEvent.change(screen.getByPlaceholderText('colleague@company.com'), { target: { value: 'new@corp.test' } });
  fireEvent.click(screen.getByText('Send Invite'));
}

describe('the roster survives its own reload (#2730)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('names still render after a reload', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getAllByText('Ada Sales').length).toBeGreaterThan(0));
    expect(screen.queryByText('—'), 'a blank em dash means the row lost full_name').toBeNull();
  });

  it('the current user is still marked You', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('the Joined line survives', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    expect(screen.getAllByText(/Joined /).length, document.body.textContent).toBeGreaterThan(0);
  });

  // The row actions are guarded by the two fields the reload drops:
  // `!isMe && !isAdmin` (team-client.tsx:433) around the Remove button.
  it('only the removable rows show a Remove button', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    // Ravi is the signed-in admin (isMe), so his own row and his admin rows are
    // protected; Ada (sales_rep) and Priya (viewer) are removable.
    expect(screen.getAllByTitle('Remove member').length, document.body.textContent).toBe(2);
  });

  // Ada owns 7 contacts in the payload, so the modal must warn about the data
  // and offer a target. hasData (team-client.tsx:77) reads contact_count, which
  // the reload leaves undefined, so at base the picker block is not even
  // rendered and removeMember posts reassignTo: '' — which the route turns into
  // `reassignTo || ctx.userId` (app/api/tenant/members/route.ts:258), silently
  // landing every record on the admin who clicked Remove.
  it('the remove dialog of a member who owns data offers a real target', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    fireEvent.click(screen.getAllByTitle('Remove member')[0]!);
    expect(await screen.findByText(/This member owns data/), document.body.textContent).toBeTruthy();
    // The same count also renders in the roster row now that contact_count survives.
    expect(screen.getAllByText(/7\s+contacts/).length).toBeGreaterThan(0);
    const target = Array.from(document.querySelectorAll('select'))
      .find(sel => Array.from(sel.options).some(o => o.text.includes('Reassign to me')));
    expect(target, document.body.textContent).toBeTruthy();
    const values = Array.from(target!.options).map(o => o.value);
    // '' = the admin themself, then the non-viewer colleagues (Priya is excluded
    // by the role_slug !== 'viewer' filter at team-client.tsx:76).
    expect(values, values.join(',')).toEqual(['', 'u2']);
  });

  it('a pending invitation still shows its role and expiry', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    const line = screen.getByText('pending@corp.test').parentElement?.parentElement?.textContent ?? '';
    expect(line, line).toContain('sales rep');
    expect(line).not.toMatch(/undefined|Invalid Date/);
  });

  it('the workload counts the API already sends become visible instead of blank', async () => {
    renderClient(async () => jsonResponse(apiPayload()));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByText('Ada Sales')).toBeTruthy());
    expect(screen.getAllByText(/7 contacts/).length).toBeGreaterThan(0);
  });
});

describe('the first paint and the error path are unchanged (#2730)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the server-rendered snake_case roster renders before any reload', () => {
    renderClient(async () => jsonResponse(apiPayload()));
    expect(screen.getByText('Ada Sales')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('3 active members')).toBeTruthy();
  });

  it('a failed reload keeps the previous roster on screen (#2231)', async () => {
    renderClient(async () => jsonResponse({ error: 'boom' }, false, 500));
    await inviteAndReload();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getAllByText('Ada Sales').length).toBeGreaterThan(0);
    expect(toast.success).toHaveBeenCalled();
  });
});
