// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829 — the last three pages, and the baseline going to zero.
 *
 * `scripts/panel-error-state-baseline.json` has carried the same three names since the guard was
 * written: `chat` ("No sessions found"), `emails` ("No emails sent yet") and `pipelines` ("No
 * pipelines yet"). All three were visible to `check-panel-error-state.mjs` and none of them was
 * fixed by arguing with the screen — each page now binds its error and renders `<InlineErrorState>`
 * for it, which is the shape the guard was written to look for. With the list empty the guard is
 * stricter than it has ever been: there is no baseline entry left to hide behind, so the next page
 * that answers a refusal with a sentence about the tenant's data is a NOVEL offender and CI stops.
 *
 * What each page actually got wrong is three different mistakes, which is why three descriptions
 * were needed:
 *
 *   - `emails` destructured no `error` at all, on the strength of a comment that the tracking
 *     endpoint "may 404 on older deploys", so treat any error as an empty list. `app/api/tenant/
 *     email/tracking/route.ts` answers today, and `api-url-has-handler-2822` now fails CI if a page
 *     points at a URL with nothing behind it — the excuse expired and the behaviour stayed.
 *   - `chat` destructured no `error` either, and its empty sentence is the one that costs the most:
 *     a waiting visitor reported as no visitor waiting. Its thread pane had the same bug in plain
 *     `fetch` form — `if (res.ok)` with no else, so a refused conversation read cleared `messages`
 *     and printed "No messages yet" (line 209 before this file), and a thrown `fetch` was not caught
 *     at all. That half is outside the guard's reach entirely: it only looks at `useApiQuery`.
 *   - `pipelines` was the #2872 failure in the other direction. It bound `queryError` and answered
 *     it by replacing the ENTIRE page with a retry card — but create, add-stage and delete all
 *     invalidate `PIPELINES_QUERY`, so an operator who had just added a pipeline watched it vanish
 *     behind "Failed to load pipelines", a sentence the cached data contradicts.
 *
 * RED AT BASE. On `main` at `e8faa609`, with the three product files untouched and this file
 * otherwise as committed: 17 of these 22 cases fail — 4 of 5 emails, 4 of 6 chat, 3 of 5 pipelines,
 * and all six ratchet cases. The 5 that pass are the controls, included on purpose: a successful
 * read that genuinely finds nothing, a thread that loads, and the pipelines header count, which the
 * old page also hid — by destroying the whole page rather than the sentence.
 * `node scripts/check-panel-error-state.mjs` exits 0 at base: the three pages sat on the list the
 * guard forgives, which is exactly the thing this slice removes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
// The chat page wraps its body in the route ErrorBoundary, which reports to Sentry. This suite is
// about what the page renders when the READ fails, not what happens when a render throws.
vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import ChatPage from '@/app/tenant/chat/page';
import EmailsPage from '@/app/tenant/emails/page';
import PipelinesPage from '@/app/tenant/pipelines/page';

const EMAILS = '/api/tenant/email/tracking';
const CHAT = '/api/tenant/chat?status=active';
const PIPELINES = '/api/tenant/pipelines';
const THREAD = '/api/tenant/chat/s1/messages';

const NOW = '2026-03-04T10:00:00.000Z';
const emailRows = {
  data: [
    { id: 'e1', to: 'lead@example.test', subject: 'Site survey follow-up', status: 'delivered', opened_at: null, sent_at: NOW, created_at: NOW },
  ],
};
const sessions = {
  data: [
    { id: 's1', visitorId: 'v-42', visitorName: 'Ravi Sharma', visitorEmail: null, status: 'waiting', channel: 'web', assignedTo: null, createdAt: NOW },
  ],
};
const pipelineRows = {
  data: [
    { id: 'p1', name: 'Enterprise Deals', description: null, isDefault: true, createdAt: NOW, dealCount: 3, stages: [{ id: 'st1', pipelineId: 'p1', name: 'Qualified', order: 0, color: null }] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state #2872 is about: react-query keeps `data` while the refresh behind it fails. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

/** jsdom has no `Response`; the thread pane only ever reads `ok`, `status` and `json()`. */
const httpResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

// The pages build mutations and `queryClient.invalidateQueries` calls off a real client; only
// `useApiQuery` is stubbed above, so the provider still has to be there.
const render_ = (node: ReactNode) => {
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );
};

describe('emails: an unread outbox is not an empty outbox (#2829)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('refuses to say "No emails sent yet" about a read that never arrived', () => {
    registry.byUrl = { [EMAILS]: failed('Request failed (500)') };
    render_(<EmailsPage />);
    expect(screen.queryByText(/No emails sent yet/)).toBeNull();
    expect(alerts()).toContain('Failed to load your sent mail');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('still prints the sentence when a successful read genuinely found nothing', () => {
    registry.byUrl = { [EMAILS]: ok({ data: [] }) };
    render_(<EmailsPage />);
    expect(screen.getByText(/No emails sent yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the mail it has and names it the last read when a send-refetch refuses', () => {
    const result = staleRead(emailRows);
    registry.byUrl = { [EMAILS]: result };
    render_(<EmailsPage />);
    // test-send's onSuccess invalidates EMAILS_QUERY, so this is the state right after sending.
    expect(screen.getByText('lead@example.test')).toBeTruthy();
    expect(screen.getByText('Site survey follow-up')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh this list');
    expect(alerts()).toContain('the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/No emails sent yet/)).toBeNull();
  });

  it('binds Try again to the read that failed', () => {
    const result = failed();
    registry.byUrl = { [EMAILS]: result };
    render_(<EmailsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to a sentence rather than the word undefined', () => {
    registry.byUrl = { [EMAILS]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    render_(<EmailsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('chat: a session list nobody can see is not a queue nobody is in (#2829)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('names the outage instead of reporting an empty queue', () => {
    registry.byUrl = { [CHAT]: failed('Request failed (503)') };
    render_(<ChatPage />);
    expect(screen.queryByText('No sessions found')).toBeNull();
    expect(alerts()).toContain('Failed to load active sessions');
    expect(alerts()).toContain('Request failed (503)');
  });

  it('says the queue is empty only when the read says so', () => {
    registry.byUrl = { [CHAT]: ok({ data: [] }) };
    render_(<ChatPage />);
    // #2872's thread slice scoped this sentence to the status that was asked for: this read is
    // `?status=active`, so it is not evidence about every chat the tenant has.
    expect(screen.getByText('No active sessions')).toBeTruthy();
    expect(screen.queryByText('No sessions found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the waiting sessions a refused refresh could not clear', () => {
    const result = staleRead(sessions);
    registry.byUrl = { [CHAT]: result };
    render_(<ChatPage />);
    expect(screen.getByText('Ravi Sharma')).toBeTruthy();
    expect(alerts()).toContain('the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText('No sessions found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a thread that refused to load is not a visitor who never wrote', async () => {
    registry.byUrl = { [CHAT]: ok(sessions) };
    vi.stubGlobal('fetch', vi.fn(async () => httpResponse(500, { error: 'Server error' })));
    render_(<ChatPage />);
    fireEvent.click(screen.getByText('Ravi Sharma'));
    await waitFor(() => expect(alerts()).toContain('Failed to load this conversation'));
    expect(screen.queryByText('No messages yet')).toBeNull();
    expect(alerts()).toContain('Server error');
  });

  it('survives a fetch that throws instead of failing a request', async () => {
    registry.byUrl = { [CHAT]: ok(sessions) };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    render_(<ChatPage />);
    fireEvent.click(screen.getByText('Ravi Sharma'));
    await waitFor(() => expect(alerts()).toContain('Failed to load this conversation'));
    expect(alerts()).toContain('Failed to fetch');
  });

  it('shows the messages a successful thread read returned', async () => {
    registry.byUrl = { [CHAT]: ok(sessions) };
    const fetchMock = vi.fn(async () => httpResponse(200, {
      data: [{ id: 'm1', sessionId: 's1', senderType: 'visitor', senderId: null, content: 'Is anyone available?', createdAt: NOW }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    render_(<ChatPage />);
    fireEvent.click(screen.getByText('Ravi Sharma'));
    await waitFor(() => expect(screen.getByText('Is anyone available?')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(THREAD);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
});

/** The header's `{pipelines.length}` lives in a `span`, so the count sentence is split across
 *  elements and `getByText` cannot see it as one string. `textContent` on the paragraph can. */
const pipelineCountLine = () =>
  Array.from(document.querySelectorAll('p'))
    .map((p) => p.textContent ?? '')
    .find((t) => /pipelines?\b.*configured\b/.test(t)) ?? null;

describe('pipelines: a refused refresh stops eating the page (#2829 + #2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the pipelines a create just made visible when the refetch behind it fails', () => {
    const result = staleRead(pipelineRows);
    registry.byUrl = { [PIPELINES]: result };
    render_(<PipelinesPage />);
    // create/add-stage/delete all invalidate PIPELINES_QUERY, so this is the page's ordinary
    // post-action state. Before this slice it was a full-page "Failed to load pipelines" card.
    expect(screen.getByText('Enterprise Deals')).toBeTruthy();
    expect(pipelineCountLine()).toBe('1 pipeline configured');
    expect(alerts()).toContain('Could not refresh');
    expect(alerts()).toContain('the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/^Failed to load pipelines/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a list that never loaded is an outage, not "No pipelines yet"', () => {
    registry.byUrl = { [PIPELINES]: failed('Request failed (500)') };
    render_(<PipelinesPage />);
    expect(screen.queryByText('No pipelines yet')).toBeNull();
    expect(alerts()).toContain('Failed to load pipelines');
    expect(alerts()).toContain('Request failed (500)');
  });

  it('does not count zero pipelines while it cannot read any', () => {
    // The header states `{pipelines.length} pipelines configured`, which during an outage is the
    // same false sentence one element higher up, printed directly above the banner that refutes it.
    registry.byUrl = { [PIPELINES]: failed('Request failed (500)') };
    render_(<PipelinesPage />);
    expect(pipelineCountLine()).toBeNull();
  });

  it('says the tenant has none when a successful read found none', () => {
    registry.byUrl = { [PIPELINES]: ok({ data: [] }) };
    render_(<PipelinesPage />);
    expect(screen.getByText('No pipelines yet')).toBeTruthy();
    expect(pipelineCountLine()).toBe('0 pipelines configured');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a sentence rather than the word undefined', () => {
    registry.byUrl = { [PIPELINES]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    render_(<PipelinesPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('the ratchet this slice closes (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/chat/page.tsx', 'app/tenant/emails/page.tsx', 'app/tenant/pipelines/page.tsx'];

  it('leaves the baseline empty and the guard still armed', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    for (const f of FILES) {
      expect(files, `${f} is fixed; it must not stay allowlisted`).not.toContain(f);
    }
    // Three was the count these three names made. A ceiling, never an equality: pinning the number
    // is what #2858, #2865 and #2866 each had to undo when another slice honestly fixed a page.
    expect(files.length, 'nothing should be on the list now').toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'the screen must still be running, and still counting').toMatch(/OK — \d+ panel\(s\)/);
    // A fixed page left on the list is the honest-decay failure the guard warns about.
    expect(res.stdout).not.toContain('no longer offends');
  });

  it('teaches the guard its own lesson: rewinding any page re-lights it', async () => {
    // The screen passes a file on `bindsError && FAILURE_AFFORDANCE`, and the affordance it looks for
    // is the component's NAME anywhere in the source. So the import alone would satisfy it while the
    // branch that shows it was deleted — which is exactly the hole this rewrite cannot leave. Stripping
    // the name out has to bring the original offence back, on every page.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const rewind = src.replace(/InlineErrorState\b/g, 'PanelNotice');
      expect(rewind, `${f}: the affordance changed spelling, update this check`).not.toBe(src);
      expect(inspect(f, rewind).offends, `${f} no longer reads as an offence — the guard is not holding`).toBe(true);
    }
  });

  it('splits the outage from the stale read on all three pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/\bfailed \?/);
    }
  });

  it('catches the chat thread too, which the guard cannot see at all', () => {
    // `check-panel-error-state.mjs` only counts `useApiQuery`/`useQuery` hooks — `if (!queries) return
    // { offends: false }`. The thread pane is a plain fetch, so its false "No messages yet" is only
    // ever guarded by this file. Rewinding the branch must be visible here.
    const src = readFileSync(join(ROOT, 'app/tenant/chat/page.tsx'), 'utf8');
    expect(src).toMatch(/setMessagesError\(d\.error \|\| `Request failed \(\$\{res\.status\}\)`\)/);
    expect(src).toMatch(/err instanceof Error && err\.message \? err\.message : 'no response from the server'/);
    // #2872's thread slice split `messagesError` into "never read" and "read, but refused to
    // refresh" — the outage branch is `threadFailed` now, and the rows-still-on-screen branch is
    // `threadStale`. Either arm going back to swallowing the failure has to trip this file.
    expect(src, 'the thread pane is back to swallowing the failure').toMatch(/threadFailed \? \(/);
    expect(src, 'the transcript lost its stale state — a refused re-read is deleting rows again')
      .toMatch(/\{threadStale && \(/);
    expect(src).not.toMatch(/if \(res\.ok\) \{\n\s*const d = await res\.json\(\);\n\s*setMessages\(d\.data \?\? \[\]\);\n\s*\}\n\s*\} finally/);
  });

  it('retires the expired excuse on the emails page', () => {
    // "The tracking endpoint may 404 on older deploys" was the reason the page treated every error as
    // an empty list. The handler exists and `api-url-has-handler-2822` keeps it that way.
    const src = readFileSync(join(ROOT, 'app/tenant/emails/page.tsx'), 'utf8');
    expect(src).not.toMatch(/treat any error as an empty list/);
    expect(readFileSync(join(ROOT, 'app/api/tenant/email/tracking/route.ts'), 'utf8')).toMatch(/export const GET = withApiRoute/);
  });

  it('is what pipelines was grandfathered for: it no longer needs the exemption', () => {
    const lines = readFileSync(join(ROOT, 'app/tenant/pipelines/page.tsx'), 'utf8')
      .split('\n').length - 1;
    expect(lines, 'this page is 500 lines or under — the baseline entry can go').toBeLessThanOrEqual(500);
    const base = JSON.parse(readFileSync(join(ROOT, 'scripts/file-size-baseline.json'), 'utf8'));
    expect(base, 'still exempt, so the shrink is not counted').not.toHaveProperty('app/tenant/pipelines/page.tsx');
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a file that dropped under the ceiling should be off the list').not.toContain('remove them from the baseline');
  });
});
