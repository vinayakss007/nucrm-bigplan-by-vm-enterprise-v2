// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) (2026) abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/users/page.tsx`: the roster that answers a refused refresh with silence.
 *
 * The pages the earlier slices took at least *said* something wrong: `tickets`, `errors` and the
 * three queue panels branch on the bare error flag, so a refresh that fails after a mutation
 * replaces the rows with an outage banner. This page's three sibling flags are the other failure
 * mode, and the worse one to read:
 *
 *   {loading && …}                                 // first load only
 *   {!loading && usersQuery.error && !filtered.length && <InlineErrorState "Could not load …"/>}
 *   {!loading && !usersQuery.error && !filtered.length && "No users found"}
 *
 * When TanStack hands back a failed refetch **with** `data` — which is exactly what
 * `invalidateUsers()` produces after create, deactivate and the edit dialog — `error` is set *and*
 * rows are on screen, so all three conditions are false and the page renders the last read with no
 * affordance at all. The operator looking for the account they just created finds no row, no banner
 * and no reason, and the second click is a duplicate user.
 *
 * Two more claims the same read cannot support:
 *   - `{users.length} users across all organizations · {…} super admin(s)` prints "0 users across
 *     all organizations" on a read that never reached the table — #2829's lie, sitting in the
 *     sentence *above* the banner that says the read failed.
 *   - `me === null` is treated as "you are not in this list". The identity read failing removes the
 *     `YOU` badge, counts the operator's own account as *another* super admin in the transfer
 *     panel's note, and puts that account in the "Transfer & Step Down" candidate list. The route
 *     refuses it (`app/api/superadmin/transfer-admin/route.ts:43`, and it demands a
 *     `current_password` the UI never asks for), so the platform is not one click from a lock-out —
 *     but the page is still printing a choice set it has not established, which is this epic's
 *     first honesty rule.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import UsersPage from '@/app/superadmin/users/page';

const USERS = '/api/superadmin/users';
const ME = '/api/superadmin/me';

const NOW = '2026-03-04T10:00:00.000Z';
const rows = {
  data: [
    { id: 'u1', email: 'ada@example.test', full_name: 'Ada Operator', is_super_admin: true, created_at: NOW, memberships: [{ tenant_name: 'Kestrel Logistics', plan: 'Growth' }] },
    { id: 'u2', email: 'bob@example.test', full_name: 'Bob Clerk', is_super_admin: false, created_at: NOW, memberships: [] },
    { id: 'u3', email: 'carl@example.test', full_name: 'Carl Owner', is_super_admin: true, created_at: NOW, memberships: [] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this page has never been able to reach: the read answered, then refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** The sentence under the "All Users" heading, which carries both roster counts. */
const headline = () => {
  const h = screen.getByRole('heading', { name: /all users/i });
  return h.parentElement?.textContent ?? '';
};

const openTransferPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /transfer admin/i }));
};

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

