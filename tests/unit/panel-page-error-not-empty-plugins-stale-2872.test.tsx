// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `tenant/plugins`: the other half of the read.
 *
 * The page binds `error` as `pluginsError` and had a single failure branch, reached only when
 * there were NO rows:
 *
 *     plugins.length === 0 ? (pluginsError ? <InlineErrorState …/> : <"No plugins yet" card>) : <rows/>
 *
 * So #2829 already closed the never-answered half (a refused first read → outage card, no false
 * "No plugins yet"). The defect left is the silent one: create / edit(toggle) / delete / test /
 * execute each call `loadPlugins()` → `invalidateQueries({ queryKey: PLUGINS_QUERY })`, and
 * `useApiQuery` KEEPS `data` when a revalidation of an already-succeeded read fails. After any
 * save whose refresh is refused, the rows stay on screen and NOTHING says they are a kept read —
 * the toggle the operator just flipped, the plugin they just made, or the one they just deleted
 * all look settled when they may not be. Worse, the outage banner interpolated `pluginsError.message`
 * raw, and an `ApiQueryError` with no message renders the word `undefined`.
 *
 * The split: `failed = Boolean(error) && !data` keeps the outage card (#2829's word-for-word
 * contract, now via `reason`); `stale = Boolean(error) && Boolean(data)` keeps the rows under a
 * `role="alert"` caveat that names what the refusal may not reflect. The tab count is derived off
 * the read, so a payload the read never answered prints `—`, not `0`. And the absence sentence is
 * gated off a stale read: after a create whose refresh was refused, `data` is a kept payload with
 * rows, so "No plugins yet / Create your first plugin" is a lie — and when the LAST read answered
 * zero (`data` present but empty) and the refresh was refused, the caveat says "the last read,
 * which had none — a plugin created since then may not appear here" rather than telling the
 * operator to create the first one they may already have.
 *
 * Not touched here: the per-plugin execution logs (`:loadLogs`, a raw on-demand `fetch` into local
 * state, not a `useApiQuery` read that keeps data through a refused revalidation) and the Templates
 * tab (a module-constant catalogue, no read). Neither has this defect, so neither gets a state pair
 * — one read's silence is not this slice's to break. PR #3020 admin-gated the five write/execute
 * endpoints; the page prints no role affordance today and this slice invents none.
 *
 * RED AT BASE — measured against the unfixed page (`app/tenant/plugins/page.tsx` at origin/main,
 * this file as committed): **7 failed | 6 passed (13)**. The seven that fail are every stale half
 * (rows-kept caveat, empty-last-read refusal, message-less refusal), the outage count-dash case,
 * the raw-`undefined` interpolation on the never-answered outage card, and the two source ratchets
 * that cannot match until the split exists. The six that pass are the controls that must keep
 * passing: the kept rows stay actionable, the healthy rows and healthy-empty reads, the
 * guard-still-green and line-ceiling cases, and the overlap pin. After the split: **13 passed (13)**.
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import PluginsPage from '@/app/tenant/plugins/page';

const PLUGINS = '/api/tenant/plugins';
const NOW = new Date('2026-10-18T09:00:00.000Z').toISOString();

