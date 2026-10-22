// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/integrations/page.tsx` answered a refused refresh with an
 * outage card, on a screen that was still showing the connectors.
 *
 * #2829 gave this page the right shape for a read that never answered: the banner names the
 * failure, the retry re-runs it, and the "No integrations yet" sentence is gated so a failure
 * cannot be reported as an absence. What #2829 could not see is the second state. TanStack
 * Query keeps `data` when a *revalidation* of a read that already succeeded fails, and this
 * page branches on `error` alone, so the two collapsed into one.
 *
 * The trigger is the page's own save path. `reload()` invalidates `['tenant','integrations']`
 * and every write ends in it — the modal's `save`, `toggleMutation.onSuccess`, and the delete
 * mutation's `onSuccess`. So connecting a Slack webhook and having the following read refused
 * (a 504 at the gateway, a pool that blinked, a lock refused) printed "Failed to load
 * integrations: Request failed (504)" over the two connectors the operator can see, told them
 * the list could not be shown, and made "Try again" the only way back to a list that was
 * never gone. The connector they had just added is in it; the refusal is about whether it is
 * still switched on.
 *
 * MEASURED before the fix, this suite ran **9 failed | 6 passed (15)** against
 * `origin/main` at `c7c74088` with the page untouched. Four are the kept-read state simply
 * not existing: the outage card over rows that are being hidden, the caveat's retry, and the
 * toggle that cannot be clicked because there is nothing left to click. One is the refusal
 * with no message, which failed because the rows it is supposed to be showing were behind
 * that card. One is a refused refresh over a last read that was empty, which announced
 * itself as a load failure. Three are the source-shape cases, which fail because the split
 * they pin is not there yet. The outage card, the succeeded-and-empty sentence and the
 * healthy read pass before and after on purpose — those are the states #2829 already got
 * right, and a slice that regressed them is exactly what they are there to catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));

import IntegrationsPage from '@/app/tenant/settings/integrations/page';

const INTEGRATIONS_URL = '/api/tenant/integrations';
const NOW = '2026-03-04T10:00:00.000Z';

/** Two connectors, one switched off, so "the rows are still operable" can be read off the
 *  toggle a stale read is supposed to leave clickable. */
const ROWS = {
  data: [
    { id: 'i1', name: 'Ops webhook', type: 'webhook', is_active: true, created_at: NOW },
    { id: 'i2', name: 'Billing alerts', type: 'slack', is_active: false, created_at: NOW },
  ],
};
/** The last read said there were none, and this refresh was refused. */
const ROWS_EMPTY = { data: [] };

const OUTAGE = 'Failed to load integrations';
const CAVEAT = 'the list below is the last read';
const ABSENCE = 'No integrations yet';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state the single flag could not express: the read answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The same refusal with no message at all — `new Error()` really is what a network-level
 *  failure arrives as, and the page used to interpolate it straight into the banner. */
const messageless = (data: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

let client: QueryClient;
const mount = (result: QueryResult) => {
  cleanup();
  registry.byUrl = { [INTEGRATIONS_URL]: result };
  return render(
    <QueryClientProvider client={client}>
      <IntegrationsPage />
    </QueryClientProvider>,
  );
};

/** Records what the page sends, so "the kept rows are still operable" is a write, not a guess. */
let writes: { url: string; method: string }[] = [];
function stubWrites() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    writes.push({ url: String(url), method: init?.method ?? 'GET' });
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
  }));
}