beforeEach(() => {
  registry.byUrl = {};
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the roster keeps its rows and says which half is missing (#2872)', () => {
  it('calls the accounts the last read, with the reason, instead of saying nothing', () => {
    const result = staleRead(rows);
    registry.byUrl = { [USERS]: result, [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(screen.getByText('Bob Clerk')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the user list, so the accounts below are the last read: Request failed (504)');
    // Not "some data may be out of date": the account at stake is the one just written.
    expect(alerts()).toMatch(/user you just (created|edited|deactivated)/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not describe a refused refresh as a load that never happened', () => {
    registry.byUrl = { [USERS]: staleRead(rows), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(alerts()).not.toContain('Could not load the user list');
    expect(alerts()).not.toMatch(/not an empty table/i);
  });

  it('keeps counting the accounts it is still showing', () => {
    registry.byUrl = { [USERS]: staleRead(rows), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(headline()).toContain('3 users across all organizations');
    expect(headline()).toContain('2 super admin(s)');
    expect(headline()).not.toContain('—');
  });

  it('keeps #2829\'s sentence, and dashes the roster line, for a read that never answered', () => {
    registry.byUrl = { [USERS]: failed('Request failed (500)'), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(alerts()).toContain('Could not load the user list — this is a failed request, not an empty table.');
    expect(screen.queryByText('Bob Clerk')).toBeNull();
    expect(headline()).toContain('— users across all organizations');
    expect(headline()).toContain('— super admin(s)');
    expect(headline()).not.toMatch(/0 users across all organizations/);
  });

  it('says "No users found" only for the read that came back with nobody', () => {
    registry.byUrl = { [USERS]: ok({ data: [] }), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(screen.getByText('No users found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(headline()).toContain('0 users across all organizations');
  });

  it('does not print an absence over rows that are on screen', () => {
    registry.byUrl = { [USERS]: staleRead(rows), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(screen.queryByText('No users found')).toBeNull();
  });
});

describe('the identity read is not trusted while it has not answered (#2872 rule 1)', () => {
  it('stops claiming which account is yours, and says why', () => {
    registry.byUrl = { [USERS]: ok(rows), [ME]: failed('Request failed (503)') };
    wrapped(<UsersPage />);
    expect(screen.queryByText('YOU')).toBeNull();
    expect(alerts()).toMatch(/which account is yours/i);
    expect(alerts()).toContain('Request failed (503)');
  });

  it('does not offer the operator\'s own account as a transfer target it cannot identify', () => {
    registry.byUrl = { [USERS]: ok(rows), [ME]: failed('Request failed (503)') };
    wrapped(<UsersPage />);
    openTransferPanel();
    expect(screen.queryByRole('option', { name: /Ada Operator/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Bob Clerk/ })).toBeNull();
  });

  it('does not count your own account as another super admin', () => {
    registry.byUrl = { [USERS]: ok(rows), [ME]: failed('Request failed (503)') };
    wrapped(<UsersPage />);
    openTransferPanel();
    // 2 admins exist, 1 of them is you — and "you" is exactly what this read cannot say.
    expect(screen.queryByText(/other super admin/)).toBeNull();
  });

  it('retries the identity read', () => {
    const result = failed('Request failed (503)');
    registry.byUrl = { [USERS]: ok(rows), [ME]: result };
    wrapped(<UsersPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('marks you, spare the transfer list, and counts the other admin once the read answers', () => {
    registry.byUrl = { [USERS]: ok(rows), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    expect(screen.getByText('YOU')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    openTransferPanel();
    expect(screen.getByRole('option', { name: /Bob Clerk/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Carl Owner/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Ada Operator/ })).toBeNull();
    expect(screen.getByText(/There are 1 other super admin/)).toBeTruthy();
  });

  it('deactivation stays available for accounts the identity read can place', () => {
    registry.byUrl = { [USERS]: ok(rows), [ME]: ok({ data: { userId: 'u1' } }) };
    wrapped(<UsersPage />);
    // Bob: not you, not suspended, not a super admin.
    expect(screen.getAllByRole('button', { name: /deactivate/i })).toHaveLength(1);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/users/page.tsx';

  it('splits the two states apart and keeps the rows under the stale branch', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src, 'the outage is still not separated from the stale read').toMatch(/Boolean\(usersQuery\.error\) && !usersQuery\.data/);
    expect(src, 'the page still cannot say it is holding the last read').toMatch(/const stale = Boolean\(/);
    expect(src, 'the stale branch never reaches the screen').toMatch(/\{stale&&\(/);
  });

  it('drives the roster line off the outage, not off any error', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src, 'the header still dashes the counts on a stale read').not.toMatch(/usersQuery\.error\s*\?\s*'—'/);
    expect(src).toMatch(/failed\s*\?\s*'—'\s*:\s*users\.length/);
    // The outage banner used to be the `error && nothing to show` arm; `failed` is that arm with
    // the stale read taken out of it. The absence sentence still refuses to fire on *any* error,
    // which is why it keeps its `!usersQuery.error` guard.
    expect(src, 'the outage banner is still reached by a stale read with no rows').not.toMatch(/!loading&&usersQuery\.error&&!filtered\.length/);
    expect(src).toMatch(/\{failed&&\(/);
  });

  it('only reads the candidate list and the admin count from an identity it actually has', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    // Both are derived from `me?.userId`, which is `undefined` for a read that failed — so the
    // page compared every id against undefined and concluded you were somebody else.
    expect(src, 'the transfer candidate list is still built over an unread identity')
      .not.toMatch(/users\.filter\(u => u\.id !== me\?\.userId\)/);
    expect(src).toMatch(/const transferTargets = me \? users\.filter/);
    expect(src).toMatch(/const otherAdmins = transferTargets\.filter/);
    expect(src).toMatch(/\{transferTargets\.map\(/);
  });

  it('keeps #2829\'s guard green with the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files, 'a page belongs on the baseline only if a reviewed PR says why').toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    const withoutStale = src
      .replace(/\n\s*\{\s*stale&&\([\s\S]*?\n\s*\)\}\n/g, '\n')
      .replace(/const stale = [^\n]*\n/g, '');
    expect(withoutStale, 'the stale block changed shape, update this check').not.toBe(src);
    expect(inspect(FILE, withoutStale).offends, 'the guard would now see this page').toBe(false);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = readFileSync(join(ROOT, FILE), 'utf8').split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
