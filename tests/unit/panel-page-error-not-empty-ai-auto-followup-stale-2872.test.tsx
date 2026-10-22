// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/ai-auto-followup/page.tsx`, the settings page that folds
 * its read and its write into one variable.
 *
 * The page reads a config and PATCHes that same config, and it printed both failures from
 * `const displayError = error ?? loadErrorMessage` — one branch, one voice. So a refresh
 * refused AFTER a save (`onSuccess` invalidates the page's own key — the ordinary state,
 * not an exotic one) announced itself with the mutation's channel, and the two could mask
 * each other depending on which was non-null. It also reached for `loadError.info.error`,
 * guessing at the response body instead of reading what `ApiQueryError` actually carries.
 *
 * Second finding, specific to a settings page: `autoAiEnabled = data?.autoAiEnabled ?? false`
 * seeded a DEFAULT over a read that never answered, and the toggle was live — clicking it
 * PATCHed `!false`, enabling auto follow-up for a tenant whose actual setting the page had
 * failed to read. The outage half of the fix therefore suppresses the form inside the branch
 * that already owns that region (the `loading ?` ternary in the card), so there is no default
 * to save; the stale half keeps the config the page actually read, with the caveat above it.
 * Save/toggle is gated on the OUTAGE, never on staleness — a stale toggle still writes the
 * tenant's own last-known state, and the caveat says what that costs.
 *
 * `scripts/check-panel-error-state.mjs` cannot see any of this: the page bound `error` and
 * rendered a banner before this slice. The anti-vacuity case rewinds the split and the guard
 * still reports the file clean, which is the proof these assertions, not the sweep, hold it.
 *
 * Fixtures are documentation-only (RFC 2606 names, TEST-NET ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
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

// Deliberately a passthrough of the hook result, NOT a runner of the fetch: the whole point
// of the outage cases is that the page's own `?? false` seed must not be what decides
// whether the read answered.
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import AIAutoFollowupPage from '@/app/tenant/settings/ai-auto-followup/page';

const SETTINGS = '/api/tenant/admin/ai-auto-followup';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not — the state the folded `displayError` could not express. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** The toggle is the page's write; its visual state is the config the read seeded. */
const toggleSwitch = (): HTMLButtonElement | undefined => {
  const label = [...document.querySelectorAll('label')].find(
    (el) => el.textContent?.includes('Enable AI Auto-Follow-Up'),
  );
  return label?.querySelector('button') ?? undefined;
};
/** The knob sits right when the read said enabled — the tenant's real value, not the `?? false`. */
const toggleIsOn = () => (toggleSwitch()?.className ?? '').includes('bg-violet-600');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** Rejects every mutation while leaving the reads to the registry. */
const refusedWrite = (message: string) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 500, json: async () => ({ error: message }),
  } as Response));
/** The mutation's own rejection reaches the page one tick after the click resolves. */
const settledWith = (copy: RegExp) =>
  waitFor(() => expect(alerts()).toMatch(copy), { interval: 10 });