beforeEach(() => {
  registry.byUrl = {};
  writes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('integrations: a refused refresh keeps the connectors and says what it costs', () => {
  it('keeps both connectors on screen and names the refusal above them', () => {
    mount(staleRead(ROWS));
    const alert = screen.queryAllByRole('alert');
    expect(alert).toHaveLength(1);
    expect(alerts()).toContain(CAVEAT);
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.getByText('Ops webhook')).toBeTruthy();
    expect(screen.getByText('Billing alerts')).toBeTruthy();
  });

  it('retires the outage card from the kept-read state', () => {
    mount(staleRead(ROWS));
    expect(screen.queryByText(new RegExp(OUTAGE))).toBeNull();
    expect(screen.queryByText(ABSENCE)).toBeNull();
  });

  it("the caveat's Try again re-runs the refused read and nothing else", async () => {
    const read = staleRead(ROWS);
    mount(read);
    expect(alerts(), 'the retry button must belong to the caveat, not the outage card').toContain(CAVEAT);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(read.refetch).toHaveBeenCalledTimes(1));
    expect(writes, 'the caveat is not a write path').toEqual([]);
  });

  it('leaves the kept rows operable — the toggle still PATCHes the connector it is on', async () => {
    mount(staleRead(ROWS));
    fireEvent.click(screen.getByRole('button', { name: /^Active$/i }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('PATCH');
    expect(writes[0].url).toBe('/api/tenant/integrations/i1');
  });

  it('prints the reason for the staleness rather than the word undefined when the refusal has none', () => {
    mount(messageless(ROWS));
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.getByText('Ops webhook')).toBeTruthy();
  });

  it('still shows the outage card for a read that never answered, and does not call it an absence', () => {
    mount(failed());
    expect(alerts()).toContain(OUTAGE);
    expect(screen.queryByText(CAVEAT)).toBeNull();
    expect(screen.queryByText(ABSENCE)).toBeNull();
    expect(screen.queryByText('Ops webhook')).toBeNull();
  });

  it('treats a succeeded-and-empty read as the sentence it always was, with no alert', () => {
    mount(ok(ROWS_EMPTY));
    expect(screen.getByText(ABSENCE)).toBeTruthy();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('reads a refused refresh over an empty last read as a kept read, not as a load failure', () => {
    mount(staleRead(ROWS_EMPTY));
    expect(alerts()).toContain(CAVEAT);
    expect(screen.queryByText(new RegExp(OUTAGE))).toBeNull();
    // The sentence survives alongside the caveat, which is what the merged slices in this
    // campaign do: the last read genuinely said there were none, and the caveat is what says
    // that answer may be a moment stale. Swapping the pair for a banner would be the bug.
    expect(screen.getByText(ABSENCE)).toBeTruthy();
  });

  it('is silent and whole when the read answers', () => {
    mount(ok(ROWS));
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByText('Ops webhook')).toBeTruthy();
    expect(screen.queryByText(ABSENCE)).toBeNull();
  });
});

describe('integrations: the shape these assertions hold', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/integrations/page.tsx';
  const src = readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the one flag into the two states the cache can actually be in', () => {
    expect(src).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(src, 'the caveat must key off the kept payload, not the flag')
      .toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(src).toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
    expect(src, 'the outage branch must read the split, not the raw flag')
      .toMatch(/: failed \? <InlineErrorState message=\{`Failed to load integrations: \$\{reason\}`\}/);
  });

  it('gates the absence sentence on the outage only, so a kept read is never called an absence by silence either', () => {
    expect(src).toMatch(/\{!loading && !failed && !integrations\.length && \(/);
    expect(src, 'a rewind to the raw flag would hide the caveat state from this gate')
      .not.toMatch(/!loading && !error && !integrations\.length/);
  });

  it('gates no write on the new flag — the early branches own the region already', () => {
    expect(src).not.toMatch(/disabled=\{[^}\n]*\b(stale|failed)\b/);
    expect(src).not.toMatch(/if \(stale\) return/);
    expect(src).not.toMatch(/if \(failed\) return/);
  });

  it('is not something the sweep could have caught anyway', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    expect(inspect(FILE, src).offends, `${FILE} was already on the guard's list`).toBe(false);
    const rewound = src.replace(
      /const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);/,
      'const failed = Boolean(error);\n  const stale = false;',
    );
    expect(rewound, 'the split this suite pins moved out from under the rewind').not.toBe(src);
    expect(
      inspect(FILE, rewound).offends,
      'the guard would catch this rewind after all, so the sweep is the screen here, not these tests',
    ).toBe(false);
  });

  it('keeps the guards green with this slice in place', () => {
    for (const script of ['scripts/check-panel-error-state.mjs', 'scripts/check-file-size.mjs', 'scripts/check-catch-empty.mjs']) {
      const res = spawnSync('node', [script], { cwd: ROOT, encoding: 'utf8' });
      expect(res.status, `${script}: ${res.stdout}${res.stderr}`).toBe(0);
    }
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files, 'this page went back on the shrink-only list').not.toContain(FILE);
  });

  it('stays inside the line ceiling it is not grandfathered into', () => {
    const lines = src.split('\n').length;
    expect(lines, `${FILE} is past the 500-line ceiling (${lines})`).toBeLessThanOrEqual(500);
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/file-size-baseline.json'), 'utf8'));
    expect(baseline[FILE], 'a ceiling that moved means this case must move with it').toBeUndefined();
  });
});
