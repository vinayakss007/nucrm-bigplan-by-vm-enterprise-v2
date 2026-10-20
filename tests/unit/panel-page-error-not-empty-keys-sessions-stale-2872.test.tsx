// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — two tenant panels that judge their one read by that read's error flag alone:
 * `app/tenant/settings/api-keys/page.tsx` (`/api/tenant/api-keys`) and
 * `app/tenant/settings/sessions/page.tsx` (`/api/user/sessions`).
 *
 * Both panels reload their own query key at the end of every write they offer — creating
 * a key, revoking a key, revoking one session, "Sign out all others" — so a refused
 * refresh is the ordinary state right after the operator acted, not an exotic one.
 * `useApiQuery` keeps `data` when a revalidation of an already-answered query fails, and
 * both pages consulted `error` only inside their "no rows" branch, which left two wrong
 * screens: with rows in hand the refusal went unmentioned, so the key just revoked and the
 * device just signed out stayed listed as if they were still live (and the key just created
 * was simply absent), while a last read that had come back empty got the outage card —
 * "could not check" where the honest answer is "none, as of the last read". #2829 fixed the
 * read-that-never-answered half of this and this slice keeps it: the outage copy, the hidden
 * empty sentence and the retry are exactly right when there is nothing to keep.
 *
 * The distinction each page must now draw is in the copy, so it is what is asserted: a
 * stale read says the rows below are the last read and names what a write since the fetch
 * would not be reflected in them; a never-answered read says this is a failed request and
 * not an empty list, and must not claim a last read it does not have.
 *
 * `scripts/check-panel-error-state.mjs` reports both files clean before and after the
 * split is rewound — the sweep asks whether a panel binds an error and renders a banner,
 * and both did that already. That is the point of the anti-vacuity case at the bottom.
 *
 * Fixtures are documentation-only (TEST-NET addresses, synthetic key prefixes).
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

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
}));

import ApiKeysPage from '@/app/tenant/settings/api-keys/page';
import SessionsPage from '@/app/tenant/settings/sessions/page';

const KEYS = '/api/tenant/api-keys';
const SESSIONS = '/api/user/sessions';

