// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/sessions/page.tsx`, the page you open to sign a device out.
 *
 * It bound `error: sessionsError` and gated #2829's outage card on the bare flag, while
 * `reload()` invalidates `['user','sessions']` after every revoke. TanStack Query hands the
 * page back the payload it already had when that refresh is refused, so revoking one laptop
 * and having the revalidation fail took the whole roster off the screen and replaced it with
 * "this is a failed request, not an empty list" — on the one panel whose job is showing which
 * devices are still signed in. The operator lost sight of exactly the rows they were deciding
 * about, and the outage copy actively told them there was nothing to see.
 *
 * `failed` (the read never answered) keeps #2829's sentence word for word —
 * `panel-page-error-not-empty-2829` pins "Could not load your active sessions" against this
 * page, and those arms pass before and after the split, which is the point: the outage arm is
 * not what regressed. The new `stale` arm (refused refresh, kept payload) keeps the rows, the
 * `Current` badge and the buttons, and names the loss this page has: a session revoked on
 * another device is still listed with its Revoke button, and a sign-in that happened since the
 * read is missing entirely — along with the `Current` badge, which the route puts on the row
 * matching the caller's cookie (app/api/user/sessions/route.ts:28-29, 46).
 *
 * The action question is decided per action, against the route:
 *   • Revoke (row)   — `route.ts:75-82` deletes by `eq(id)` AND `eq(userId)` AND
 *                      `ne(tokenHash, currentHash)`. It consumes the id on the row the
 *                      operator is looking at and cannot reach another user's or your own
 *                      session, so it stays attached over a stale read.
 *   • Sign out others — `route.ts:69-74` takes NO ids from the page: it deletes every row
 *                      scoped to `ctx.userId` except the caller's token hash. The live
 *                      server-side set is what it acts on, so a stale read cannot make it
 *                      act on the wrong rows; only `failed` withholds it, because a
 *                      queue-wide sign-out driven by a roster the page never had is the
 *                      super-admin "Resolve All" over an unread DLQ.
 * The revoke-all click is asserted to send `{revokeAll:true}` and no ids, which is what makes
 * that reasoning checkable rather than a claim about SQL.
 *
 * Fixtures are documentation-only (RFC 5737 addresses).
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
// The dialogs around both actions are #2829's concern, not this page's read model.
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
}));

import SessionsPage from '@/app/tenant/settings/sessions/page';

const SESSIONS = '/api/user/sessions';

const HERE = '2026-03-02T10:00:00.000Z';
const thisLaptop = {
  id: 's1', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
  ip_address: '198.51.100.24', is_current: true, created_at: HERE,
};
const oldPhone = {
  id: 's2', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
  ip_address: '203.0.113.7', is_current: false, created_at: '2026-02-20T08:30:00.000Z',
};
const borrowedTablet = {
  id: 's3', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/122.0',
  ip_address: null, is_current: false, created_at: '2026-02-01T09:00:00.000Z',
};
const roster = { data: [thisLaptop, oldPhone, borrowedTablet] };
const emptyRead = { data: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** `<p class="text-sm font-medium">{Chrome|Safari|Firefox}</p>` — one per rendered row. */
const rowNames = () =>
  [...document.querySelectorAll('p.text-sm.font-medium')].map((el) => el.textContent ?? '');
const revokeButtons = () => screen.queryAllByRole('button', { name: 'Revoke' });
const signOutAllButton = () => screen.queryByRole('button', { name: /sign out all others/i });

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const show = (result: QueryResult) => {
  registry.byUrl = { [SESSIONS]: result };
  cleanup();
  render(tree(<SessionsPage />));
};

/** Records what the two DELETE bodies actually carry. */
function spyFetch() {
  const seen: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: { body?: unknown }) => {
    seen.push({ url: String(input), body: String(init?.body ?? '') });
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
  }));
  return seen;
}

