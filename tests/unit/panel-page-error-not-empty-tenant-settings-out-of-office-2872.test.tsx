// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `tenant/settings/out-of-office` (3 reads, no error branch at all before this).
 *
 * The page read the out-of-office config, the teammate roster and the current user,
 * then bound only `data`/`isLoading` from each. `useApiQuery` keeps `data` through a
 * refused revalidation (`lib/query/client.tsx`), so the two opposite questions — the
 * read never answered, and the read answered once and its refresh was refused — were
 * both silently answered as "you are available / here are your teammates."
 *
 * Measured RED (against origin/main's copy of the page restored to a scratch dir) and
 * GREEN (after the fix), the numbers captured by running this suite before/after:
 *   BEFORE this slice — red 9 / green 2 of 11 cases. The page bound no error at all, so
 *     every outage/stale assertion failed and printed the false all-clear; only the
 *     guard-green ratchet and the fully-answered silence passed.
 *   AFTER  this slice — red 0 / green 11 of 11 cases.
 *
 * Convention per read: `failed = Boolean(error) && !data` (outage), `stale =
 * Boolean(error) && Boolean(data)` (kept rows, refused refresh), `reason =
 * error?.message || 'no response from the server'`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import OutOfOfficePage from '@/app/tenant/settings/out-of-office/page';

const CONFIG = '/api/user/out-of-office';
const MEMBERS = '/api/tenant/members';
const ME = '/api/tenant/me';

// RFC 2606 hostnames + TEST-NET-style ids: the repo is public, so no real data.
const configAnswer = {
  out_of_office: {
    enabled: true, start_date: '2026-03-01', end_date: '2026-03-10',
    delegate_user_id: 'usr-198.51.100.2', auto_reply: 'Away this week.', auto_reassign: false,
  },
};
const membersAnswer = {
  data: [
    { userId: 'usr-198.51.100.2', fullName: 'Ada Delegate', email: 'ada@example.test' },
    { userId: 'usr-203.0.113.7', fullName: 'Bob Backup', email: 'bob@example.test' },
  ],
};
const meAnswer = { user: { id: 'usr-192.0.2.10' } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('out-of-office config read: an outage never says "you are available" (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('reports the outage instead of seeding the editor with defaults', () => {
    registry.byUrl = { [CONFIG]: failed('Request failed (503)'), [MEMBERS]: ok(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/Could not load your out-of-office settings/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    // The false all-clear the slice retires: the editor is withheld on an outage so a
    // save cannot write DEFAULT over the stored config.
    expect(screen.queryByText(/No upcoming out-of-office/i)).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('keeps the form and calls the refused refresh the last read', () => {
    registry.byUrl = { [CONFIG]: staleRead(configAnswer), [MEMBERS]: ok(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // Not the outage wording — the config is on screen, it just stopped updating.
    expect(alerts()).not.toMatch(/this is a failed request/i);
    // The editor stays operable: a stale read must not disable the existing action.
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
  });

  it('re-runs the config read from the stale banner and issues no write', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    registry.byUrl = { [CONFIG]: staleRead(configAnswer), [MEMBERS]: ok(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    const banner = screen.queryAllByRole('alert').find((el) => /out-of-office settings/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CONFIG].refetch).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('out-of-office teammate roster: a failed read is not an empty workspace (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('names the roster failure at the delegate, while the rest of the form still works', () => {
    registry.byUrl = { [CONFIG]: ok(configAnswer), [MEMBERS]: failed('Request failed (500)'), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/Could not load your teammates/i);
    expect(alerts()).toMatch(/Request failed \(500\)/);
    expect(alerts()).toMatch(/not a workspace with no one/i);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
  });

  it('keeps the delegate options and marks them the last read', () => {
    registry.byUrl = { [CONFIG]: ok(configAnswer), [MEMBERS]: staleRead(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The teammate the read kept is still selectable.
    expect(screen.getByText('Out of Office')).toBeTruthy();
  });
});

describe('out-of-office current-user read: a refusal degrades self-exclusion honestly (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('says it could not confirm who you are instead of guessing', () => {
    registry.byUrl = { [CONFIG]: ok(configAnswer), [MEMBERS]: ok(membersAnswer), [ME]: failed('Request failed (502)') };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/Could not confirm which teammate you are/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
  });

  it('re-runs the identity read, not the config read a sibling section shares the key with', () => {
    registry.byUrl = { [CONFIG]: ok(configAnswer), [MEMBERS]: ok(membersAnswer), [ME]: failed() };
    wrapped(<OutOfOfficePage />);
    const banner = screen.queryAllByRole('alert').find((el) => /which teammate you are/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ME].refetch).toHaveBeenCalled();
    expect(registry.byUrl[CONFIG].refetch).not.toHaveBeenCalled();
  });
});

describe('out-of-office: the fallback text and the healthy read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('prints the fallback reason for a messageless error, never "undefined"', () => {
    registry.byUrl = { [CONFIG]: failed(''), [MEMBERS]: ok(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toMatch(/no response from the server/i);
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('stays silent when every read answered', () => {
    registry.byUrl = { [CONFIG]: ok(configAnswer), [MEMBERS]: ok(membersAnswer), [ME]: ok(meAnswer) };
    wrapped(<OutOfOfficePage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('Out of Office')).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/out-of-office/page.tsx';

  it('splits the two states apart and keeps the fallback text', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src).toMatch(/Boolean\(\w*[Ee]rror\) && !/);
    expect(src).toMatch(/&& Boolean\(/);
    expect(src).toMatch(/\.message \|\| 'no response from the server'/);
    expect(src).not.toMatch(/if \(\w*[Ee]rror\)\s*toast\.error/);
  });

  it('keeps #2829\'s guard green, with no new baseline entry', () => {
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout + res.stderr).not.toContain(FILE);
  });
});
