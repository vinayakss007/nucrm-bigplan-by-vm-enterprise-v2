// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copy or distribution is prohibited.
 */

/**
 * #2872 — `app/auth/invite/page.tsx` told a visitor their invitation was invalid
 * because a re-check did not go through, while holding the invitation it had read.
 *
 * `getInviteView` (#2294) is the single source of truth for this screen and it is
 * strict on purpose: any bound `error` string wins over any bound `invitation`,
 * because a page that guesses at who invited you is worse than one that says it
 * cannot tell. The page fed that one channel with `queryError ? inviteErrorMessage
 * (queryError) : …` — and `useApiQuery` keeps `data` when a *revalidation* of a read
 * that already answered fails. So the two states collapsed: a remount whose refresh
 * died at the transport layer produced the full-screen "Invitation Invalid" with the
 * network fallback text "Failed to load invitation", deleting a form the visitor had
 * half-filled, on the strength of a request that never reached the server.
 *
 * The distinction this slice draws is the one the screen cannot make for itself: an
 * answer is an answer. `inviteErrorMessage` already surfaces the server's own words
 * when the failure carries them (`ApiQueryError.info`), so a 400/404 re-check saying
 * "Invitation not found or has expired" is fresher than the cached read and still
 * takes the form away. A refusal that carried no such message is not a statement
 * about the invitation, and the form stays, with the caveat saying which read it is.
 *
 * MEASURED before the fix, this suite ran **8 failed | 7 passed (15)** against
 * `origin/main` at `8a9033d5` with the page untouched. Five are the kept-read state
 * not existing: the form that should survive is replaced by the invalid screen, its
 * submit path goes with it, the caveat and its re-check do not exist, and the
 * messageless refusal is printed as the network fallback as though it were a verdict
 * on the invitation. Three are the source-shape cases, which fail because the split
 * they pin is not there yet. The never-answered outage, the 404-as-answer, the
 * answered-404 that takes the form down, the healthy read and the 200-carrying-an-
 * error shape pass before and after on purpose: those are #2294's guarantees, and a
 * "fix" that traded one false statement for another is exactly what they catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

type QueryResult = {
  data?: unknown;
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
const calls = vi.hoisted(() => ({ push: [] as string[], refresh: 0, posts: [] as string[] }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, isLoading: false, error: null, refetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => { calls.push.push(path); },
    replace: vi.fn(),
    refresh: () => { calls.refresh += 1; },
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams('token=inv-1'),
  usePathname: () => '/auth/invite',
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: { method?: string }) => {
  if ((init?.method ?? 'GET') !== 'GET') calls.posts.push(String(input));
  return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
});

import AcceptInvitePage from '@/app/auth/invite/page';

const PAGE = 'app/auth/invite/page.tsx';
const URL = '/api/auth/invite-details?token=inv-1';
const INVITATION = { email: 'ada@example.test', tenant_name: 'Analytical Co', role_slug: 'agent', primary_color: '#7c3aed' };

/** A failure that carries the server's own words — `ApiQueryError.info`, #2294. */
const answeredByServer = (message: string): Error & { info: unknown } =>
  Object.assign(new Error(`Request failed (404): ${message}`), { info: { error: message } });

const ok = (data: unknown): QueryResult => ({ data, isLoading: false, error: null, refetch: vi.fn() });
/** Nothing ever answered. */
const failed = (error: Error = new Error('Request failed (500)')): QueryResult => ({
  data: undefined, isLoading: false, error, refetch: vi.fn(),
});
/** The read answered; this re-check did not, and no answer came back with it. */
const refusedRefresh = (data: unknown, error: Error = new Error('Failed to fetch')): QueryResult => ({
  data, isLoading: false, error, refetch: vi.fn(),
});

function mount(result: QueryResult) {
  registry.byUrl = { [URL]: result };
  return render(<AcceptInvitePage />);
}

const alertText = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const src = () => readFileSync(PAGE, 'utf8');

beforeEach(() => {
  registry.byUrl = {};
  calls.push.length = 0;
  calls.posts.length = 0;
  calls.refresh = 0;
});
afterEach(cleanup);

