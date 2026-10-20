// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the read #2893 could not see: `app/tenant/chat`'s message thread, and the status the
 * session list was actually asked for.
 *
 * #2893 fixed `chat`'s sidebar properly: three states on the sessions query, rows kept on a
 * refused refresh, retry bound to the read that failed. It did not reach the second read on the
 * same file, and there is a structural reason it could not: `guard:panel-error-state` counts
 * `useApiQuery`/`useQuery` calls, `chat` has exactly one, and the transcript is a plain `fetch`.
 * With the baseline now empty there is also no allowlist left to hold the remainder, which is
 * worth saying out loud — the guard going green is not this page being done.
 *
 * What the thread still does, measured against the two rules this epic is named for:
 *
 *   1. **a failed read must not drive an action button.** The reply form is gated on
 *      `status !== 'closed'` alone, so a conversation the server refused to show still gets a
 *      `Type a reply...` box and a `Send`, and an agent answers a transcript they have not seen.
 *   2. **a stale banner must keep the rows and name the loss.** `loadMessages` clears `messages`
 *      before it asks, so re-clicking the session already open destroys the transcript and reports
 *      the loss as an outage — `#2872`'s own title, on the page that shows the conversation. The
 *      thread has no stale state at all, and its failure banner has no `onRetry`, so it is the
 *      only failure on the page with no way out.
 *
 * The third finding is the sidebar's copy: both sentences interpolate the raw filter, so the
 * tab labelled `All` renders `The all list below is the last read` and `Failed to load all
 * sessions`, and a successful read of `?status=active` that came back empty still says `No
 * sessions found` — a claim about every chat in the tenant, made on the strength of one status.
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

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// #1075's boundary is its own subject; passing children through keeps Sentry out of this tree.
vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));

import ChatPage from '@/app/tenant/chat/page';