describe('healthy read: the form shows the config the tenant actually has', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('seeds the toggle from the read, in both directions, and says nothing', () => {
    registry.byUrl = { [SETTINGS]: ok({ autoAiEnabled: true }) };
    wrapped(<AIAutoFollowupPage />);
    expect(toggleIsOn()).toBe(true);
    expect(alerts()).toBe('');
    cleanup();
    registry.byUrl = { [SETTINGS]: ok({ autoAiEnabled: false }) };
    wrapped(<AIAutoFollowupPage />);
    expect(toggleIsOn()).toBe(false);
    expect(screen.getByText('Enable AI Auto-Follow-Up')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('outage: a read that never answered suppresses the form, not the other way round', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('names the failure once and never presents the default as the tenant\'s configuration', () => {
    registry.byUrl = { [SETTINGS]: failed('Request failed (503)') };
    wrapped(<AIAutoFollowupPage />);
    expect(alerts()).toMatch(/Failed to load the AI auto follow-up settings: Request failed \(503\)/);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    // The `?? false` seed plus a live toggle is the second finding: clicking it PATCHes
    // `autoAiEnabled: true` for a tenant whose actual setting was never read.
    expect(screen.queryByText('Enable AI Auto-Follow-Up')).toBeNull();
    expect(toggleSwitch()).toBeUndefined();
    expect(alerts()).not.toMatch(/last read/);
  });

  it('names the server, not `undefined`, when the refusal arrives messageless', () => {
    registry.byUrl = { [SETTINGS]: failed('') };
    wrapped(<AIAutoFollowupPage />);
    expect(alerts()).toMatch(/Failed to load the AI auto follow-up settings: no response from the server/);
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('re-runs the read from the outage card', () => {
    registry.byUrl = { [SETTINGS]: failed('Request failed (503)') };
    wrapped(<AIAutoFollowupPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SETTINGS].refetch).toHaveBeenCalledTimes(1);
  });
});

describe('stale: answered, then refused — the config stays, the caveat says what that costs', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the tenant\'s value on screen under exactly one "last read" alert', () => {
    registry.byUrl = { [SETTINGS]: staleRead({ autoAiEnabled: true }) };
    wrapped(<AIAutoFollowupPage />);
    expect(screen.getByText('Enable AI Auto-Follow-Up')).toBeTruthy();
    expect(toggleIsOn()).toBe(true);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load/);
    // The toggle is NOT gated on staleness: it still writes, and the caveat says so.
    expect(toggleSwitch()?.disabled).toBe(false);
  });

  it('never prints `undefined` for a messageless refused refresh', () => {
    registry.byUrl = { [SETTINGS]: staleRead({ autoAiEnabled: true }, '') };
    wrapped(<AIAutoFollowupPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/no response from the server/);
    expect(alerts()).not.toMatch(/undefined/);
    expect(toggleIsOn()).toBe(true);
  });

  it('re-runs the read from the caveat', () => {
    registry.byUrl = { [SETTINGS]: staleRead({ autoAiEnabled: false }) };
    wrapped(<AIAutoFollowupPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SETTINGS].refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the write keeps its own channel and its own words', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused PATCH over a healthy read reports the write, not a refresh caveat', async () => {
    refusedWrite('Only workspace admins can change this');
    registry.byUrl = { [SETTINGS]: ok({ autoAiEnabled: false }) };
    wrapped(<AIAutoFollowupPage />);
    await act(async () => { fireEvent.click(toggleSwitch()!); });
    await settledWith(/Failed to save the AI auto follow-up setting: Only workspace admins can change this/);
    expect(alerts()).not.toMatch(/last read/);
    expect(alerts()).not.toMatch(/Failed to load/);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('a refused PATCH over a refused refresh prints both, separately worded', async () => {
    refusedWrite('Revalidation of the guard token failed');
    registry.byUrl = { [SETTINGS]: staleRead({ autoAiEnabled: true }, 'Request failed (502)') };
    wrapped(<AIAutoFollowupPage />);
    await act(async () => { fireEvent.click(toggleSwitch()!); });
    await settledWith(/Failed to save the AI auto follow-up setting: Revalidation of the guard token failed/);
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
    expect(alerts()).toMatch(/last read/i);
    // The fold printed `error ?? loadErrorMessage` — the write's words only while `error`
    // was set; here the read's refusal must still be visible beneath the write's.
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(toggleIsOn()).toBe(true);
  });

  it('a messageless refusal on the write side never prints `undefined`', async () => {
    refusedWrite('');
    registry.byUrl = { [SETTINGS]: ok({ autoAiEnabled: false }) };
    wrapped(<AIAutoFollowupPage />);
    await act(async () => { fireEvent.click(toggleSwitch()!); });
    await settledWith(/Failed to save the AI auto follow-up setting: no response from the server/);
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/ai-auto-followup/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('no longer folds the read into the write, and splits on the two states', () => {
    const s = src();
    expect(s, 'the folded banner variable survived').not.toMatch(/displayError/);
    expect(s).toMatch(/Boolean\(loadError\) && !data/);
    expect(s).toMatch(/Boolean\(loadError\) && Boolean\(data\)/);
    expect(s).toMatch(/'\{reason\}'|no response from the server/);
    expect(s, 'the caveat is not rendered behind the branch that owns the region').toMatch(/\{stale && \(/);
    // It no longer guesses at the response body off `info`; `ApiQueryError.message` carries the status.
    expect(s, 'the read message still reaches through loadError.info').not.toMatch(/loadError\.info/);
  });

  it('gates the toggle on the outage, not on staleness, and invents no extra disable', () => {
    const s = src();
    expect(s).toMatch(/disabled=\{saving\}/);
    expect(s, 'a stale config is still the tenant\'s own — the outage owns the gate').not.toMatch(
      /disabled=\{[^}]*(failed|stale)[^}]*\}/,
    );
    expect(s, 'the card ternary owns the region; no early return was added over it').not.toMatch(/if \(failed\) return/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    const pattern = /const failed = Boolean\(loadError\) && !data;\s*\n\s*const stale = Boolean\(loadError\) && Boolean\(data\);/;
    expect(s, 'the shape this slice depends on moved').toMatch(pattern);
    expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
    expect(
      inspect(FILE, s.replace(pattern, 'const failed = Boolean(loadError);')).offends,
      `${FILE}: the guard would catch this rewind after all`,
    ).toBe(false);
  });

  it('keeps the sweep green and the file inside the size ceiling', () => {
    expect(src().split('\n').length, `${FILE} is past the ceiling`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('owns this page alone', () => {
    // Overlap hygiene: this is the only suite that mounts the ai follow-up settings page,
    // so no other slice's copy assertions can disagree with the ones above.
    const dir = join(ROOT, 'tests/unit');
    const claimers = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('settings/ai-auto-followup/page'));
    expect(claimers, 'another suite already claims this page').toEqual([
      'panel-page-error-not-empty-ai-auto-followup-stale-2872.test.tsx',
    ]);
  });
});