const pluginRows = {
  data: [
    { id: 'pl-1', name: 'Fleet telemetry', description: null, baseUrl: 'https://api.northwind.test/v1', authType: 'bearer', actions: [{ id: 'a1', name: 'Ping', method: 'GET', path: '/ping' }], status: 'active', createdAt: NOW },
    { id: 'pl-2', name: 'Warehouse sync', description: null, baseUrl: 'https://api.contoso.test/v2', authType: 'none', actions: [], status: 'disabled', createdAt: NOW },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** The read never answered — #2829's outage half. */
const outage = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` NOT inside an alert. The caveat block replaces the outage banner, so a bare
 * `queryByText(/Failed to load your plugins/)` would find the retired banner's own words if the
 * replacement ever quoted them; this proves the claim left the non-alert parts of the page.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('plugins: a refused reload keeps the rows and says so (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both plugins under a last-read caveat that names what the refusal may hide', () => {
    const read = staleRead(pluginRows);
    registry.byUrl = { [PLUGINS]: read };
    wrapped(<PluginsPage />);
    expect(screen.getByText('Fleet telemetry')).toBeTruthy();
    expect(screen.getByText('Warehouse sync')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the plugins');
    expect(alerts()).toContain('the list below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('created, edited, deleted or tested');
    // The outage banner is the wrong claim over kept rows — and it must not reappear.
    expect(claimsOutsideAlerts(/Failed to load your plugins/)).toEqual([]);
    // …nor the absence sentence, which would say there are none while two are on screen.
    expect(claimsOutsideAlerts(/No plugins yet/)).toEqual([]);
    // The tab count is derived off the read, so a kept read still prints its own number.
    expect(screen.getByRole('button', { name: /My Plugins \(2\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the kept rows are still actionable — a last read does not freeze the panel', () => {
    registry.byUrl = { [PLUGINS]: staleRead(pluginRows) };
    wrapped(<PluginsPage />);
    // A toggle is a row control, not a re-read; the operator can still work what is on screen.
    const toggles = screen.getAllByRole('switch');
    expect(toggles).toHaveLength(2);
    expect(toggles[0].hasAttribute('disabled')).toBe(false);
  });

  it('a refused refresh over an empty last read does NOT prompt to create the first plugin', () => {
    // `data` is `{ data: [] }`: the previous read legitimately returned zero, then the refresh was
    // refused. "No plugins yet / Create your first plugin" would be a lie if a create landed and
    // this refresh was refused, so the absence sentence is gated and the caveat says the truth.
    registry.byUrl = { [PLUGINS]: staleRead({ data: [] }) };
    wrapped(<PluginsPage />);
    expect(claimsOutsideAlerts(/No plugins yet/)).toEqual([]);
    expect(claimsOutsideAlerts(/Create your first plugin/)).toEqual([]);
    expect(claimsOutsideAlerts(/Failed to load your plugins/)).toEqual([]);
    expect(alerts()).toContain('Could not refresh the plugins');
    expect(alerts()).toContain('the last read, which had none');
    expect(screen.getByRole('button', { name: /My Plugins \(0\)/ })).toBeTruthy();
  });

  it('a refusal with no message falls back to a sentence, not the word undefined', () => {
    registry.byUrl = { [PLUGINS]: staleRead(pluginRows, '') };
    wrapped(<PluginsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('plugins: the never-answered half stays an outage (#2872 / #2829)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a read that never answered prints the outage card, no rows, and no absence sentence', () => {
    registry.byUrl = { [PLUGINS]: outage('Request failed (500)') };
    wrapped(<PluginsPage />);
    expect(screen.queryByText('Fleet telemetry')).toBeNull();
    expect(claimsOutsideAlerts(/No plugins yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load your plugins: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
    // A count the payload never answered is `—`, never a false `0`.
    expect(screen.getByRole('button', { name: /My Plugins \(—\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PLUGINS].refetch).toHaveBeenCalledTimes(1);
  });

  it('a message-less never-answered read still says so, not undefined', () => {
    registry.byUrl = { [PLUGINS]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    wrapped(<PluginsPage />);
    expect(alerts()).toContain('Failed to load your plugins: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('plugins: the healthy states say nothing about freshness (controls)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a read that answers with rows prints them, no alert, real count', () => {
    registry.byUrl = { [PLUGINS]: ok(pluginRows) };
    wrapped(<PluginsPage />);
    expect(screen.getByText('Fleet telemetry')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/No plugins yet/)).toEqual([]);
    expect(screen.getByRole('button', { name: /My Plugins \(2\)/ })).toBeTruthy();
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [PLUGINS]: ok({ data: [] }) };
    wrapped(<PluginsPage />);
    expect(screen.getByText('No plugins yet')).toBeTruthy();
    expect(screen.getByText(/Create your first plugin/)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.getByRole('button', { name: /My Plugins \(0\)/ })).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/plugins/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the two states apart and stops interpolating the raw message', () => {
    const s = src();
    expect(s, 'never separates the outage from the stale read').toMatch(/const failed = Boolean\(pluginsError\) && !data/);
    expect(s, 'keeps the rows without saying they are the last read').toMatch(/const stale = Boolean\(pluginsError\) && Boolean\(data\)/);
    expect(s, 'prints a raw error that can be undefined').toMatch(/const reason = pluginsError\?\.message \|\| 'no response from the server'/);
    // The old bare-flag branch (`pluginsError ? <InlineErrorState …/>`) and the raw
    // `${pluginsError.message}` are gone — tightened so it does not collide with the
    // legitimate `pluginsError?.message` in the `reason` line.
    expect(s, 'still branches the failure on the bare flag').not.toMatch(/pluginsError\s*\?\s*<InlineErrorState/);
    expect(s, 'still interpolates the raw message').not.toMatch(/pluginsError\.message/);
    expect(s, 'warns over the rows without a stale block').toMatch(/\{stale && \(/);
    // The absence sentence is gated so it cannot fire during a stale read.
    expect(s, 'the empty card is not gated off a stale read').toMatch(/stale \? null :/);
    // A count the payload never answered is dashed, not zero.
    expect(s, 'the tab count still prints a false 0 on an unanswered read').toMatch(/data \? plugins\.length : '—'/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(44);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    expect(files, `${FILE} has no business on the baseline`).not.toContain(FILE);
  });

  it('would not have been caught by the guard if the stale caveat were deleted', async () => {
    // The page already passes #2829's guard (it binds error and renders InlineErrorState). Deleting
    // the stale caveat leaves it guard-clean — so this suite, not the guard, is the only thing
    // standing between a rewind of the split and CI.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    const withoutStale = s
      .replace(/\n\s*\{stale && \([\s\S]*?\)\}\n/g, '\n')
      .replace(/const stale = [^\n]*\n/g, '');
    expect(withoutStale, 'the stale block changed shape, update this check').not.toBe(s);
    expect(inspect(FILE, withoutStale).offends, 'the page would now be visible to the guard').toBe(false);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('does not put #2872 words about a kept read into the #2829 suite on this page', () => {
    // Overlap hygiene: that table-driven file pins the never-answered half of this same page. If it
    // started asserting the stale copy too, this slice would be double-claiming its ground.
    const t = 'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx';
    expect(readFileSync(join(ROOT, t), 'utf8'), `${t} now speaks about a last read`).not.toMatch(/last read/);
  });
});
