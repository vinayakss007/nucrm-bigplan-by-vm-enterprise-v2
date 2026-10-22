// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `tenant/settings` landing (2 reads, no error branch at all before this).
 *
 * The control center reads the current user (to decide which scopes an admin sees) and
 * the settings-health summary. Both were bound on `data` only. `useApiQuery` keeps `data`
 * through a refused revalidation, so:
 *   - a failed health read fell back to `EMPTY_SUMMARY` and printed `0 / 0 / 0` in the
 *     health chips — "nothing needs attention", the exact all-clear a failure must not
 *     hand out;
 *   - a failed role read collapsed `isAdmin` to `false` and quietly hid the admin scopes,
 *     reading as "this tenant has no admin settings."
 *
 * Measured by running this suite before/after the fix (origin/main's copy restored to a
 * scratch dir for the RED run):
 *   BEFORE — red 7 / green 3 of 10 (the guard-green ratchet, the fully-answered silence,
 *     and the messageless-free pass because no banner rendered at all).
 *   AFTER  — red 0 / green 10.
 *
 * House rule applied: derived counts print `—`, never `0`, when their read has not
 * answered; the search "No settings match" sentence stays because it is driven by the
 * operator's typed query, not by either read.
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

import SettingsIndex from '@/app/tenant/settings/page';

const ME = '/api/tenant/me';
const STATUS = '/api/tenant/settings-status';

const adminMe = { is_admin: true };
const healthAnswer = {
  statuses: {},
  summary: { configured: 7, default: 2, attention: 1, unknown: 0 },
};

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

describe('settings health summary: print —, never 0, when the read has not answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ME]: ok(adminMe), [STATUS]: ok(healthAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('names the outage and shows em-dashes instead of a false all-clear', () => {
    registry.byUrl[STATUS] = failed('Request failed (503)');
    wrapped(<SettingsIndex />);
    expect(alerts()).toMatch(/settings health summary/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(alerts()).not.toMatch(/last read/i);
  });

  it('keeps the last counts and flags them the last read on a refused refresh', () => {
    registry.byUrl[STATUS] = staleRead(healthAnswer, 'Request failed (502)');
    wrapped(<SettingsIndex />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('re-runs the summary read and issues no write', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    registry.byUrl[STATUS] = failed('Request failed (503)');
    wrapped(<SettingsIndex />);
    const banner = screen.queryAllByRole('alert').find((el) => /health summary/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[STATUS].refetch).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('prints the real summary with no alert when the read answered', () => {
    wrapped(<SettingsIndex />);
    expect(screen.getByText('7')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('settings role read: an unanswered admin gate is not "no admin settings" (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ME]: ok(adminMe), [STATUS]: ok(healthAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('says it could not confirm your role instead of silently hiding the admin scopes', () => {
    registry.byUrl[ME] = failed('Request failed (500)');
    wrapped(<SettingsIndex />);
    expect(alerts()).toMatch(/confirm your role/i);
    expect(alerts()).toMatch(/Request failed \(500\)/);
    // Reachability: the control center still renders; only the caveat is added.
    expect(screen.getByRole('heading', { name: /settings/i })).toBeTruthy();
  });

  it('calls a refused refresh of the role the last read', () => {
    registry.byUrl[ME] = staleRead(adminMe);
    wrapped(<SettingsIndex />);
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('settings landing: fallback text and the fully-answered page (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ME]: ok(adminMe), [STATUS]: ok(healthAnswer) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('prints the fallback reason for a messageless error, never "undefined"', () => {
    registry.byUrl[STATUS] = failed('');
    wrapped(<SettingsIndex />);
    expect(alerts()).toMatch(/no response from the server/i);
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('stays silent when both reads answered', () => {
    wrapped(<SettingsIndex />);
    expect(alerts()).toBe('');
    expect(screen.getByRole('heading', { name: /settings/i })).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/page.tsx';

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
