// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the buyer-facing signature page, `app/p/sign/[token]/page.tsx`.
 *
 * One record, one `useQuery` (`retry: false`, `enabled` on the token in the URL), and a single branch
 * that treated "the read failed" and "the read answered and here is the document, but the refresh was
 * refused" as the same event: both fell into a centred card reading "Document not found" or "Unable to
 * load document" above "The link may have been cancelled or is incorrect. Please check the link or
 * contact the sender." There is no retry affordance on the page, and there never was one.
 *
 * This is the page where a person types their name as a legal signature, so the two accidents the one
 * branch merges have different costs here than anywhere else in the class.
 *
 * A refused refresh is not hypothetical weather. `lib/query/client.tsx:47-58` leaves
 * `refetchOnReconnect` at its default while switching `refetchOnWindowFocus` off, so a phone that
 * drops to the edge of a train's wifi and comes back revalidates `['public-sign', token]` while the
 * signer's thumb is already in the name box. react-query keeps the document and sets the error, and
 * the page answered that by discarding the document, the name it is addressed to, the activity trail
 * and the signature box — and telling the signer their own link was wrong. `retry: false` means the
 * read does not even try again on its own.
 *
 * A read that never answered deserves the same screen plus a way back. `app/api/public/sign/[token]/route.ts:45`
 * rate-limits the view to 60 per five minutes per caller before anything else, so a shared office NAT
 * genuinely produces a 429 here; a pool or RLS failure reaches the route's own catch and answers 500.
 * Neither is a statement about the link, and neither had a retry.
 *
 * What is NOT changed, on purpose:
 *
 *  - `route.ts:50` and `:54` 404 uniformly for a token that does not resolve, and that *is* an answer.
 *    "Document not found" stays, with no alert and no retry button — retrying an answer does not help.
 *  - signing over a stale read stays possible. The write re-checks the record —
 *    `route.ts:131` refuses a request this signer already resolved (409) and `:133` refuses anything it
 *    cannot record — so the caveat names what may have moved and the decision stays with the signer
 *    rather than the button silently disappearing. Pinned below so a reviewer sees the call.
 *  - the opposite, though: over a read that never answered, there is no signature box on the page. A
 *    name typed against a document this session failed to read is exactly the write that must not go.
 *
 * RED AT BASE. Measured against the page as it stands on `origin/main` in a clean tree; the count is
 * in the PR body. The cases that pass at base are the controls — the answered 404, the clean render,
 * the two terminal banners, the answered zero activity trail, the first-load spinner, and the pins
 * that only read the source.
 *
 * Fixtures are documentation-only (RFC 2606 .example names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense } from 'react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import PublicSignPage from '@/app/p/sign/[token]/page';

const TOKEN = 'sig-4f';
const SIGN_URL = `/api/public/sign/${TOKEN}`;
const QUERY_KEY = ['public-sign'];

type Rule =
  | { json: unknown }
  | { status: number; error?: string }
  | { networkError: string }
  | { pending: true };

const net = {
  get: [] as Rule[],
  consumed: 0,
  post: { json: { ok: true } } as Rule,
  calls: [] as string[],
  bodies: [] as string[],
};

const DOC = {
  signer: { name: 'Ada Byron', email: 'ada@example.com' },
  request: { id: 'sr-1', status: 'sent', signed_at: null, declined_at: null },
  document: { id: 'doc-1', name: 'Reseller agreement — Northgate' },
  seller: { name: 'Northgate Logistics', logo: null, primary_color: '#0f766e' },
  events: [
    { event: 'viewed', signerEmail: 'ada@example.com', eventAt: '2026-10-02T09:00:00Z' },
    { event: 'sent', signerEmail: 'ada@example.com', eventAt: '2026-10-01T08:00:00Z' },
  ],
};

const DOC_SIGNED = {
  ...DOC,
  request: { ...DOC.request, status: 'signed', signed_at: '2026-10-03T10:00:00Z' },
};
const DOC_DECLINED = {
  ...DOC,
  request: { ...DOC.request, status: 'declined', declined_at: '2026-10-03T10:00:00Z' },
};

function rule(r: Rule): Response {
  if ('pending' in r) return new Promise(() => undefined) as unknown as Response;
  if ('networkError' in r) throw new TypeError(r.networkError);
  if ('status' in r) {
    return { ok: false, status: r.status, json: async () => ({ error: r.error }) } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => r.json } as unknown as Response;
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  net.get = [{ json: DOC }];
  net.consumed = 0;
  net.post = { json: { ok: true } };
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
});

async function mountPage() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <PublicSignPage params={Promise.resolve({ token: TOKEN })} />
        </Suspense>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  return view;
}

const text = (view: ReturnType<typeof render>) => view.container.textContent ?? '';
const alerts = () => screen.queryAllByRole('alert');
const exactly = (needle: string) => screen.getByText((_, el) => el?.textContent === needle);
const gets = () => net.calls.filter(c => c.startsWith('GET')).length;

