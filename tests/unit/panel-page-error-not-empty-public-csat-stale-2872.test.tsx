// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/public/csat/[token]/page.tsx`: the smallest stranger-facing surface in the app, and
 * the flattest lie in the epic. One read (`useApiQuery`, `retry: false` because #2383 put a 60-per-5-min
 * throttle on this GET), and every outcome funnelled through one `useEffect` into one local string:
 *
 *   if (queryError) { setError('Invalid survey link'); return; }
 *
 * `app/api/public/csat/[token]/route.ts` answers that request four distinguishable ways — **404**
 * "Survey not found" (`:34` for a token that is not 48 lowercase hex, `:51` for no row), **400**
 * "Already responded" (`:52`), **429** from the view throttle at `:30`, which fires before the route
 * looks anything up — plus the 500 from `apiError` at `:56`. The page called all of them "Invalid
 * survey link". A customer who had already answered, in another tab or on another device, was told
 * their link was broken; a customer whose IP had just tripped the throttle was told the same thing,
 * with no way to ask again. And because the sentence lives on screen rather than in a four-second
 * toast, the lie is the durable one.
 *
 * Four states now, the answers staying answers:
 *
 *  - **404** → the server's own words, "Survey not found", **no alert and no retry**: asking again
 *    cannot make a token that matches no row start matching one.
 *  - **400** (the only 400 this GET returns is `:52`) → "You have already responded to this survey",
 *    which is the sentence the page already knew how to say and then overwrote. No retry either, and
 *    no five faces to click — the answer is already in the row.
 *  - **429 / 500 / a fetch the visitor's own network refused / a 2xx whose body came back empty** →
 *    the outage card: the reason, `Try again`, and **no emoji buttons, no textarea, no submit**.
 *    Nobody spends a rating on a survey this session failed to read, and unlike an operator this
 *    visitor has no other way to ask.
 *  - **stale** (the survey is on screen and a later refresh of that key was refused) → the faces stay
 *    clickable and submitting stays possible, under one banner naming the one thing that read decided:
 *    whether they had already answered.
 *
 * The local `error` becomes what it always should have been — the **write** channel. A refused submit
 * still shows its piece (`Score must be 1-5`, route.ts:73) and keeps the screen it belongs to; a failed
 * *read* never touches it again, which is why "Invalid survey link" is pinned absent from the source.
 * `retry: false` is pinned kept: #2383's throttle is why the page asks once, and this change is about
 * what a refusal says, not how often it asks.
 *
 * RED AT BASE. Measured against the page as it stands on `origin/main` in a clean detached tree; the
 * count is in the PR body. Fixtures are documentation-shaped (a 48-hex token, no real tenant).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/public/csat/' + TOKEN,
  useSearchParams: () => new URLSearchParams(),
}));

import CsatPage from '@/app/public/csat/[token]/page';

const TOKEN = 'a'.repeat(48);
const READ_URL = `/api/public/csat/${TOKEN}`;
const QUERY_KEY = ['csat', TOKEN];

type Rule =
  | { json: unknown }
  | { status: number; body?: Record<string, unknown> }
  | { networkError: string }
  | { pending: true };

const net = {
  get: [] as Rule[],
  consumed: 0,
  post: { json: {} } as Rule,
  calls: [] as string[],
  bodies: [] as string[],
};

const SURVEY = { data: { id: 'csat-1', score: null, comment: null, respondedAt: null } };
const NOT_FOUND = { status: 404, body: { error: 'Survey not found' } } as Rule;
const RESPONDED = { status: 400, body: { error: 'Already responded' } } as Rule;
const THROTTLED = { status: 429, body: { error: 'Too many requests' } } as Rule;

function rule(r: Rule): Response {
  if ('pending' in r) return new Promise(() => undefined) as unknown as Response;
  if ('networkError' in r) throw new TypeError(r.networkError);
  if ('status' in r) {
    return { ok: false, status: r.status, json: async () => r.body ?? {} } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => r.json } as unknown as Response;
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  net.get = [{ json: SURVEY }];
  net.consumed = 0;
  net.post = { json: {} };
  net.calls = [];
  net.bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    net.calls.push(`${method} ${url}`);
    if (method === 'POST') {
      if (typeof init?.body === 'string') net.bodies.push(init.body);
      return rule(net.post);
    }
    const i = Math.min(net.consumed, net.get.length - 1);
    net.consumed += 1;
    return rule(net.get[i]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.clear();
  vi.clearAllMocks();
});

function mountPage() {
  return render(
    <QueryClientProvider client={client}>
      <CsatPage />
    </QueryClientProvider>,
  );
}

const text = (view: ReturnType<typeof render>) => view.container.textContent ?? '';
const alerts = () => screen.queryAllByRole('alert');
const gets = () => net.calls.filter(c => c.startsWith('GET')).length;
// The five faces carry a `title`; the outage card's own "Try again" is a button too, so counting
// every button would let an outage look like a survey.
const faces = (view: ReturnType<typeof render>) => view.container.querySelectorAll('button[title]').length;

