// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the buyer-facing offer page, `app/p/offers/[publicToken]/page.tsx`.
 *
 * It reads one record with one `useQuery` (`retry: false`, `enabled` on the token in the URL), and
 * until now it looked at the flag alone: an error and a missing body both landed in the same centred
 * card, whose only text was "The link may have been cancelled or is incorrect. Please check the link
 * or contact the sender." There was no retry affordance anywhere on the page.
 *
 * Two separate accidents live in that one branch, and the buyer cannot tell them apart.
 *
 * The first is a refused refresh. `lib/query/client.tsx:47-58` switches off `refetchOnWindowFocus`
 * but leaves `refetchOnReconnect` at its default, so a laptop that wakes on a hotel wifi revalidates
 * `['public-offer', token]` under the eyes of a buyer halfway through typing a signature.
 * react-query keeps the record and sets the error — and the page threw the offer away and told that
 * buyer their link was dead. Worse than the lie: the CTA left with it, so the offer was still open
 * and the one action this page exists for was no longer on screen.
 *
 * The second is a read that never answered — a 500, a 429 from the aggressive public rate limit that
 * `app/api/public/offers/[publicToken]/route.ts:45` puts before anything else, a 503, or a fetch the
 * network refused. That deserves the same card it half-gets today plus the one thing it has never
 * had: **Try again**. With `retry: false` there is no other path back — a buyer on a metered
 * connection who blinks once is simply told their link is wrong, and the link is not wrong.
 *
 * Both stay distinct from the arms that are *answers*. `route.ts:52` and `:58` return 404 for a token
 * that does not resolve or an offer in a state the public may not see; `route.ts:158` returns 410 for
 * an offer this very read has just auto-expired. Those are the server answering the question, so
 * "Offer not found" and "This offer has expired" stay exactly as they are — no alert, no retry,
 * because a retry cannot help when the answer was no.
 *
 * What is deliberately NOT changed: accepting over a stale read stays possible. The write is the
 * authority — `app/api/public/offers/[publicToken]/accept/route.ts:61` refuses a state that cannot be
 * accepted and `:113` refuses one that has expired since — so the banner says the record may have
 * moved and leaves the decision with the buyer instead of silently disabling the button. Pinned
 * below, because it is a judgement a reviewer should see rather than an oversight.
 *
 * An answered-but-empty body (a 2xx whose json came back null) is a third case, and it must not be
 * allowed to read as "not found": nothing was answered about the link.
 *
 * RED AT BASE. Measured against the page as it stands on `origin/main` in a clean tree; the count is
 * in the PR body. The cases that pass at base are the controls — the two answered arms, the clean
 * render, the money a kept read still prints, the answered zero line items, the terminal banners, the
 * first-load spinner, and the pins that only read the source.
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

import PublicOfferPage from '@/app/p/offers/[publicToken]/page';

const TOKEN = 'tok-9';
const OFFER_URL = `/api/public/offers/${TOKEN}`;
const ACCEPT_URL = `${OFFER_URL}/accept`;
const DECLINE_URL = `${OFFER_URL}/decline`;
const QUERY_KEY = ['public-offer'];

type Rule =
  | { json: unknown }
  | { status: number; error?: string }
  | { networkError: string }
  | { pending: true };

const net = {
  get: [] as Rule[],
  consumed: 0,
  accept: { json: { status: 'accepted' } } as Rule,
  decline: { json: { status: 'declined' } } as Rule,
  calls: [] as string[],
  bodies: [] as string[],
};

const OFFER = {
  offer: {
    id: 'q-2041', quote_number: 'Q-2041', title: 'Dock scanner rollout', status: 'sent',
    subtotal: '18000.00', discount: '500.00', tax: '1400.00', total_amount: '18900.00',
    expires_at: '2026-11-01T00:00:00Z', notes: 'Includes two spare cradles.',
    terms: 'Net 30 from acceptance.', sent_at: '2026-10-02T00:00:00Z',
    accepted_at: null, declined_at: null, buyer_name: 'Ada Byron',
  },
  line_items: [
    { id: 'li-1', description: 'Handheld scanner, ruggedised', quantity: '12', unit_price: '1100.00', total: '13200.00' },
    { id: 'li-2', description: 'Charge cradle', quantity: '6', unit_price: '950.00', total: '5700.00' },
  ],
  seller: { name: 'Northgate Logistics', logo: null, primary_color: '#7c3aed' },
};