async function mountLoaded() {
  const view = await mountPage();
  await waitFor(() => expect(text(view)).toContain('Reseller agreement — Northgate'));
  return view;
}

/** The read answers, then a refresh of the very same key is refused. */
async function refusedRefresh(status = 502, error = 'Bad gateway', record: unknown = DOC) {
  net.get = [{ json: record }, { status, error }, { json: record }];
  net.consumed = 0;
  const view = await mountLoaded();
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
  await waitFor(() => expect(gets()).toBe(2));
  return view;
}

describe('the public sign page — a refresh that was refused keeps the document', () => {
  it('keeps the document, the addressee and the activity trail on screen', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s).toContain('Reseller agreement — Northgate');
    expect(s).toContain('Ada Byron');
    expect(s).toContain('ada@example.com');
    expect(s).toContain('Activity');
    expect(s).toContain('viewed');
    expect(s).toContain('Northgate Logistics');
  });

  it('raises exactly one alert that names what may have moved', async () => {
    await refusedRefresh();
    expect(alerts()).toHaveLength(1);
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toMatch(/last read/i);
    expect(banner, 'the banner must name the document itself').toMatch(/document/i);
    expect(banner, 'the banner must name whether it is already signed').toMatch(/signed/i);
  });

  it('does not tell a signer mid-name that their link is dead', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s, 'a stale read may not claim the link was cancelled').not.toMatch(/cancelled/i);
    expect(s).not.toMatch(/incorrect/i);
    expect(s).not.toMatch(/not found/i);
  });

  it('keeps the signature box usable over the stale read', async () => {
    const view = await refusedRefresh();
    const input = view.container.querySelector('input') as HTMLInputElement | null;
    expect(input, 'a stale read must not take the name box away').toBeTruthy();
    const sign = exactly('Sign document') as HTMLButtonElement;
    expect(sign.disabled, 'an empty name still cannot sign').toBe(true);
    fireEvent.change(input!, { target: { value: 'Ada Byron' } });
    expect((exactly('Sign document') as HTMLButtonElement).disabled).toBe(false);
    expect(text(view)).toContain('Adopt your signature');
  });

  it('a signer adopting their name over the stale read still gets it to the server', async () => {
    const view = await refusedRefresh();
    const input = view.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ada Byron' } });
    fireEvent.click(exactly('Sign document'));
    await waitFor(() => expect(net.calls).toContain(`POST ${SIGN_URL}`));
    expect(net.bodies[0]).toContain('sign');
    await waitFor(() => expect(text(view)).toContain('Document signed'));
    expect(text(view)).toContain('Thank you, Ada Byron');
  });

  it("the stale banner's Try again re-reads, and the caveat leaves when the read answers", async () => {
    const view = await refusedRefresh(500, 'Internal server error');
    expect(alerts()).toHaveLength(1);
    expect(screen.getAllByText('Try again')).toHaveLength(1);
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(gets()).toBe(3));
    await waitFor(() => expect(alerts()).toHaveLength(0));
    expect(text(view)).toContain('Reseller agreement — Northgate');
  });

  it('a stale read whose document is already signed keeps its banner and adds the caveat', async () => {
    const view = await refusedRefresh(503, 'Unavailable', DOC_SIGNED);
    expect(text(view)).toContain('Document signed');
    expect(alerts()).toHaveLength(1);
    expect(view.container.querySelector('input'), 'a signed document must not regain a name box').toBeNull();
  });
});