async function mountLoaded() {
  const view = mountPage();
  await waitFor(() => expect(text(view)).toContain('How was your experience?'));
  return view;
}

/** The read answers, then a refresh of that very key is refused. */
async function refusedRefresh(status = 500, body: Record<string, unknown> = { error: 'Internal server error' }) {
  net.get = [{ json: SURVEY }, { status, body }, { json: SURVEY }];
  const view = await mountLoaded();
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
  await waitFor(() => expect(gets()).toBe(2));
  return view;
}

describe('the CSAT page — a refused refresh keeps the survey', () => {
  it('keeps the five faces and the comment box the visitor was using', async () => {
    const view = await refusedRefresh();
    expect(text(view)).toContain('How was your experience?');
    expect(faces(view)).toBe(5);
    expect(view.container.querySelector('textarea')).toBeTruthy();
  });

  it('raises exactly one alert about what that read decided', async () => {
    await refusedRefresh();
    expect(alerts()).toHaveLength(1);
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toMatch(/last read/i);
    expect(banner, 'the banner must name what is at risk').toMatch(/respond|answer/i);
  });

  it('a rating picked over the stale read still gets posted', async () => {
    const view = await refusedRefresh();
    fireEvent.click(screen.getByTitle('Excellent'));
    expect(text(view), 'the caveat must not swallow the choice the visitor just made').toContain('Excellent');
    fireEvent.click(screen.getByText('Submit Feedback'));
    await waitFor(() => expect(net.calls).toContain(`POST ${READ_URL}`));
    expect(net.bodies[0]).toContain('"score":5');
  });

  it("the banner's Try again re-reads, and the caveat leaves when the read answers", async () => {
    const view = await refusedRefresh(502, { error: 'Bad gateway' });
    expect(alerts()).toHaveLength(1);
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(gets()).toBe(3));
    await waitFor(() => expect(alerts()).toHaveLength(0));
    expect(text(view)).toContain('How was your experience?');
  });

  it('a submission that succeeded over the stale read ends on the thank-you card, not the caveat', async () => {
    const view = await refusedRefresh();
    fireEvent.click(screen.getByTitle('Good'));
    fireEvent.click(screen.getByText('Submit Feedback'));
    await waitFor(() => expect(text(view)).toContain('Thank you!'));
    expect(alerts(), 'a recorded answer must not still be told the read is behind').toHaveLength(0);
  });
});

describe('the CSAT page — a read that never answered', () => {
  it('a 500 is an outage with a way back, and no survey to answer', async () => {
    net.get = [{ status: 500, body: { error: 'Internal server error' } }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(faces(view)).toBe(0);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(text(view)).not.toContain('How was your experience?');
  });

  it('the outage speaks in the reason, in the reader’s own words', async () => {
    net.get = [{ status: 500, body: { error: 'Internal server error' } }];
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Request failed (500)');
    expect(alerts()[0].textContent).toMatch(/could not be read|could not be checked/i);
  });

  it('a fetch the visitor refused is an outage, and Try again recovers', async () => {
    net.get = [{ networkError: 'Failed to fetch' }, { json: SURVEY }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('How was your experience?'));
    expect(alerts()).toHaveLength(0);
  });

  it('a 429 from the throttle this route applies is an outage, not a verdict on the link', async () => {
    net.get = [THROTTLED, { json: SURVEY }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(alerts()[0].textContent).toContain('Request failed (429)');
    expect(text(view)).not.toMatch(/invalid|not found|broken/i);
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(text(view)).toContain('How was your experience?'));
  });

  it('an answered 2xx with an empty body is an outage, not a survey', async () => {
    net.get = [{ json: null }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(faces(view)).toBe(0);
  });

  it('the outage never calls the link invalid', async () => {
    net.get = [{ status: 500, body: {} }];
    const view = mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).not.toMatch(/invalid/i);
  });

  it('the outage leaves the visitor on the page, not somewhere else', async () => {
    net.get = [{ status: 500, body: {} }];
    const before = window.location.href;
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
  });
});

describe('the CSAT page — reads that answered stay answers', () => {
  it('a 404 says the server’s words, with no alert and no retry', async () => {
    net.get = [NOT_FOUND];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toContain('Survey not found'));
    expect(text(view), 'a missing row is not a broken link').not.toMatch(/invalid/i);
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
    expect(faces(view)).toBe(0);
  });

  it('a 400 says already responded, which is not the same sentence as an invalid link', async () => {
    net.get = [RESPONDED];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toMatch(/already responded/i));
    expect(text(view)).not.toMatch(/invalid/i);
    expect(alerts(), 'the route answered this question').toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
    expect(faces(view)).toBe(0);
  });

  it('a 200 whose row already carries respondedAt is the same answer through the other door', async () => {
    net.get = [{ json: { data: { id: 'csat-1', score: 5, comment: null, respondedAt: '2026-10-21T10:00:00Z' } } }];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toMatch(/already responded/i));
    expect(faces(view)).toBe(0);
    expect(alerts()).toHaveLength(0);
  });

  it('a 200 that carries the server’s own refusal still says the server’s piece', async () => {
    net.get = [{ json: { error: 'This survey has closed' } }];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toContain('This survey has closed'));
    expect(text(view)).not.toMatch(/invalid/i);
    expect(alerts()).toHaveLength(0);
  });

  it('a clean read renders the survey and says nothing about freshness', async () => {
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    expect(text(view)).toContain('Your feedback helps us improve');
    expect(faces(view)).toBe(5);
    expect(gets()).toBe(1);
    expect(net.calls).toContain(`GET ${READ_URL}`);
  });

  it('picking a face labels the choice and submitting posts it', async () => {
    const view = await mountLoaded();
    fireEvent.click(screen.getByTitle('Very Poor'));
    expect(text(view)).toContain('Very Poor');
    fireEvent.change(view.container.querySelector('textarea')!, { target: { value: 'Took a week.' } });
    fireEvent.click(screen.getByText('Submit Feedback'));
    await waitFor(() => expect(net.calls).toContain(`POST ${READ_URL}`));
    expect(net.bodies[0]).toContain('"score":1');
    expect(net.bodies[0]).toContain('Took a week.');
    await waitFor(() => expect(text(view)).toContain('Thank you!'));
  });

  it('a submit the server refused says its piece and raises no read alert', async () => {
    net.post = { status: 400, body: { error: 'Score must be 1-5' } };
    const view = await mountLoaded();
    fireEvent.click(screen.getByTitle('Average'));
    fireEvent.click(screen.getByText('Submit Feedback'));
    await waitFor(() => expect(text(view)).toContain('Score must be 1-5'));
    expect(alerts(), 'a write failure is not a read failure').toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('the first load is the loading state, not an outage card and not a blank page', async () => {
    net.get = [{ pending: true }];
    const view = mountPage();
    await waitFor(() => expect(text(view)).toContain('Loading...'));
    expect(alerts()).toHaveLength(0);
    expect(faces(view)).toBe(0);
  });

  it('this page is mounted by no other suite', () => {
    const hits = spawnSync('grep', ['-rlF', 'public/csat/[token]/page', 'tests/unit'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-public-csat-stale-2872.test.tsx',
    ]);
  });
});