const OFFER_ACCEPTED = {
  ...OFFER,
  offer: { ...OFFER.offer, status: 'accepted', accepted_at: '2026-10-05T09:00:00Z' },
};
const OFFER_DECLINED = {
  ...OFFER,
  offer: { ...OFFER.offer, status: 'declined', declined_at: '2026-10-05T09:00:00Z' },
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
  net.get = [{ json: OFFER }];
  net.consumed = 0;
  net.accept = { json: { status: 'accepted' } };
  net.decline = { json: { status: 'declined' } };
  net.calls = [];
  net.bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    net.calls.push(`${method} ${url}`);
    if (method === 'POST') {
      if (typeof init?.body === 'string') net.bodies.push(init.body);
      return rule(url === ACCEPT_URL ? net.accept : net.decline);
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
          <PublicOfferPage params={Promise.resolve({ publicToken: TOKEN })} />
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
  await waitFor(() => expect(text(view)).toContain('Dock scanner rollout'));
  return view;
}

/** The read answers, then a refresh of the very same key is refused. */
async function refusedRefresh(status = 502, error = 'Bad gateway', record: unknown = OFFER) {
  net.get = [{ json: record }, { status, error }, { json: record }];
  net.consumed = 0;
  const view = await mountLoaded();
  await act(async () => { await client.refetchQueries({ queryKey: QUERY_KEY }); });
  await waitFor(() => expect(gets()).toBe(2));
  return view;
}

describe('the public offer page — a refresh that was refused keeps the offer', () => {
  it('keeps the record on screen — title, reference, an item and the total', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s).toContain('Dock scanner rollout');
    expect(s).toContain('Q-2041');
    expect(s).toContain('Handheld scanner, ruggedised');
    expect(s).toContain('$18,900.00');
    expect(s).toContain('Northgate Logistics');
  });

  it('raises exactly one alert that names what may have moved', async () => {
    await refusedRefresh();
    expect(alerts()).toHaveLength(1);
    const banner = alerts()[0].textContent ?? '';
    expect(banner).toMatch(/last read/i);
    expect(banner, 'the banner must name the items').toMatch(/items/i);
    expect(banner, 'the banner must name the total').toMatch(/total/i);
    expect(banner, 'the banner must name whether the offer is still open').toMatch(/open/i);
  });

  it('does not tell a buyer mid-signature that their link is dead', async () => {
    const view = await refusedRefresh();
    const s = text(view);
    expect(s, 'a stale read may not claim the link was cancelled').not.toMatch(/cancelled/i);
    expect(s).not.toMatch(/incorrect/i);
    expect(s).not.toMatch(/expired/i);
    expect(s).not.toMatch(/not found/i);
  });

  it('leaves the accept and decline buttons live over the stale read', async () => {
    const view = await refusedRefresh();
    const accept = exactly('Accept offer') as HTMLButtonElement;
    const decline = exactly('Decline') as HTMLButtonElement;
    expect(accept.disabled).toBe(false);
    expect(decline.disabled).toBe(false);
    expect(text(view)).toContain('Ready to respond?');
  });

  it('a buyer accepting over the stale read still gets their signature to the server', async () => {
    const view = await refusedRefresh();
    fireEvent.click(exactly('Accept offer'));
    await waitFor(() => expect(screen.queryByText('Confirm acceptance')).toBeTruthy());
    const inputs = Array.from(view.container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: 'ada@example.com' } });
    fireEvent.change(inputs[1], { target: { value: 'Ada Byron' } });
    fireEvent.click(exactly('Confirm acceptance'));
    await waitFor(() => expect(net.calls).toContain(`POST ${ACCEPT_URL}`));
    expect(net.bodies[0]).toContain('Ada Byron');
    await waitFor(() => expect(text(view)).toContain('Offer accepted'));
    expect(text(view)).toContain('Dock scanner rollout');
  });

  it('a buyer declining over the stale read still gets it to the server', async () => {
    const view = await refusedRefresh();
    fireEvent.click(exactly('Decline'));
    await waitFor(() => expect(screen.queryByText('Confirm decline')).toBeTruthy());
    fireEvent.click(exactly('Confirm decline'));
    await waitFor(() => expect(net.calls).toContain(`POST ${DECLINE_URL}`));
    await waitFor(() => expect(text(view)).toContain('Offer declined'));
    expect(text(view)).toContain('Dock scanner rollout');
  });

  it("the stale banner's Try again re-reads, and the caveat leaves when the read answers", async () => {
    const view = await refusedRefresh(500, 'Internal server error');
    expect(alerts()).toHaveLength(1);
    expect(screen.getAllByText('Try again')).toHaveLength(1);
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(gets()).toBe(3));
    await waitFor(() => expect(alerts()).toHaveLength(0));
    expect(text(view)).toContain('Dock scanner rollout');
  });

  it('a stale read whose record is already final keeps its banner and adds the caveat', async () => {
    const view = await refusedRefresh(503, 'Unavailable', OFFER_ACCEPTED);
    expect(text(view)).toContain('Offer accepted');
    expect(alerts()).toHaveLength(1);
    expect(text(view), 'a final record must not regain a CTA').not.toMatch(/Ready to respond\?/);
  });
});