const CREATED = '2026-01-04T00:00:00.000Z';
const keyRows = {
  data: [
    { id: 'k1', name: 'Reporting integration', key_prefix: 'nucrm_abc', scopes: ['leads:read'], is_active: true, created_at: CREATED, last_used_at: null, expires_at: null },
    { id: 'k2', name: 'Website form bridge', key_prefix: 'nucrm_def', scopes: ['contacts:write'], is_active: true, created_at: CREATED, last_used_at: null, expires_at: null },
  ],
};
const sessionRows = {
  data: [
    { id: 's1', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0', ip_address: '198.51.100.24', is_current: true, created_at: CREATED },
    { id: 's2', user_agent: 'Mozilla/5.0 (iPhone) Firefox/121.0', ip_address: '203.0.113.9', is_current: false, created_at: CREATED },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const mount = (node: ReactNode) => {
  cleanup();
  // The writes reach the network through fetch/apiFetch; nothing here clicks one, but a
  // jsdom "fetch is not implemented" throw would be a lie about the page.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  return render(tree(node));
};

describe('api keys: a refused refresh after a write keeps the list (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [KEYS]: staleRead(keyRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both keys on screen and says the list is the last read', () => {
    mount(<ApiKeysPage />);
    expect(screen.getByText('Reporting integration')).toBeTruthy();
    expect(screen.getByText('Website form bridge')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('keeps the revoke control of every key it is still showing', () => {
    const { container } = mount(<ApiKeysPage />);
    expect(container.querySelectorAll('button[class*="hover:bg-red-50"]').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /^New Key$/i }));
    expect(screen.getByRole('button', { name: /create key/i })).toBeTruthy();
  });

  it('does not call the kept keys a failed load, nor an empty list', () => {
    mount(<ApiKeysPage />);
    expect(alerts()).not.toMatch(/this is a failed request, not an empty list/);
    expect(screen.queryByText(/No API keys yet/)).toBeNull();
  });

  it('re-runs the keys read from the caveat', () => {
    mount(<ApiKeysPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[KEYS].refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [KEYS]: staleRead(keyRows, '') };
    mount(<ApiKeysPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Reporting integration')).toBeTruthy();
  });

  it('still shows the outage for a read that never answered', () => {
    registry.byUrl = { [KEYS]: failed('Request failed (503)') };
    mount(<ApiKeysPage />);
    expect(screen.queryByText('Reporting integration')).toBeNull();
    expect(screen.queryByText(/No API keys yet/)).toBeNull();
    expect(alerts()).toContain(
      "Could not load this workspace's API keys — this is a failed request, not an empty list. Request failed (503)",
    );
    expect(alerts()).not.toMatch(/last read/);
  });

  it('says none exist, with no alert, when that is what came back', () => {
    registry.byUrl = { [KEYS]: ok({ data: [] }) };
    mount(<ApiKeysPage />);
    expect(screen.getByText(/No API keys yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { [KEYS]: staleRead({ data: [] }) };
    mount(<ApiKeysPage />);
    expect(screen.getByText(/No API keys yet/)).toBeTruthy();
    // The caveat is what separates "none exist" from "I could not check".
    expect(alerts()).toMatch(/last read/i);
  });

  it('renders the keys with no alert when the read answered', () => {
    registry.byUrl = { [KEYS]: ok(keyRows) };
    mount(<ApiKeysPage />);
    expect(screen.getByText('Reporting integration')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('sessions: a refused refresh after a sign-out keeps the roster (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [SESSIONS]: staleRead(sessionRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both sessions on screen and says the roster is the last read', () => {
    mount(<SessionsPage />);
    expect(screen.getByText('Chrome')).toBeTruthy();
    expect(screen.getByText('Firefox')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('keeps the controls the kept rows offer', () => {
    mount(<SessionsPage />);
    expect(screen.getByRole('button', { name: /sign out all others/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('does not call the kept sessions a failed load, nor an empty list', () => {
    mount(<SessionsPage />);
    expect(alerts()).not.toMatch(/this is a failed request, not an empty list/);
    expect(screen.queryByText(/No sessions found/)).toBeNull();
  });

  it('re-runs the sessions read from the caveat', () => {
    mount(<SessionsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SESSIONS].refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [SESSIONS]: staleRead(sessionRows, '') };
    mount(<SessionsPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Firefox')).toBeTruthy();
  });

  it('still shows the outage for a read that never answered', () => {
    registry.byUrl = { [SESSIONS]: failed('Request failed (503)') };
    mount(<SessionsPage />);
    expect(screen.queryByText('Firefox')).toBeNull();
    expect(screen.queryByText(/No sessions found/)).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out all others/i })).toBeNull();
    expect(alerts()).toContain(
      'Could not load your active sessions — this is a failed request, not an empty list. Request failed (503)',
    );
    expect(alerts()).not.toMatch(/last read/);
  });

  it('says none are signed in, with no alert, when that is what came back', () => {
    registry.byUrl = { [SESSIONS]: ok({ data: [] }) };
    mount(<SessionsPage />);
    expect(screen.getByText(/No sessions found/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none are signed in when the empty list is all the last read has', () => {
    registry.byUrl = { [SESSIONS]: staleRead({ data: [] }) };
    mount(<SessionsPage />);
    expect(screen.getByText(/No sessions found/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('renders the roster with no alert when the read answered', () => {
    registry.byUrl = { [SESSIONS]: ok(sessionRows) };
    mount(<SessionsPage />);
    expect(screen.getByText('Firefox')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/settings/api-keys/page.tsx', 'app/tenant/settings/sessions/page.tsx'];
  const src = (file: string) => readFileSync(join(ROOT, file), 'utf8');

  it('splits each read instead of branching on one flag', () => {
    for (const [file, name] of [
      [FILES[0], 'keys'],
      [FILES[1], 'sessions'],
    ] as const) {
      const s = src(file);
      expect(s, `${name} never learned the difference`).toMatch(new RegExp(`Boolean\\(${name}Error\\) && !data`));
      expect(s).toMatch(new RegExp(`Boolean\\(${name}Error\\) && Boolean\\(data\\)`));
      expect(s).toMatch(new RegExp(`${name}Error\\?\\.message \\|\\| 'no response from the server'`));
      expect(s, `${name}Stale is computed and never rendered`).toMatch(new RegExp(`\\{${name}Stale && \\(`));
    }
  });

  it('never hides kept rows behind the bare flag', () => {
    for (const [file, name] of [
      [FILES[0], 'keys'],
      [FILES[1], 'sessions'],
    ] as const) {
      const s = src(file);
      expect(s, 'a list still replaces kept rows with the outage card').not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
      expect(s, 'the outage card is still reached on the bare flag').not.toMatch(/:\s*\w*[Ee]rror \?\s*\(/);
      expect(s).toMatch(new RegExp(`${name}Failed \\? \\(`));
    }
  });

  it('reports both pages clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, RegExp, string][] = [
      [FILES[0], /const keysFailed = Boolean\(keysError\) && !data;\s*\n\s*const keysStale = Boolean\(keysError\) && Boolean\(data\);/, 'const keysFailed = Boolean(keysError);'],
      [FILES[1], /const sessionsFailed = Boolean\(sessionsError\) && !data;\s*\n\s*const sessionsStale = Boolean\(sessionsError\) && Boolean\(data\);/, 'const sessionsFailed = Boolean(sessionsError);'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `the shape this slice depends on moved: ${file}`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    for (const f of FILES) expect(files, `${f} went back on the list it was never on`).not.toContain(f);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps both files inside the size ceiling', () => {
    for (const f of FILES) expect(src(f).split('\n').length, `past the 500-line ceiling: ${f}`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