describe('the public sign page — a read that never answered', () => {
  it('a 500 is an outage with a way back, not a verdict on the link', async () => {
    net.get = [{ status: 500, error: 'Internal server error' }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    const s = text(view);
    expect(s).toContain('Try again');
    expect(s, 'an outage may not blame the link').not.toMatch(/cancelled|incorrect/);
    expect(s).not.toMatch(/not found/i);
  });

  it('quotes the server in its own words', async () => {
    net.get = [{ status: 500, error: 'Signing lookup failed' }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Signing lookup failed');
    expect(text(view)).not.toMatch(/undefined|\[object Object\]/);
  });

  it('a fetch the network refused is an outage, and Try again re-reads', async () => {
    net.get = [{ networkError: 'Failed to fetch' }, { json: DOC }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(text(view)).toContain('Reseller agreement — Northgate'));
    expect(alerts()).toHaveLength(0);
  });

  it('the public rate limit (429) is an outage, not a dead link', async () => {
    net.get = [{ status: 429, error: 'Too many requests' }, { json: DOC }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Too many requests');
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(text(view)).toContain('Reseller agreement — Northgate'));
  });

  it('an answered 2xx with an empty body is not a statement that the document is gone', async () => {
    net.get = [{ json: null }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(text(view)).not.toMatch(/not found|cancelled|incorrect/i);
  });

  it('nothing was read, so nothing can be signed: no name box, no document, no activity', async () => {
    net.get = [{ status: 500 }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(view.container.querySelectorAll('input')).toHaveLength(0);
    const s = text(view);
    expect(s).not.toContain('Adopt your signature');
    expect(s).not.toContain('Reseller agreement');
    expect(s).not.toContain('Activity');
  });

  it('the outage leaves the signer on the page, not somewhere else', async () => {
    net.get = [{ status: 500 }];
    const before = window.location.href;
    await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
    expect(gets()).toBe(1);
  });
});

describe('the public sign page — reads that answered stay answers', () => {
  it('a 404 is "Document not found", with no alert and no retry', async () => {
    net.get = [{ status: 404, error: 'Signing request not found' }];
    const view = await mountPage();
    await waitFor(() => expect(text(view)).toContain('Document not found'));
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('a clean read renders the document and says nothing about freshness', async () => {
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    const s = text(view);
    expect(s).toContain('Prepared for');
    expect(s).toContain('Adopt your signature');
    expect(s).toContain('Signature request');
    expect(gets()).toBe(1);
  });

  it('a document the server already signed shows its banner and no name box', async () => {
    net.get = [{ json: DOC_SIGNED }];
    const view = await mountLoaded();
    expect(text(view)).toContain('Document signed');
    expect(view.container.querySelector('input')).toBeNull();
    expect(alerts()).toHaveLength(0);
  });

  it('a document the server already declined says so', async () => {
    net.get = [{ json: DOC_DECLINED }];
    const view = await mountLoaded();
    expect(text(view)).toContain('declined to sign');
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('a document with no events is an answered zero, not an outage', async () => {
    net.get = [{ json: { ...DOC, events: [] } }];
    const view = await mountLoaded();
    expect(text(view)).not.toContain('Activity');
    expect(text(view)).toContain('Reseller agreement — Northgate');
    expect(alerts()).toHaveLength(0);
  });

  it('the first load is a spinner, not an outage card and not a blank page', async () => {
    net.get = [{ pending: true }];
    const view = await mountPage();
    await waitFor(() => expect(view.container.querySelector('.animate-spin')).toBeTruthy());
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('the sign page is mounted by no other suite', () => {
    const hits = spawnSync('grep', ['-rlF', 'p/sign/[token]/page', 'tests/unit'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-public-sign-stale-2872.test.tsx',
    ]);
  });
});

describe('the public sign page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/p/sign/[token]/page.tsx'), 'utf8');

  it('no branch of the render is gated on the flag alone', () => {
    expect(src).not.toMatch(/if\s*\(\s*error\s*\|\|\s*!data\s*\)/);
    expect(src).not.toMatch(/if\s*\(\s*error\s*\)/);
  });

  it('a refused refresh is derived, in the house shape', () => {
    expect(src).toMatch(/Boolean\(error\)\s*&&\s*Boolean\(data\)/);
    expect(src).toMatch(/error\?\.message \|\| 'no response from the server'/);
  });

  it('the answered arm only answers when nothing is on screen', () => {
    const line = src.split('\n').find(l => l.includes('errorStatus === 404')) ?? '';
    expect(line, 'the 404 arm must be reachable only without a record').toMatch(/!data|failed/);
  });

  it('uses the shared banner twice and never a hand-rolled alert', () => {
    expect(src).toMatch(/from '@\/components\/shared\/inline-error-state'/);
    expect(src).not.toMatch(/role="alert"/);
    expect((src.match(/onRetry=\{refetch\}/g) ?? []).length).toBe(2);
  });

  it('the outage copy and the stale copy both interpolate the reason', () => {
    expect(src).toMatch(/\$\{reason\}/);
    expect(src).not.toMatch(/String\(error\)|error\.stack|\{error\}/);
  });

  it('the signature box is still gated on the record, not on freshness', () => {
    expect(src).toMatch(/\{!resolved && \(/);
    expect(src).not.toMatch(/!resolved && !stale/);
  });

  it('the stale banner sits above the document card it qualifies', () => {
    const banner = src.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(src.indexOf('Document card')).toBeGreaterThan(banner);
  });

  it('the read keeps its own retry policy and gains no background refresh', () => {
    expect(src).toMatch(/retry: false/);
    expect(src).not.toMatch(/refetchOnWindowFocus|invalidateQueries|location\.reload|location\.assign|setInterval/);
  });

  it('nothing navigates away from a failed read', () => {
    expect(src).not.toMatch(/useRouter|router\.push|window\.location\s*=/);
  });

  it('this page is read by exactly one query', () => {
    expect((src.match(/useQuery</g) ?? []).length).toBe(1);
  });

  it('stays inside the line ceiling the repo guard enforces', () => {
    const run = spawnSync(process.execPath, ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});