describe('auth invite — a refused re-check is not a verdict (#2872)', () => {
  it('keeps the form when the re-check never reached the server', () => {
    mount(refusedRefresh(INVITATION));
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(screen.getByText('ada@example.test')).toBeTruthy();
    expect(screen.queryByText('Invitation Invalid')).toBeNull();
  });

  it('says which read the visitor is looking at', () => {
    mount(refusedRefresh(INVITATION, new Error('Failed to fetch')));
    expect(alertText()).toContain('Could not re-check this invitation: Failed to fetch');
    expect(alertText()).toContain('the re-check failed');
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('offers a re-check that re-runs the read and nothing else', () => {
    const refetch = vi.fn();
    mount({ ...refusedRefresh(INVITATION), refetch });
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls.posts).toEqual([]);
  });

  it('leaves the join path working through a refused re-check', async () => {
    mount(refusedRefresh({ ...INVITATION, isLoggedIn: true }));
    fireEvent.click(screen.getByRole('button', { name: /Join Analytical Co/ }));
    await waitFor(() => expect(calls.posts).toContain('/api/auth/accept-invite'));
    expect(calls.push).toContain('/tenant/dashboard');
  });

  it('names a refusal that carried no message instead of printing undefined', () => {
    mount(refusedRefresh(INVITATION, new Error('')));
    expect(alertText()).toContain('no response from the server');
    expect(alertText()).not.toContain('undefined');
  });

  it('still calls a read that never answered an outage, not an absence', () => {
    mount(failed(new Error('Failed to fetch')));
    expect(screen.getByText('Invitation Invalid')).toBeTruthy();
    expect(screen.getByText('Failed to load invitation')).toBeTruthy();
    expect(screen.queryByText('Join Analytical Co →')).toBeNull();
  });

  it('lets a 404 answer speak for itself', () => {
    mount(failed(answeredByServer('Invitation not found or has expired')));
    expect(screen.getByText('Invitation Invalid')).toBeTruthy();
    expect(screen.getByText('Invitation not found or has expired')).toBeTruthy();
    expect(alertText()).not.toContain('last read');
  });

  it('takes the form down when the re-check answered that the invite is gone', () => {
    mount(refusedRefresh(INVITATION, answeredByServer('Invitation not found or has expired')));
    expect(screen.getByText('Invitation Invalid')).toBeTruthy();
    expect(screen.getByText('Invitation not found or has expired')).toBeTruthy();
    expect(screen.queryByText('Join Analytical Co →')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-check' })).toBeNull();
  });

  it('stays silent on a healthy read', () => {
    mount(ok(INVITATION));
    expect(screen.getByText('Join Analytical Co →')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the server 200-with-error shape out of the form', () => {
    mount(ok({ ...INVITATION, error: 'Invitation already accepted' }));
    expect(screen.getByText('Invitation Invalid')).toBeTruthy();
    expect(screen.getByText('Invitation already accepted')).toBeTruthy();
  });
});

describe('auth invite — the split stays in the source (#2872)', () => {
  it('separates an answer from a refusal', () => {
    expect(src()).toContain("const answered = Boolean((queryError as { info?: unknown } | null)?.info);");
    expect(src()).toContain('const unrefreshed = Boolean(queryError) && Boolean(data) && !answered;');
    expect(src()).toContain("const reason = queryError?.message || 'no response from the server';");
  });

  it('routes the kept-read state around the error channel, not through it', () => {
    expect(src()).toContain("const lookupError = unrefreshed ? data?.error ?? '' : queryError ? inviteErrorMessage(queryError) : data?.error ?? '';");
  });

  it('does not silence a refusal that came with no data at all', () => {
    // `unrefreshed` needs `data`; without it the fold below is #2294's behaviour.
    expect(src()).toContain('Boolean(data) && !answered');
  });

  it('leaves the repo guards green', () => {
    for (const script of ['check-file-size.mjs', 'check-panel-error-state.mjs', 'check-catch-empty.mjs']) {
      const r = spawnSync('node', [join('scripts', script)], { encoding: 'utf8' });
      expect(r.status, `${script} exited ${r.status}: ${r.stderr}`).toBe(0);
    }
  });

  it('stays inside the file-size ceiling without a baseline entry', () => {
    const baseline = JSON.parse(readFileSync('scripts/file-size-baseline.json', 'utf8')) as Record<string, number>;
    expect(src().split('\n').length).toBeLessThanOrEqual(500);
    expect(baseline[PAGE]).toBeUndefined();
  });
});
