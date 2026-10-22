// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `tenant/settings/bulk-transfer` (4 reads, no error branch at all before this).
 *
 * Members, current-user (admin gate), teams and the per-owner preview counts were each
 * read with `useApiQuery` and bound only on `data`. `useApiQuery` keeps `data` through a
 * refused revalidation (`lib/query/client.tsx`), so a failed roster rendered an empty
 * picker (a false "no teammates"), a failed admin read fell through to the tool, a failed
 * teams read silently dropped the team tag, and — worst — a failed *preview* read printed
 * `0` in every per-resource card and disabled them, telling the operator "this teammate
 * owns nothing" when the request simply never answered.
 *
 * Measured by running this suite before/after the fix (origin/main's copy restored to a
 * scratch dir for the RED run):
 *   BEFORE — red 12 / green 2 of 14. The page bound no error at all and printed `0`
 *     counts over an unanswered read; only the guard-green ratchet and the fully-answered
 *     silence passed.
 *   AFTER  — red 0 / green 14.
 *
 * House rule applied: derived counts print `—`, never `0`, when their read has not
 * answered; a stale read keeps its rows and stays clickable.
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_m: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import BulkTransferPage from '@/app/tenant/settings/bulk-transfer/page';

const MEMBERS = '/api/tenant/members';
const ME = '/api/tenant/me';
const TEAMS = '/api/tenant/teams';
const FID = 'usr-192.0.2.20';
const PREVIEW = `/api/tenant/admin/bulk-transfer?from_user_id=${FID}&only_open=true`;

// RFC 2606 hostnames + TEST-NET-style ids: public repo, no real data.
const membersAnswer = {
  data: [
    { userId: FID, fullName: 'Ada Leaving', email: 'ada@example.test', roleSlug: 'member' },
    { userId: 'usr-203.0.113.7', fullName: 'Bob Receiving', email: 'bob@example.test', roleSlug: 'member' },
  ],
};
const meAdmin = { user: { id: 'usr-198.51.100.10' }, is_admin: true };
const teamsAnswer = { data: [{ id: 'team-203.0.113.4', name: 'West Coast' }] };
const previewAnswer = { counts: { leads: 12, contacts: 5, deals: 3, tasks: 7, tickets: 1 } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

// Every healthy baseline; a single test then swaps one read to failed/stale.
const healthy = (): Record<string, QueryResult> => ({
  [MEMBERS]: ok(membersAnswer), [ME]: ok(meAdmin), [TEAMS]: ok(teamsAnswer), [PREVIEW]: ok(previewAnswer),
});

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const chooseFromUser = (container: HTMLElement) => {
  fireEvent.change(within(container).getAllByRole('combobox')[0], { target: { value: FID } });
};

describe('bulk-transfer roster: a failed read is not an empty team (#2872)', () => {
  beforeEach(() => { registry.byUrl = healthy(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('names the roster outage instead of offering an empty picker', () => {
    registry.byUrl[MEMBERS] = failed('Request failed (500)');
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/teammates|teammate list/i);
    expect(alerts()).toMatch(/Request failed \(500\)/);
    expect(alerts()).toMatch(/failed request|not a workspace with no one/i);
    expect(alerts()).not.toMatch(/last read/i);
  });

  it('keeps the picker and calls a refused refresh the last read', () => {
    registry.byUrl[MEMBERS] = staleRead(membersAnswer);
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The teammate the read kept is still offered in the picker (FROM and TO selects).
    expect(screen.getAllByText(/Ada Leaving/).length).toBeGreaterThan(0);
  });

  it('re-runs the roster read and issues no write', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    registry.byUrl[MEMBERS] = staleRead(membersAnswer);
    const { container } = wrapped(<BulkTransferPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /teammate/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[MEMBERS].refetch).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    void container;
    vi.unstubAllGlobals();
  });
});

describe('bulk-transfer admin gate: an unanswered role read is not a permission (#2872)', () => {
  beforeEach(() => { registry.byUrl = healthy(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('says it could not confirm your role instead of falling through silently', () => {
    registry.byUrl[ME] = failed('Request failed (503)');
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/confirm.*role|role.*failed/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    // The transfer tool stays on screen — the server enforces admin, the read just could not tell us.
    expect(screen.getByText('Bulk Transfer')).toBeTruthy();
  });
});

describe('bulk-transfer teams: a refused refresh keeps the team tag, an outage names itself (#2872)', () => {
  beforeEach(() => { registry.byUrl = healthy(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('marks the missing team tag as a failed read, not "no teams"', () => {
    registry.byUrl[TEAMS] = failed('Request failed (500)');
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/team/i);
    expect(alerts()).toMatch(/Request failed \(500\)/);
  });

  it('keeps the team option and flags it the last read', () => {
    registry.byUrl[TEAMS] = staleRead(teamsAnswer);
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(screen.getByText('West Coast')).toBeTruthy();
  });
});

describe('bulk-transfer preview counts: print —, never 0, when the read has not answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = healthy(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows em-dashes and the outage phrase, not zeros, when the preview failed', () => {
    registry.byUrl[PREVIEW] = failed('Request failed (502)');
    const { container } = wrapped(<BulkTransferPage />);
    chooseFromUser(container);
    expect(alerts()).toMatch(/owns nothing|not a teammate who owns nothing|failed request/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(alerts()).not.toMatch(/last read/i);
  });

  it('keeps the numbers and marks them the last read on a refused refresh', () => {
    registry.byUrl[PREVIEW] = staleRead(previewAnswer, 'Request failed (503)');
    const { container } = wrapped(<BulkTransferPage />);
    chooseFromUser(container);
    expect(screen.getByText('12')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    // Operable: the stale counts still allow a transfer — the action stays clickable.
    expect(screen.getByRole('button', { name: /transfer .*record/i })).toBeTruthy();
  });

  it('shows the real numbers with no alert when the preview answered', () => {
    const { container } = wrapped(<BulkTransferPage />);
    chooseFromUser(container);
    expect(screen.getByText('12')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('re-runs the preview read from the outage banner', () => {
    registry.byUrl[PREVIEW] = failed('Request failed (502)');
    const { container } = wrapped(<BulkTransferPage />);
    chooseFromUser(container);
    const banner = screen.queryAllByRole('alert').find((el) => /owns nothing|preview|count/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PREVIEW].refetch).toHaveBeenCalled();
  });
});

describe('bulk-transfer: fallback text and the fully-answered page (#2872)', () => {
  beforeEach(() => { registry.byUrl = healthy(); vi.clearAllMocks(); });
  afterEach(cleanup);

  it('prints the fallback reason for a messageless error, never "undefined"', () => {
    registry.byUrl[MEMBERS] = failed('');
    wrapped(<BulkTransferPage />);
    expect(alerts()).toMatch(/no response from the server/i);
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('stays silent when every read answered', () => {
    wrapped(<BulkTransferPage />);
    expect(alerts()).toBe('');
    expect(screen.getAllByText(/Ada Leaving/).length).toBeGreaterThan(0);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/bulk-transfer/page.tsx';

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