const ACTIVE = '/api/tenant/chat?status=active';
const ALL = '/api/tenant/chat';
const CLOSED = '/api/tenant/chat?status=closed';
const THREAD = '/api/tenant/chat/s1/messages';

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1', visitorId: 'vis-9312', visitorName: 'Kestrel Vane', visitorEmail: 'kestrel@example.test',
  status: 'active', channel: 'web', assignedTo: null, createdAt: '2026-03-04T09:00:00.000Z', ...over,
});
const sessionRows = { data: [session()] };
const twoSessions = { data: [session(), session({ id: 's2', visitorId: 'vis-4410', visitorName: 'Aldous Wren', visitorEmail: null, channel: 'whatsapp' })] };
const threadRows = { data: [
  { id: 'm1', sessionId: 's1', senderType: 'visitor', senderId: 'vis-9312', content: 'Is the forklift order shipped?', createdAt: '2026-03-04T09:05:00.000Z' },
  { id: 'm2', sessionId: 's1', senderType: 'agent', senderId: 'a1', content: 'SO-3312 left the depot this morning.', createdAt: '2026-03-04T09:07:00.000Z' },
] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const httpOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const httpFailed = (status = 500, body: unknown = { error: 'Chat messages request failed' }) => ({
  ok: false, status, json: async () => body,
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
const clickSession = (name: RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  registry.byUrl = {};
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Open the panel with a readable session list and load Kestrel Vane's thread. */
async function withThread(first: unknown) {
  registry.byUrl = { [ACTIVE]: ok(sessionRows) };
  const view = wrapped(<ChatPage />);
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(first);
  clickSession(/Kestrel Vane/);
  return { mockFetch: fetch as ReturnType<typeof vi.fn>, view };
}

describe('rule 1: a transcript the server refused must not drive the reply box (#2872)', () => {
  it('does not offer Send over a conversation it could not read', async () => {
    await withThread(httpFailed(500));
    await waitFor(() => expect(alerts()).toContain('Failed to load this conversation'));
    expect(screen.queryByPlaceholderText('Type a reply...')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
  });

  it('still offers the reply box for a session that genuinely has no messages', async () => {
    await withThread(httpOk({ data: [] }));
    await waitFor(() => expect(screen.getByText('No messages yet')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByPlaceholderText('Type a reply...')).toBeTruthy();
  });
});

describe('rule 2: a refused re-read keeps the transcript and names the loss (#2872)', () => {
  it('does not delete the open conversation when re-reading it fails', async () => {
    const { mockFetch } = await withThread(httpOk(threadRows));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    mockFetch.mockResolvedValueOnce(httpFailed(504, { error: 'Gateway timed out' }));
    clickSession(/Kestrel Vane/);
    await waitFor(() => expect(alerts()).toMatch(/last read/));
    expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy();
    expect(screen.getByText('SO-3312 left the depot this morning.')).toBeTruthy();
    expect(alerts()).not.toContain('Failed to load this conversation');
  });

  it('says which half of the conversation the refused re-read lost', async () => {
    const { mockFetch } = await withThread(httpOk(threadRows));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    mockFetch.mockResolvedValueOnce(httpFailed(504, { error: 'Gateway timed out' }));
    clickSession(/Kestrel Vane/);
    await waitFor(() => expect(alerts()).toMatch(/last read/));
    // "Some data may be out of date" would not tell an agent anything about a chat thread: the
    // one thing that can be missing is what the visitor sent in the meantime.
    expect(alerts()).toMatch(/message .*sent since/i);
    expect(alerts()).toContain('Gateway timed out');
  });

  it('still offers the reply box while the last-read transcript is on screen', async () => {
    const { mockFetch } = await withThread(httpOk(threadRows));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    mockFetch.mockResolvedValueOnce(httpFailed(504));
    clickSession(/Kestrel Vane/);
    await waitFor(() => expect(alerts()).toMatch(/last read/));
    expect(screen.getByPlaceholderText('Type a reply...')).toBeTruthy();
  });

  it('does not mistake a thrown fetch for an empty conversation', async () => {
    const { mockFetch } = await withThread(httpOk(threadRows));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    clickSession(/Kestrel Vane/);
    await waitFor(() => expect(alerts()).toMatch(/last read/));
    expect(alerts()).toContain('Failed to fetch');
    expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy();
  });

  it('does clear the transcript when a *different* session is chosen', async () => {
    // The other half of the same line of code: clearing is wrong for the session already open and
    // right when the operator moves on, or session A's messages sit under session B's header.
    const { mockFetch, view } = await withThread(httpOk(threadRows));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    registry.byUrl[ACTIVE] = ok(twoSessions);
    view.rerender(tree(<ChatPage />));
    mockFetch.mockResolvedValueOnce(httpFailed(500));
    clickSession(/Aldous Wren/);
    await waitFor(() => expect(screen.queryByText('Is the forklift order shipped?')).toBeNull());
    expect(screen.getAllByText('Aldous Wren').length).toBeGreaterThanOrEqual(1);
    expect(alerts()).toContain('Failed to load this conversation');
  });
});

describe('the transcript failure gets the same retry the rest of the page has (#2872)', () => {
  it('binds "Try again" to the conversation, not to the session list', async () => {
    const { mockFetch } = await withThread(httpFailed(500));
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
    mockFetch.mockResolvedValueOnce(httpOk(threadRows));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('Is the forklift order shipped?')).toBeTruthy());
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([THREAD, THREAD]);
    expect(registry.byUrl[ACTIVE].refetch).not.toHaveBeenCalled();
  });

  it('stops announcing the failure once the read succeeds', async () => {
    const { mockFetch } = await withThread(httpFailed(500));
    await waitFor(() => expect(alerts()).toContain('Failed to load this conversation'));
    mockFetch.mockResolvedValueOnce(httpOk(threadRows));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('SO-3312 left the depot this morning.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the copy says the status that was actually read (#2872)', () => {
  it('does not say "the all list" or "all sessions" on the tab labelled All', () => {
    registry.byUrl = { [ALL]: failed('Request failed (503)') };
    wrapped(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(alerts()).toContain('Failed to load chat sessions: Request failed (503)');
    expect(alerts()).not.toMatch(/\ball sessions\b/i);
  });

  it('calls a refused refresh of the All tab the last read, in English', () => {
    registry.byUrl = { [ALL]: staleRead(sessionRows) };
    wrapped(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(alerts()).toMatch(/last read/);
    expect(alerts()).not.toMatch(/The all list/i);
    expect(screen.getByText('Kestrel Vane')).toBeTruthy();
  });

  it('scopes an absence to the status it was asked for', () => {
    registry.byUrl = { [CLOSED]: ok({ data: [] }) };
    wrapped(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(screen.getByText('No closed sessions')).toBeTruthy();
    // `?status=closed` is not evidence about the tenant's other chats.
    expect(screen.queryByText('No sessions found')).toBeNull();
  });

  it('keeps the sidebar sentences naming their own read', () => {
    const result = failed('Request failed (500)');
    registry.byUrl = { [ACTIVE]: result };
    wrapped(<ChatPage />);
    expect(alerts()).toContain('Failed to load active sessions: Request failed (500)');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/chat/page.tsx';

  it('gives the thread the same three states the sidebar has', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src, 'the transcript has no notion of a read that is on screen but refused')
      .toMatch(/const threadStale = Boolean\(/);
    expect(src, 'the transcript has no separate outage state').toMatch(/const threadFailed = Boolean\(/);
    expect(src, 'a thrown fetch can still print an undefined reason').toMatch(/'no response from the server'/);
    expect(src, 'the reply box is still driven by a read that failed').toMatch(/!threadFailed/);
    expect(src, 'the transcript failure still has no retry').toMatch(/threadReason[\s\S]*onRetry/);
  });

  it('only clears the transcript when the operator moves to another session', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src, 'loadMessages still clears unconditionally, so a refused re-read deletes the rows')
      .toMatch(/if \(session\.id !== selectedSession\?\.id\)\s+setMessages\(\[\]\)/);
  });

  it('names the filter instead of interpolating it raw', () => {
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    expect(src, 'the sentences still interpolate the raw filter').toMatch(
      /const scope = filter === 'all' \? 'chat sessions' : `\$\{filter\} (?:chat )?sessions`/,
    );
    expect(src, 'a sentence still says "the all list"').not.toMatch(/`The \$\{filter\} list/);
    expect(src, 'an absence still over-claims every status').not.toMatch(/>No sessions found</);
  });

  it('is not something the guard could have caught, and the baseline is empty to prove it', async () => {
    // The structural reason this half survived #2893: the screen looks at query hooks, chat has
    // one, and the transcript is a plain `fetch`. A page can therefore pass the guard while its
    // second read still prints an absence over a refusal.
    const { EMPTY_SENTENCE, EMPTY_TEST, inspect } = await import(
      `file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`
    );
    const src = readFileSync(join(ROOT, FILE), 'utf8');
    const hooks = [...src.matchAll(/const\s*(?:\{[^}]*\}|\w+)\s*=\s*(?:useApiQuery|useQuery)\b/g)];
    expect(hooks, 'chat grew a second hook read — this screen now sees the thread too').toHaveLength(1);
    expect(src, 'the transcript read is no longer a plain fetch — this screen needs revisiting')
      .toMatch(/const loadMessages[\s\S]*?await fetch\(/);
    expect(EMPTY_SENTENCE.test('No messages yet')).toBe(true);
    expect(EMPTY_TEST.test('messages.length === 0')).toBe(true);
    expect(inspect(FILE, src).offends).toBe(false);

    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files, '#2893 emptied the baseline; nothing new belongs in it').toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = readFileSync(join(ROOT, FILE), 'utf8').split('\n').length - 1;
    expect(lines, 'chat crossed MAX_LINES — this slice must not need a split').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