describe('the public offer page — a read that never answered', () => {
  it('a 500 is an outage with a way back, not a verdict on the link', async () => {
    net.get = [{ status: 500, error: 'Internal server error' }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    const s = text(view);
    expect(s).toContain('Try again');
    expect(s, 'an outage may not blame the link').not.toMatch(/cancelled|incorrect/);
    expect(s).not.toMatch(/expired/i);
    expect(s).not.toMatch(/not found/i);
  });

  it('quotes the server in its own words', async () => {
    net.get = [{ status: 500, error: 'Offer lookup failed' }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Offer lookup failed');
    expect(text(view)).not.toMatch(/undefined|\[object Object\]/);
  });

  it('a fetch the network refused is an outage, and Try again re-reads', async () => {
    net.get = [{ networkError: 'Failed to fetch' }, { json: OFFER }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0].textContent).toContain('Failed to fetch');
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(text(view)).toContain('Dock scanner rollout'));
    expect(alerts()).toHaveLength(0);
  });

  it('the public rate limit (429) is an outage, not a dead link', async () => {
    net.get = [{ status: 429, error: 'Too many requests' }, { json: OFFER }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Too many requests');
    fireEvent.click(exactly('Try again'));
    await waitFor(() => expect(text(view)).toContain('Dock scanner rollout'));
  });

  it('a 403 is treated as an outage — it answers nothing about this offer', async () => {
    net.get = [{ status: 403, error: 'Forbidden' }];
    mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(screen.getAllByText('Try again')).toHaveLength(1);
  });

  it('an answered 2xx with an empty body is not a statement that the offer is gone', async () => {
    net.get = [{ json: null }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(text(view)).toContain('Try again');
    expect(text(view)).not.toMatch(/not found|cancelled|incorrect/i);
  });

  it('prints no money, no line items and no CTA when nothing was read', async () => {
    net.get = [{ status: 500 }];
    const view = await mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    const s = text(view);
    expect(s).not.toMatch(/\$/);
    expect(s).not.toContain('Items');
    expect(s).not.toContain('Ready to respond?');
    expect(view.container.querySelectorAll('input')).toHaveLength(0);
  });

  it('the outage leaves the buyer on the page, not somewhere else', async () => {
    net.get = [{ status: 500 }];
    const before = window.location.href;
    mountPage();
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(window.location.href).toBe(before);
    expect(gets()).toBe(1);
  });
});

describe('the public offer page — reads that answered stay answers', () => {
  it('a 404 is "Offer not found", with no alert and no retry', async () => {
    net.get = [{ status: 404, error: 'Offer not found' }];
    const view = await mountPage();
    await waitFor(() => expect(text(view)).toContain('Offer not found'));
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('the 410 this read itself raises is "This offer has expired", with no alert', async () => {
    net.get = [{ status: 410, error: 'This offer has expired' }];
    const view = await mountPage();
    await waitFor(() => expect(text(view)).toContain('This offer has expired'));
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('a clean read renders the record and says nothing about freshness', async () => {
    const view = await mountLoaded();
    expect(alerts()).toHaveLength(0);
    const s = text(view);
    expect(s).toContain('Ada Byron');
    expect(s).toContain('Net 30 from acceptance.');
    expect(s).toContain('Includes two spare cradles.');
    expect(s).toContain('Ready to respond?');
    expect(gets()).toBe(1);
  });

  it('money comes off the read in full: subtotal, discount, tax and total', async () => {
    const view = await mountLoaded();
    const s = text(view);
    expect(s).toContain('$18,000.00');
    expect(s).toContain('$500.00');
    expect(s).toContain('$1,400.00');
    expect(s).toContain('$18,900.00');
  });

  it('an offer with no line items is an answered zero, not an outage', async () => {
    net.get = [{ json: { ...OFFER, line_items: [] } }];
    const view = await mountLoaded();
    expect(text(view)).toContain('No line items.');
    expect(alerts()).toHaveLength(0);
  });

  it('a record the server already accepted shows its banner and no CTA', async () => {
    net.get = [{ json: OFFER_ACCEPTED }];
    const view = await mountLoaded();
    expect(text(view)).toContain('Offer accepted');
    expect(text(view)).not.toMatch(/Ready to respond\?/);
    expect(alerts()).toHaveLength(0);
  });

  it('a record the server already declined shows its banner and no CTA', async () => {
    net.get = [{ json: OFFER_DECLINED }];
    const view = await mountLoaded();
    expect(text(view)).toContain('Offer declined');
    expect(text(view)).not.toMatch(/Ready to respond\?/);
  });

  it('the first load is a spinner, not an outage card and not a blank page', async () => {
    net.get = [{ pending: true }];
    const view = await mountPage();
    await waitFor(() => expect(view.container.querySelector('.animate-spin')).toBeTruthy());
    expect(alerts()).toHaveLength(0);
    expect(text(view)).not.toContain('Try again');
  });

  it('the offer page is mounted by no other suite', () => {
    const hits = spawnSync('grep', ['-rlF', 'p/offers/[publicToken]/page', 'tests/unit'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect((hits.stdout ?? '').trim().split('\n').sort()).toEqual([
      'tests/unit/panel-page-error-not-empty-public-offer-stale-2872.test.tsx',
    ]);
  });
});

describe('the public offer page — the source stays in this shape', () => {
  const src = readFileSync(join(process.cwd(), 'app/p/offers/[publicToken]/page.tsx'), 'utf8');

  it('no branch of the render is gated on the flag alone', () => {
    expect(src).not.toMatch(/if\s*\(\s*error\s*\|\|\s*!data\s*\)/);
    expect(src).not.toMatch(/if\s*\(\s*error\s*\)/);
  });

  it('a refused refresh is derived, in the house shape', () => {
    expect(src).toMatch(/Boolean\(error\)\s*&&\s*Boolean\(data\)/);
    expect(src).toMatch(/error\?\.message \|\| 'no response from the server'/);
  });

  it('the answered arms only answer when nothing is on screen', () => {
    for (const code of ['410', '404']) {
      const line = src.split('\n').find(l => l.includes(`errorStatus === ${code}`)) ?? '';
      expect(line, `the ${code} arm must be reachable only without a record`).toMatch(/!data|failed/);
    }
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

  it('the CTA is still gated on the record, not on freshness', () => {
    expect(src).toMatch(/\{!isFinal && \(/);
    expect(src).not.toMatch(/!isFinal && !stale/);
  });

  it('the stale banner sits above the record it qualifies', () => {
    const banner = src.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(src.indexOf('Line items')).toBeGreaterThan(banner);
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