describe('the CSAT page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/public/csat/[token]/page.tsx'), 'utf8');

  it('the read no longer speaks through the shared write channel', () => {
    expect(src).not.toMatch(/useEffect/);
    expect(src).not.toMatch(/if \(queryError\) \{ setError\(/);
    expect(src, 'the flattened lie is gone from the file').not.toMatch(/Invalid survey link/);
  });

  it('a refused refresh is derived, in the house shape', () => {
    expect(src).toMatch(/Boolean\(readError\)\s*&&\s*Boolean\(data\)/);
    expect(src).toMatch(/readError\?\.message \|\| 'no response from the server'/);
  });

  it('the answered arms only answer when nothing is on screen', () => {
    for (const needle of ['=== 404', '=== 400']) {
      const line = src.split('\n').find(l => l.includes(needle)) ?? '';
      expect(line, `the ${needle} arm must be reachable only without a record`).toMatch(/!data|failed/);
    }
  });

  it('the answered arms read the status the route returns, not a string it invented', () => {
    expect(src).toMatch(/status === 404/);
    expect(src).toMatch(/status === 400/);
  });

  it('uses the shared banner twice and never a hand-rolled alert', () => {
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
    expect((src.match(/onRetry=\{refetch\}/g) ?? []).length).toBe(2);
  });

  it('the outage copy and the stale copy both interpolate the reason', () => {
    expect(src).toMatch(/\$\{reason\}/);
    expect(src).not.toMatch(/String\(readError\)|readError\.stack|\{readError\}/);
  });

  it('the survey is still gated on the record, not on freshness', () => {
    expect(src).not.toMatch(/!stale && \(/);
    expect(src).toMatch(/emojis\.map/);
  });

  it('the stale banner sits above the faces it qualifies', () => {
    const banner = src.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(src.indexOf('emojis.map')).toBeGreaterThan(banner);
    expect(src.indexOf('if (submitted)'), 'a recorded answer returns before any caveat').toBeLessThan(banner);
  });

  it('the read keeps the one-ask budget #2383 minted and gains no background refresh', () => {
    expect(src).toMatch(/retry: false/);
    expect(src).not.toMatch(/refetchOnWindowFocus|invalidateQueries|location\.reload|location\.assign|setInterval/);
  });

  it('nothing navigates away from a failed read', () => {
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
  });

  it('this page is read by exactly one query', () => {
    expect((src.match(/useApiQuery</g) ?? []).length).toBe(1);
  });

  it('the write channel stays the write channel', () => {
    expect(src).toMatch(/setError\(d\.error \|\| 'Failed to submit'\)/);
    expect(src).toMatch(/\{error\}/);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
