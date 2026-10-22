// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/portal/(protected)/kb/[id]/page.tsx`: the customer-facing knowledge-base article read
 * bound no `error` at all, so its single `!article` branch answered *every* failure with "Article not
 * found".
 *
 *     const { data, isLoading } = useApiQuery<{ data: KBArticle }>(…);
 *     const article = data?.data ?? null;
 *     …
 *     if (!article) return <…>Article not found</…>;
 *
 * `useApiQuery` keeps `data` through a refused revalidation of a read that already succeeded and sets
 * `error` at the same time (lib/query/client.tsx). Two consequences the reader — a customer hunting for
 * the answer to their own problem — paid for:
 *
 *   - a load that never answered (a 500, a dead pool, a fetch that never got there) sent `data`
 *     undefined, so `!article` was true and the page told a customer their article was *gone* when the
 *     server had never been reached about it; and
 *   - a refresh refused on top of an already-loaded article kept the article on screen and said nothing
 *     about its freshness — the view count, category and body were presented as current with no caveat.
 *
 * Now `failed = Boolean(error) && !data` is an outage with a retry, `stale = Boolean(error) &&
 * Boolean(data)` keeps the article and adds the caveat (the helpful-vote stays reachable), and a 404/410
 * — the route's real `NextResponse.json({ error: 'Not found' }, { status: 404 })` — is an answer that
 * renders the not-found state, never a "last read" hedge. A 404 arriving on top of a kept read is a
 * refused refresh, not a vanished article.
 *
 * RED AT BASE — measured with the page file rewound to origin/main and this file as committed:
 * **5 failed | 6 passed (11)**. With the fix: **11 passed (11)**. The six that pass at base are the
 * controls the base already honoured — a healthy article, the 404 not-found verdict (the one thing the
 * `!article` branch got right), and the helpful-vote/guard/line-ceiling/overlap ratchets. The five that
 * fail are the refused-refresh-over-a-kept-article pair (no caveat at base), both outages (the base told
 * the customer the article was *gone*), and the source ratchet pinning the split the base did not have.
 *
 * Fixtures are documentation-only (RFC 2606 `.test` names; TEST-NET-style ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
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
const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'kb-aaaa0000-0000-4000-8000-000000000000' }),
  useRouter: () => mockRouter,
}));

import PortalKBArticlePage from '@/app/portal/(protected)/kb/[id]/page';

const KB_URL = '/api/public/kb/articles/kb-aaaa0000-0000-4000-8000-000000000000';

const ARTICLE = {
  data: {
    id: 'kb-aaaa0000-0000-4000-8000-000000000000',
    title: 'How to reset your password',
    content: 'Open Settings and choose Reset.',
    categoryName: 'Account',
    views: 42,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

const ok = (data: unknown = ARTICLE): QueryResult => ({
  data, error: null, isLoading: false, refetch: vi.fn(),
});
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const refusedRefresh = (message = 'Request failed (504)'): QueryResult => ({
  data: ARTICLE, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const notFoundResult = (): QueryResult => ({
  data: undefined,
  error: Object.assign(new Error('Request failed (404)'), { status: 404 }),
  isLoading: false, refetch: vi.fn(),
});
const mute = (data?: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const claimsOutsideAlerts = (re: RegExp) =>
  screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);

function mount(result: QueryResult) {
  registry.byUrl = { [KB_URL]: result };
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PortalKBArticlePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registry.byUrl = {};
  // the page only enables its read once a portal session is in localStorage with an email.
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ email: 'visitor@acme.test' }), setItem: () => {}, removeItem: () => {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the answer the customer came for (#2872)', () => {
  it('a healthy read shows the article and says nothing about failure', async () => {
    mount(ok());
    await waitFor(() => expect(screen.getByText('How to reset your password')).toBeTruthy());
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/Article not found/)).toEqual([]);
  });

  it('a refused refresh keeps the article and calls it the last read', async () => {
    const read = refusedRefresh();
    mount(read);
    await waitFor(() => expect(screen.getByText('How to reset your password')).toBeTruthy());
    // content stays, and the helpful-vote stays reachable over a last read.
    expect(screen.getByText('Open Settings and choose Reset.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /yes/i })).toBeTruthy();
    expect(alerts()).toContain('this article is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Article not found/)).toEqual([]);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a messageless refusal names the server instead of printing undefined', async () => {
    mount(mute(ARTICLE));
    await waitFor(() => expect(alerts()).toContain('this article is the last read: no response from the server'));
    expect(alerts()).not.toContain('undefined');
  });
});

describe('a read that never answered is an outage, not a vanished article (#2872)', () => {
  it('a refusal with nothing kept shows the outage and retires "Article not found"', async () => {
    const read = unread('Request failed (500)');
    mount(read);
    await waitFor(() => expect(alerts()).toContain('Could not load this article: Request failed (500)'));
    expect(claimsOutsideAlerts(/Article not found/)).toEqual([]);
    expect(alerts()).not.toContain('last read');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // the retry refreshes the read; it never writes to the article.
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { seen.push(init ?? {}); return { ok: true, json: async () => ({}) }; }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(seen.every((c) => (c.method ?? 'GET').toUpperCase() !== 'POST')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('a messageless outage prints the server sentence, never undefined', async () => {
    mount(mute());
    await waitFor(() => expect(alerts()).toContain('no response from the server'));
    expect(alerts()).not.toContain('undefined');
  });
});

describe('a 404 is the server answering that the article is gone (#2872)', () => {
  it('renders the not-found state, not a "last read" hedge or an outage banner', async () => {
    mount(notFoundResult());
    await waitFor(() => expect(screen.getByText('Article not found')).toBeTruthy());
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/Could not load this article/)).toEqual([]);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/portal/(protected)/kb/[id]/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('binds the read error and splits failed / stale / not-found', () => {
    const s = src();
    expect(s).toMatch(/error, refetch \} = useApiQuery/);
    expect(s).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(s).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/const notFound = failed && \(status === 404 \|\| status === 410\)/);
    expect(s, 'a not-found read is folded back into the outage').toMatch(/if \(failed && !notFound\) return/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/<InlineErrorState/);
  });

  it('keeps the helpful-vote reachable over a last read', () => {
    const s = src();
    expect(s, 'the vote buttons started refusing a read that answered').not.toMatch(/disabled=\{[^}]*stale/);
  });

  it('reuses #2829\'s guard and baseline honestly', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    expect(inspect(FILE, src()).offends, 'the fixed page offends the guard').toBe(false);
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files).toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('stays inside the line ceiling', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
  });

  it('leaves this page to one #2872 suite', () => {
    const mine = 'panel-page-error-not-empty-portal-kb-article-stale-2872.test.tsx';
    const speakers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx') && f !== mine && /2872/.test(f))
      .filter((f) => /portal\/\(protected\)\/kb\/\[id\]\/page/.test(readFileSync(join(ROOT, 'tests/unit', f), 'utf8')));
    expect(speakers, `${mine} is not the only #2872 suite on this page`).toEqual([]);
  });
});