beforeEach(() => {
  registry.byUrl = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('a refused refresh keeps the roster and names what the operator can no longer see (#2872)', () => {
  beforeEach(() => { show(staleRead(roster)); });

  it('keeps all three devices on screen', () => {
    expect(rowNames()).toEqual(['Chrome', 'Safari', 'Firefox']);
  });

  it('keeps the current-device marker the read put there', () => {
    expect(screen.getByText('Current')).toBeTruthy();
  });

  it('keeps both Revoke buttons attached — deliberate: route.ts:75-82 re-reads the id under ctx.userId', () => {
    // A stale row can only cost the operator a no-op (the session is already gone) or the
    // sign-out of the device they are pointing at. The `eq(userId)` and
    // `ne(tokenHash, currentHash)` terms mean the delete cannot reach another user's
    // session or sign the operator out of this one, so nothing here is a guess.
    expect(revokeButtons()).toHaveLength(2);
    expect(revokeButtons().every((b) => !b.disabled)).toBe(true);
  });

  it('keeps Sign out all others — deliberate: route.ts:69-74 consumes no id from this list', () => {
    const button = signOutAllButton();
    expect(button, 'the queue-wide action vanished over a read the server answered before').not.toBeNull();
    expect(button!.disabled).toBe(false);
  });

  it('says the devices shown are the last read, with the reason', () => {
    expect(alerts()).toContain('the last read: Request failed (504)');
  });

  it('does not call the roster it is showing a failed load (#2829\'s other half)', () => {
    expect(alerts()).not.toContain('this is a failed request, not an empty list');
  });

  it('names the specific loss instead of saying some data may be out of date', () => {
    expect(alerts()).toMatch(/revoked on another device/);
    expect(alerts()).toMatch(/sign-in that happened after it is missing/);
    expect(alerts()).toMatch(/Current.{0,10}badge/);
    expect(alerts()).toMatch(/signs out what the server finds now/);
    expect(alerts()).not.toMatch(/may be out of date/i);
  });

  it('re-runs the refused read from the caveat, once', () => {
    const result = staleRead(roster);
    show(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server rather than printing undefined when the refusal has no message', () => {
    show({ data: roster, error: new Error(''), isLoading: false, refetch: vi.fn() });
    expect(alerts()).toContain('the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('the page\'s two actions are judged against the route, not against the roster (#2872)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Sign out all others sends {revokeAll:true} and no session id, so a stale list is not its input', async () => {
    const seen = spyFetch();
    show(staleRead(roster));
    fireEvent.click(signOutAllButton()!);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].url).toBe(SESSIONS);
    // The whole queue is decided server-side (route.ts:69-74); nothing on the page picks it.
    expect(JSON.parse(seen[0].body)).toEqual({ revokeAll: true });
    expect(seen[0].body).not.toContain('s1');
    expect(seen[0].body).not.toContain('s2');
  });

  it('a stale row\'s Revoke sends that one visible id and nothing else', async () => {
    const seen = spyFetch();
    show(staleRead(roster));
    fireEvent.click(revokeButtons()[0]);
    await waitFor(() => expect(seen).toHaveLength(1));
    // The row button is the opposite case from the queue-wide one: it acts on the device the
    // operator is looking at, so the staleness costs accuracy about a row they can see rather
    // than an unseen sweep of every session in the account.
    expect(JSON.parse(seen[0].body)).toEqual({ sessionId: 's2' });
    expect(seen[0].body).not.toMatch(/revokeAll/);
  });
});

describe('the read that never answered keeps #2829\'s copy (#2872)', () => {
  it('shows the outage sentence, word for word, over no rows', () => {
    show(failedRead());
    expect(alerts()).toContain('Could not load your active sessions — this is a failed request, not an empty list.');
    expect(rowNames()).toHaveLength(0);
  });

  it('does not claim nobody is signed in when the read never answered', () => {
    show(failedRead());
    expect(screen.queryByText(/No sessions found/)).toBeNull();
  });

  it('drives no action affordance over a read the page never had', () => {
    // #2829 left `otherSessions` empty on this path, so nothing renders today; the gate is
    // written as `!failed &&` so the button cannot come back over an unread roster if the
    // rows ever stop being the only thing this page knows. The source line is pinned below.
    show(failedRead());
    expect(revokeButtons()).toHaveLength(0);
    expect(signOutAllButton()).toBeNull();
  });

  it('offers to re-run the failed read (#2829\'s arm, unchanged)', () => {
    const result = failedRead();
    show(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server rather than printing undefined when the failure has no message', () => {
    show({ data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() });
    expect(alerts()).toContain('Could not load your active sessions');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('a genuine empty read is honest, and a stale empty keeps both (#2872)', () => {
  it('says no sessions were found, with no alert and no queue-wide button, when the read came back with none', () => {
    show(ok(emptyRead));
    expect(screen.getByText('No sessions found')).toBeTruthy();
    expect(screen.getByText('Active sessions will appear here')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(signOutAllButton()).toBeNull();
  });

  it('still says none are signed in, with the caveat above it, when the kept list was empty', () => {
    // The empty sentence is honest about the answer the server did give; the caveat says the
    // refresh after it was refused — which here also means a sign-in may have landed since.
    show(staleRead(emptyRead));
    expect(screen.getByText('No sessions found')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('this is a failed request, not an empty list');
  });

  it('shows the kept rows with no alert at all once the refresh answers', () => {
    show(ok(roster));
    expect(rowNames()).toHaveLength(3);
    expect(revokeButtons()).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dashes the loading skeleton only while the first read is in flight', () => {
    show({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });
    expect(rowNames()).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/No sessions found/)).toBeNull();
  });
});

describe('one read, one view: there is no per-view question to fake here (#2872)', () => {
  it('carries no filter or page parameter, so the two arms cannot diverge by view', () => {
    // offers and trash each had a per-view block because their key carries a page/filter and
    // an unopened view is a read that never answered while the view you came from keeps its
    // rows. This page has one key (`['user','sessions']`) and one bare URL, so writing that
    // block here would mean inventing a second read. Asserted against the source instead.
    const s = readFileSync(join(process.cwd(), 'app/tenant/settings/sessions/page.tsx'), 'utf8');
    expect(s).toMatch(/const SESSIONS_QUERY = \['user', 'sessions'\] as const;/);
    expect(s).toMatch(/\n\s*'\/api\/user\/sessions',\n/);
    expect(s.match(/useApiQuery</g) ?? [], 'a second read would need the per-view arms').toHaveLength(1);
    expect(s).not.toMatch(/URLSearchParams/);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/sessions/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all').toMatch(/const failed = Boolean\(sessionsError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(sessionsError\) && Boolean\(data\);/);
    expect(s).toMatch(/const reason = sessionsError\?\.message \|\| 'no response from the server';/);
    expect(s, 'the outage card is still gated on the bare flag').not.toMatch(/sessionsError \? \(/);
    expect(s).toMatch(/\{stale && \(/);
  });

  it('gates the outage card on failed and keeps #2829\'s sentence verbatim', () => {
    const s = src();
    expect(s).toMatch(/failed \? \(/);
    expect(s, '#2829 wording drifted').toContain(
      'Could not load your active sessions — this is a failed request, not an empty list.',
    );
  });

  it('withholds the queue-wide action on an unread read only, and says why', () => {
    const s = src();
    expect(s, 'Sign out all others is back to being driven by whatever the last read happened to keep').toMatch(
      /!failed && otherSessions\.length > 0 && \(/,
    );
    expect(s, 'the ungated form is still in the file').not.toMatch(/\{otherSessions\.length > 0 && \(/);
    expect(s, 'the decision lost its route citation').toMatch(/route\.ts:69-74/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [RegExp, string][] = [
      [/const failed = Boolean\(sessionsError\) && !data;\s*\n\s*const stale = Boolean\(sessionsError\) && Boolean\(data\);/,
        'const failed = Boolean(sessionsError);'],
      [/\{stale && \(/, '{false && ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      const s = src();
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'sessions went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
