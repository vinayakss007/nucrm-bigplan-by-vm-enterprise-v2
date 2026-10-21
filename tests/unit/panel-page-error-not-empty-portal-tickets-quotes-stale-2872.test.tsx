// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three customer portal pages the census missed, because they never call
 * `useApiQuery`. (That sentence is now history, not state: #1328's census named putting
 * them on the wrapper as its own task, that task landed, and the ratchet below pins the
 * migrated form. Everything written here about the hand-written `queryFn` describes what
 * these pages did when #2872 found them.)
 *
 * `app/portal/(protected)/tickets/page.tsx`, its `[id]` record and
 * `app/portal/(protected)/quotes/page.tsx` reach the server through `useQuery` from
 * `@tanstack/react-query` with a hand-written `fetch` in the `queryFn`. #2872's census
 * walked `useApiQuery` callers, so it counted none of them, and the reader they fail is
 * not an operator but the customer whose work these pages hold: a support conversation
 * mid-reply, and the quote the business is waiting on an answer to.
 *
 * Skipping the helper costs the pages `apiFetcher`'s single error shape, not the client's
 * defaults — `staleTime: 30_000`, `retry: 2`, `refetchOnWindowFocus: false` and
 * `gcTime: 5 min` live on the QueryClient `makeQueryClient()` builds, so they apply here
 * too, and that is what makes a kept-rows-plus-refusal the ordinary state rather than a
 * corner case. `data` survives a failed revalidation of a read that had succeeded, the
 * flag says only "something failed", and each page read only the flag:
 *
 *   - both lists branch `rows.length === 0 ? (error ? <outage> : <"No X yet">) : <rows>`,
 *     so a refresh refused while rows were on screen said nothing at all, and a refresh
 *     refused over a list the last read genuinely called empty shouted an outage about an
 *     answer that arrived;
 *   - the record page did worse than go quiet: an effect toasted `Ticket not found` and
 *     `router.replace('/portal/tickets')` for ANY failure — including the customer's own
 *     transport blip — deleting the conversation under someone typing a reply, and
 *     claiming a record the server had never been reached about. The queryFn threw
 *     `ApiQueryError('not found', …)` for every status, so even the message said it.
 *
 * The trigger differs per page, and each split says so:
 *   - tickets list — `CreateTicketModal`'s `onCreated` ends in
 *     `invalidateQueries(['portal-tickets', session?.email])`, this exact key, so filing a
 *     ticket produces kept rows that cannot contain the ticket just filed;
 *   - quotes list — nothing invalidates `['portal-quotes', session?.email]`: accept and
 *     decline write the new status straight into the cache with `setQueryData` (pinned
 *     below, because it is what decides the caveat's copy). The refused refresh is the
 *     remount inside `gcTime`, and the Accept buttons on that screen address a status the
 *     refused refresh could not re-check;
 *   - ticket record — nothing invalidates it either (`sendReply` appends to local state),
 *     so it is the same remount: back to the list, into the ticket again past `staleTime`.
 *
 * A 404 on the record is a third state, kept apart from the other two. The route answers
 * `Ticket not found` with 404 only after it has accepted the portal session and looked for
 * that id under the customer's own contact, so it is the server naming the record — the
 * `notFound = failed && error?.status === 404` split #2932 wrote for the tenant console.
 * A 401, a 429, a 500 or a `fetch` that never got there is a load failure and may not say
 * the ticket is gone; and neither of them may navigate the customer away any more.
 *
 * The copy stays customer-facing: it says "your tickets", "the quote", "the conversation".
 * It names no route, no file, no status-code vocabulary of its own and no internal role. The
 * one exception is deliberate and inherited from #2825/#2872's already-merged portal pages:
 * the banner quotes the read's own reason string, because the house shape requires the
 * refusal be named and suppressing it would make the retry unexplainable.
 *
 * MOCK SEAM: the brief's `vi.mock('@/lib/query/client')` registry cannot reach these three
 * pages — they import `useQuery` from `@tanstack/react-query` and pass the URL only as a
 * closure over their `queryFn`, so there is no `url` argument to key on. This file therefore
 * keeps the registry keyed by URL one level down, at `fetch` itself, and runs the production
 * client: `registry.byUrl['/api/public/quotes'] = [answered(…), refused(…)]` hands that read's
 * answers in order, the last repeating, and counts the calls. That buys what the mock cannot —
 * the triggers above are reproduced (a real invalidation, a real remount off a real cache)
 * rather than asserted as a stubbed hook result — and it is how the #2825 suite already drives
 * these same pages.
 *
 * RED AT BASE, measured on this branch with the three product files rewound to their committed
 * state and this file as written: 24 failed | 8 passed (32). The 8 that pass are the #2825
 * contract those files already honoured — a genuine empty read still saying "No tickets yet" /
 * "No quotes yet" with no alert, and the record rendering a thread it answered — plus the guard,
 * baseline, size and overlap ratchets and the two pins of what this slice deliberately did not
 * touch (the mutation toasts, and staying off `useApiQuery` — the census on #1328 named that
 * move as its own task, it has since landed, and the pin inverted rather than vanished). They
 * keep passing under the fix,
 * which is the point: routing `failed` in place of the flag must not disturb what #2825 wrote.
 * With the three pages fixed: 32 passed. (The two never-answered cases fail at base for a
 * specific reason: #2825's outage copy told the customer to "reload the page to try again" and
 * quoted no reason at all, so there was nothing on that card to re-run the read.)
 *
 * Fixture addresses are documentation-only (`corp.test`); the customer, the ticket and the
 * quote are invented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/client';

/** One read's answer: what the server said, or how it failed to say it. */
type Answer =
  | { kind: 'ok'; body: unknown }
  | { kind: 'refused'; status: number }
  | { kind: 'transport'; message: string };

const registry = vi.hoisted(() => ({
  /** url (GET) or `POST url` → the answers that read should get, in order; the last repeats. */
  byUrl: {} as Record<string, Answer[]>,
  /** url → how many times the page asked for it, which is how a trigger is proved. */
  calls: {} as Record<string, number>,
}));

// A stable router: all three pages key their session effect on `router`, so a fresh object per
// call re-runs the effect on every render. `replace`/`push` are the spy the record page is
// pinned against — a refused refresh may not move anybody.
const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const TICKET_ID = '8a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2e';
const QUOTE_ID = '9a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2d';

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ id: TICKET_ID }),
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import PortalTicketsPage from '@/app/portal/(protected)/tickets/page';
import PortalTicketDetailPage from '@/app/portal/(protected)/tickets/[id]/page';
import PortalQuotesPage from '@/app/portal/(protected)/quotes/page';

const TICKETS = '/api/public/tickets';
const TICKET = `/api/public/tickets/${TICKET_ID}`;
const TICKET_CREATE = 'POST /api/public/tickets';
const TICKET_REPLY = `POST ${TICKET}/replies`;
const QUOTES = '/api/public/quotes';
const QUOTE_ACCEPT = `POST /api/public/quotes/${QUOTE_ID}/accept`;

const answered = (body: unknown): Answer => ({ kind: 'ok', body });
const refused = (status = 500): Answer => ({ kind: 'refused', status });
/** A refusal that said nothing at all — a `fetch` that never reached a server. */
const silent = (message = ''): Answer => ({ kind: 'transport', message });

const ticketRow = {
  id: TICKET_ID,
  status: 'open',
  category: 'billing',
  subject: 'Portal login',
  body: 'The sign-in link never arrives.',
  created_at: '2026-01-05T00:00:00.000Z',
};
const ticketPayload = {
  data: {
    ticket: ticketRow,
    replies: [{
      id: 'r1',
      body: 'We are checking the mail logs now.',
      isInternal: false,
      userId: 'u1',
      contactId: null,
      createdAt: '2026-01-06T00:00:00.000Z',
    }],
  },
};
const quoteRow = {
  id: QUOTE_ID,
  quote_number: 'Q-2026-0042',
  title: 'Website rebuild',
  status: 'sent',
  total_amount: '1250.00',
  subtotal: '1250.00',
  discount: '0',
  tax: '0',
  notes: 'Two weeks, fixed price.',
  terms: 'Half up front.',
  created_at: '2026-01-05T00:00:00.000Z',
};

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const alertMentioning = (word: string) => {
  const el = screen.getAllByRole('alert').find((a) => (a.textContent ?? '').includes(word));
  expect(el, alerts()).toBeTruthy();
  return el as HTMLElement;
};
const askedFor = (url: string) => registry.calls[url] ?? 0;

let client: QueryClient;

/**
 * The production defaults, minus the retry schedule: a refused read would otherwise spend
 * ~3s retrying while the page still shows its skeleton. `gcTime` stays at 5 minutes, because
 * the cache surviving to the next mount is the trigger these pages have.
 */
function freshClient() {
  const c = makeQueryClient();
  c.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return c;
}

async function draw(node: ReactNode, { fresh = true } = {}) {
  cleanup();
  if (fresh) client = freshClient();
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  await waitFor(
    () => expect(document.querySelector('.animate-pulse'), 'skeleton never cleared').toBeNull(),
    { interval: 10 },
  );
}

/**
 * The refused refresh these two pages really have: the customer leaves and comes back, the
 * cache still holds the rows, and this time the revalidation behind them is refused. Same
 * client, second mount — nothing is asserted about a stub.
 */
const backAgain = (node: ReactNode) => draw(node, { fresh: false });

async function expectCopy(copy: string, where: 'alert' | 'any' = 'any') {
  await waitFor(() => {
    const haystack = where === 'alert' ? alerts() : (document.body.textContent ?? '');
    expect(haystack.includes(copy), `"${copy}" not on screen; alerts were: ${alerts()}`).toBe(true);
  }, { interval: 10 });
}

const NO_ROWS = 'No tickets yet';
const NO_QUOTES = 'No quotes yet';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom has no scrollIntoView, and the record page scrolls its thread on every reply change.
  Element.prototype.scrollIntoView = vi.fn();
  registry.byUrl = {};
  registry.calls = {};
  mockRouter.replace.mockClear();
  mockRouter.push.mockClear();
  localStorage.clear();
  localStorage.setItem('portal_session', JSON.stringify({
    email: 'customer@corp.test',
    name: 'Casey Customer',
    permissions: { quotes: true, invoices: true, cases: true },
  }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = String(input);
    const key = method === 'GET' ? url : `${method} ${url}`;
    registry.calls[key] = (registry.calls[key] ?? 0) + 1;
    const queue = registry.byUrl[key];
    if (!queue || queue.length === 0) throw new Error(`no fixture for ${key}`);
    const answer = queue.length > 1 ? queue[0] : queue[queue.length - 1];
    if (queue.length > 1) queue.shift();
    if (answer.kind === 'transport') throw new Error(answer.message);
    if (answer.kind === 'refused') {
      return { ok: false, status: answer.status, json: async () => ({ error: 'server said no' }) };
    }
    return { ok: true, status: 200, json: async () => answer.body };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('portal tickets list: a refused refresh keeps the list and says so (#2872)', () => {
  it('keeps the customer\'s rows and calls them the last read', async () => {
    registry.byUrl = { [TICKETS]: [answered({ data: [ticketRow] }), refused(504)] };
    await draw(<PortalTicketsPage />);
    await expectCopy('Portal login');
    expect(screen.queryByRole('alert')).toBeNull();

    await backAgain(<PortalTicketsPage />);
    await expectCopy('the tickets below are the last read', 'alert');
    expect(alerts()).toContain('Request failed (504)');
    // The row survives being actionable, not merely visible.
    expect(screen.getByRole('button', { name: /Portal login/i })).toBeTruthy();
    expect(screen.queryByText(NO_ROWS)).toBeNull();
    expect(screen.queryByText(/We could not load your tickets/)).toBeNull();
  });

  it('the customer files a ticket, the refresh that write asks for is refused, and the caveat names the missing ticket', async () => {
    // This is the page's own trigger, run rather than narrated: the create modal ends in
    // invalidateQueries over the list's exact key.
    registry.byUrl = {
      [TICKETS]: [answered({ data: [ticketRow] }), refused(429)],
      [TICKET_CREATE]: [answered({ data: { id: 'new-1' } })],
    };
    await draw(<PortalTicketsPage />);
    await expectCopy('Portal login');

    fireEvent.click(screen.getByRole('button', { name: /New Ticket/i }));
    fireEvent.change(screen.getByPlaceholderText('How can we help?'), { target: { value: 'Duplicate invoice' } });
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'I was billed twice this month.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Ticket/i }));

    await waitFor(() => expect(alerts()).toContain('the tickets below are the last read'), { interval: 10 });
    expect(askedFor(TICKETS), 'the create should have asked this read once more').toBe(2);
    expect(askedFor(TICKET_CREATE)).toBe(1);
    expect(alerts()).toContain('The ticket you just created may not be in them yet');
    expect(screen.getByText('Portal login')).toBeTruthy();
    expect(screen.queryByText(NO_ROWS)).toBeNull();
  });

  it('a read that never answered is the outage, with the reason, and "No tickets yet" is unreachable', async () => {
    registry.byUrl = { [TICKETS]: [refused(500)] };
    await draw(<PortalTicketsPage />);
    await expectCopy('We could not load your tickets', 'alert');
    expect(alerts()).toContain('not an empty list');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(NO_ROWS)).toBeNull();
    expect(screen.queryByRole('button', { name: /Portal login/i })).toBeNull();
  });

  it('a successful empty read still says none, with no alert', async () => {
    registry.byUrl = { [TICKETS]: [answered({ data: [] })] };
    await draw(<PortalTicketsPage />);
    await expectCopy(NO_ROWS);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal over an answer that was empty says none AND adds the caveat', async () => {
    registry.byUrl = { [TICKETS]: [answered({ data: [] }), refused(502)] };
    await draw(<PortalTicketsPage />);
    await expectCopy(NO_ROWS);
    await backAgain(<PortalTicketsPage />);
    await expectCopy('the tickets below are the last read', 'alert');
    expect(screen.getByText(/No tickets yet/)).toBeTruthy();
    expect(screen.queryByText(/We could not load your tickets/)).toBeNull();
  });

  it('the caveat retries this list and not the quotes read next door', async () => {
    registry.byUrl = {
      [TICKETS]: [answered({ data: [ticketRow] }), refused(500)],
      [QUOTES]: [answered({ data: [quoteRow] }), refused(500)],
    };
    const both = <><PortalTicketsPage /><PortalQuotesPage /></>;
    await draw(both);
    await expectCopy('Portal login');
    await expectCopy('Website rebuild');
    await backAgain(both);
    await expectCopy('the tickets below are the last read', 'alert');
    await expectCopy('the quotes below are the last read', 'alert');

    const before = askedFor(TICKETS);
    fireEvent.click(within(alertMentioning('tickets')).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(askedFor(TICKETS)).toBe(before + 1), { interval: 10 });
    expect(askedFor(QUOTES), 'one refused list must not re-run the other').toBe(2);
  });

  it('a refusal that carries no message still names the reason', async () => {
    registry.byUrl = { [TICKETS]: [silent()] };
    await draw(<PortalTicketsPage />);
    await expectCopy('no response from the server', 'alert');

    registry.byUrl = { [TICKETS]: [answered({ data: [ticketRow] }), silent()] };
    await draw(<PortalTicketsPage />);
    await backAgain(<PortalTicketsPage />);
    await expectCopy('no response from the server', 'alert');
  });
});

describe('portal quotes list: an unanswered refresh does not certify the quote screen (#2872)', () => {
  it('keeps the quotes, their money and their buttons, and calls them the last read', async () => {
    registry.byUrl = { [QUOTES]: [answered({ data: [quoteRow] }), refused(504)] };
    await draw(<PortalQuotesPage />);
    await expectCopy('Website rebuild');
    expect(screen.queryByRole('alert')).toBeNull();

    await backAgain(<PortalQuotesPage />);
    await expectCopy('the quotes below are the last read', 'alert');
    expect(alerts()).toContain('Request failed (504)');
    // What a refused refresh would not have reflected, in the customer's terms.
    expect(alerts()).toContain('A quote that has since expired or been withdrawn is still shown here as one you can answer');
    expect(screen.getByText('Website rebuild')).toBeTruthy();
    // A kept quote still states the money it holds.
    expect(screen.getByText('$1,250')).toBeTruthy();
    expect(screen.queryByText(NO_QUOTES)).toBeNull();
    expect(screen.queryByText(/We could not load your quotes/)).toBeNull();
  });

  it('a kept quote is still one the customer can answer, and answering it does not ask for the list again', async () => {
    // Pinned because it decides the trigger: accept writes the status with setQueryData, so
    // nothing here invalidates ['portal-quotes', email] and the refused refresh is a remount.
    registry.byUrl = {
      [QUOTES]: [answered({ data: [quoteRow] }), refused(504)],
      [QUOTE_ACCEPT]: [answered({ data: { id: QUOTE_ID } })],
    };
    await draw(<PortalQuotesPage />);
    await expectCopy('Website rebuild');
    await backAgain(<PortalQuotesPage />);
    await expectCopy('the quotes below are the last read', 'alert');

    fireEvent.click(screen.getByText('Website rebuild'));
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/i }));
    await waitFor(() => expect(screen.getByText('Accepted')).toBeTruthy(), { interval: 10 });
    expect(askedFor(QUOTE_ACCEPT)).toBe(1);
    expect(askedFor(QUOTES), 'a successful accept must not re-request the list').toBe(2);
    expect(screen.getByText('Website rebuild')).toBeTruthy();
    expect(screen.getByText('$1,250')).toBeTruthy();
    // The write path silences the caveat: `setQueryData` is a `success` dispatch inside
    // react-query, so it clears the read's error along with its data. The screen goes back
    // to looking current while it still holds rows the refused refresh never confirmed —
    // the one place on this page where #2872's shape survives the fix. It is orthogonal to
    // the `useApiQuery` migration #1328 later took: the wrapper changes how the read is
    // fetched and named, not how a write dispatch clears it.
    expect(alerts()).toBe('');
  });

  it('a read that never answered is the outage, with the reason, and "No quotes yet" is unreachable', async () => {
    registry.byUrl = { [QUOTES]: [refused(500)] };
    await draw(<PortalQuotesPage />);
    await expectCopy('We could not load your quotes', 'alert');
    expect(alerts()).toContain('not an empty list');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(NO_QUOTES)).toBeNull();
    // Nothing answered, so nothing is priced and nothing is answerable.
    expect(screen.queryByText('$1,250')).toBeNull();
    expect(screen.queryByText('Website rebuild')).toBeNull();
  });

  it('a successful empty read still says none, with no alert', async () => {
    registry.byUrl = { [QUOTES]: [answered({ data: [] })] };
    await draw(<PortalQuotesPage />);
    await expectCopy(NO_QUOTES);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal over an answer that was empty says none AND adds the caveat', async () => {
    registry.byUrl = { [QUOTES]: [answered({ data: [] }), refused(502)] };
    await draw(<PortalQuotesPage />);
    await expectCopy(NO_QUOTES);
    await backAgain(<PortalQuotesPage />);
    await expectCopy('the quotes below are the last read', 'alert');
    expect(screen.getByText(NO_QUOTES)).toBeTruthy();
    expect(screen.queryByText(/We could not load your quotes/)).toBeNull();
  });

  it('the caveat retries this quotes read and not the tickets read next door', async () => {
    registry.byUrl = {
      [TICKETS]: [answered({ data: [ticketRow] }), refused(500)],
      [QUOTES]: [answered({ data: [quoteRow] }), refused(500)],
    };
    const both = <><PortalTicketsPage /><PortalQuotesPage /></>;
    await draw(both);
    await expectCopy('Portal login');
    await backAgain(both);
    await expectCopy('the quotes below are the last read', 'alert');

    const before = askedFor(QUOTES);
    fireEvent.click(within(alertMentioning('quotes')).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(askedFor(QUOTES)).toBe(before + 1), { interval: 10 });
    expect(askedFor(TICKETS), 'one refused list must not re-run the other').toBe(2);
  });

  it('a refusal that carries no message still names the reason', async () => {
    registry.byUrl = { [QUOTES]: [silent()] };
    await draw(<PortalQuotesPage />);
    await expectCopy('no response from the server', 'alert');

    registry.byUrl = { [QUOTES]: [answered({ data: [quoteRow] }), silent()] };
    await draw(<PortalQuotesPage />);
    await backAgain(<PortalQuotesPage />);
    await expectCopy('no response from the server', 'alert');
  });
});

describe('the ticket record: a refused refresh is neither "not found" nor a redirect (#2872)', () => {
  it('keeps the conversation and the reply box, and calls them the last read', async () => {
    registry.byUrl = { [TICKET]: [answered(ticketPayload), refused(504)] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('We are checking the mail logs now.');
    expect(screen.queryByRole('alert')).toBeNull();

    await backAgain(<PortalTicketDetailPage />);
    await expectCopy('the conversation below is the last read', 'alert');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.getByText('Portal login')).toBeTruthy();
    expect(screen.getByPlaceholderText('Type your reply...')).toBeTruthy();
    expect(screen.queryByText(/not in your account/)).toBeNull();
  });

  it('a refused refresh no longer throws the customer off the ticket they are replying to', async () => {
    registry.byUrl = {
      [TICKET]: [answered(ticketPayload), refused(500)],
      [TICKET_REPLY]: [answered({ data: {
        id: 'r2', body: 'Still not fixed.', isInternal: false,
        userId: null, contactId: 'c1', createdAt: '2026-01-07T00:00:00.000Z',
      } })],
    };
    await draw(<PortalTicketDetailPage />);
    await backAgain(<PortalTicketDetailPage />);
    await expectCopy('the conversation below is the last read', 'alert');
    expect(mockRouter.replace, 'a refused refresh must not navigate anyone').not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Type your reply...'), { target: { value: 'Still not fixed.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    await waitFor(() => expect(screen.getByText('Still not fixed.')).toBeTruthy(), { interval: 10 });
    expect(askedFor(TICKET_REPLY)).toBe(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push, 'the customer leaves only when they click Back').not.toHaveBeenCalled();
    expect(screen.getByText('Portal login')).toBeTruthy();
  });

  it('a read that never answered is the outage, names the reason, and never claims the ticket is gone', async () => {
    registry.byUrl = { [TICKET]: [refused(500)] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('We could not load this ticket', 'alert');
    expect(alerts()).toContain('not a missing conversation');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(/not in your account/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ticket not found/);
    // Nothing answered, so nothing here may write against an id only failed to read.
    expect(screen.queryByPlaceholderText('Type your reply...')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('a 404 for this id is the server naming the record, not a load failure — and still no redirect', async () => {
    registry.byUrl = { [TICKET]: [refused(404)] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('That ticket is not in your account');
    // The two states stay apart: an absence the server answered, not an outage.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
    expect(document.body.textContent).not.toMatch(/Request failed \(404\)/);
    expect(screen.queryByPlaceholderText('Type your reply...')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // Getting out of here is the customer's click, not the page's.
    fireEvent.click(screen.getByRole('button', { name: /Back to my tickets/i }));
    expect(mockRouter.push).toHaveBeenCalledWith('/portal/tickets');
  });

  it('a ticket kept from an earlier read, refused now, is not reported as missing', async () => {
    // The 404-after-a-good-read walk: the conversation stays up with the caveat, because a
    // refusal to re-read is not the server changing its mind about the record.
    registry.byUrl = { [TICKET]: [answered(ticketPayload), refused(404)] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('Portal login');
    await backAgain(<PortalTicketDetailPage />);
    await expectCopy('the conversation below is the last read', 'alert');
    expect(screen.getByText('Portal login')).toBeTruthy();
    expect(screen.queryByText(/not in your account/)).toBeNull();
  });

  it('a transport failure that never reached the server is an outage, not an absence', async () => {
    registry.byUrl = { [TICKET]: [silent()] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('We could not load this ticket', 'alert');
    await expectCopy('no response from the server', 'alert');
    expect(screen.queryByText(/not in your account/)).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('a read that answers shows the thread and says nothing about freshness', async () => {
    registry.byUrl = { [TICKET]: [answered(ticketPayload)] };
    await draw(<PortalTicketDetailPage />);
    await expectCopy('We are checking the mail logs now.');
    expect(screen.getByText('Support Team')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the caveat retries this ticket and not the list behind it', async () => {
    registry.byUrl = {
      [TICKETS]: [answered({ data: [ticketRow] }), refused(500)],
      [TICKET]: [answered(ticketPayload), refused(500)],
    };
    const both = <><PortalTicketsPage /><PortalTicketDetailPage /></>;
    await draw(both);
    await expectCopy('Portal login');
    await backAgain(both);
    await expectCopy('the conversation below is the last read', 'alert');

    const before = askedFor(TICKET);
    fireEvent.click(within(alertMentioning('conversation')).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(askedFor(TICKET)).toBe(before + 1), { interval: 10 });
    expect(askedFor(TICKETS), 'the record\'s retry must not re-run the list read').toBe(2);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const LIST = 'app/portal/(protected)/tickets/page.tsx';
  const DETAIL = 'app/portal/(protected)/tickets/[id]/page.tsx';
  const QUOTES_FILE = 'app/portal/(protected)/quotes/page.tsx';
  const PAGES = [LIST, DETAIL, QUOTES_FILE];

  it('separates the outage from the refused refresh on all three', () => {
    for (const file of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `${file} never separates the outage from the stale read`)
        .toMatch(/const failed = Boolean\(error\) && !data;/);
      expect(src, `${file} keeps the rows without saying they are the last read`)
        .toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
      expect(src, `${file} prints a raw error that can be undefined`)
        .toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${file} has no banner to carry the state`).toMatch(/InlineErrorState/);
      expect(src, `${file} has no retry bound to its own read`).toMatch(/onRetry=\{\(\) => void refetch\(\)\}/);
    }
  });

  it('has stopped asking the bare flag, on all three', () => {
    for (const file of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `${file} still treats any error as an outage`).not.toMatch(/\berror \? \(/);
      expect(src, `${file} still treats any error as an outage`).not.toMatch(/\berror\s+\?/);
      expect(src, `${file} still gates the outage on emptiness`).not.toMatch(/\berror && !\(/);
      expect(src, `${file} dashes or zeroes a figure on the bare error`).not.toMatch(/\w*[Ee]rror \? '/);
    }
  });

  it('retires the record page\'s toast-and-redirect, which was the worst shape of this class', () => {
    const src = readFileSync(join(ROOT, DETAIL), 'utf8');
    expect(src, 'the read failure is still carried by a fading toast').not.toMatch(/^\s*if \(error\) toast\.error/m);
    expect(src).not.toMatch(/useEffect\(\(\) => \{\s*if \(error\) \{/);
    expect(src, 'the customer can still be told a record is missing by a failed request')
      .not.toMatch(/toast\.error\('Ticket not found'\)/);
    expect(src, 'a refused refresh still navigates').not.toMatch(/if \(error\)[\s\S]{0,120}router\.replace\('\/portal\/tickets'\)/);
    expect(src, 'a read that never answered still renders nothing at all').not.toMatch(/if \(!ticket\) return null/);
    // The 404 is kept as its own state, off the error's status and off the toast channel.
    expect(src).toMatch(/const notFound = failed && error\?\.status === 404;/);
  });

  it('keeps the transient feedback the customer\'s own actions still deserve', () => {
    // Rule of the slice: a page state may not ride a toast; an action may.
    expect(readFileSync(join(ROOT, LIST), 'utf8')).toMatch(/toast\.success\('Ticket created'\)/);
    const quotes = readFileSync(join(ROOT, QUOTES_FILE), 'utf8');
    expect(quotes).toMatch(/onError: \(err\) => \{\s*\r?\n\s*toast\.error\(err\.message \|\| 'Failed to accept quote'\);/);
    expect(readFileSync(join(ROOT, DETAIL), 'utf8')).toMatch(/toast\.error\(d\.error \|\| 'Failed to send'\)/);
  });

  it('names the reason the way the read can produce it, not the way a page guesses at it', () => {
    // The record used to throw `ApiQueryError('not found', …)` for every status, which is the
    // sentence the bug then showed the customer. Its message is now apiFetcher's own — the
    // page cannot re-guess it — and `status` is what the 404 branch reads.
    const src = readFileSync(join(ROOT, DETAIL), 'utf8');
    expect(src, 'the detail read is back to hand-building its error').toMatch(/useApiQuery[\s\S]*`\/api\/public\/tickets\/\$\{ticketId\}`/);
    expect(src).not.toMatch(/new ApiQueryError\('not found'/);
    const fetcher = readFileSync(join(ROOT, 'lib/query/client.tsx'), 'utf8');
    expect(fetcher, 'apiFetcher no longer builds the status message the pages promise the customer')
      .toMatch(/throw new ApiQueryError\(`Request failed \(\$\{res\.status\}\)`, res\.status, info\)/);
  });

  it('is on `useApiQuery` now — the migration this ratchet reserved for its own issue', () => {
    // #2872 documented that these three bypassed the helper and that moving them belonged in
    // its own task; #1328's census named that task, and #2946's parent took it. The ratchet
    // inverts rather than disappears: a page drifting back to a hand-rolled fetch path would
    // re-own the error message, which is exactly the regression the test above can no longer
    // see from inside the page.
    for (const file of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `${file} fell off the shared fetch path`).toMatch(/useApiQuery[<(]/);
      expect(src, `${file} re-owns error normalization`).not.toMatch(/\buseQuery\b/);
      expect(src, `${file} re-owns error normalization`).not.toMatch(/import \{[^}]*ApiQueryError[^}]*\} from '@\/lib\/query\/client'/);
    }
  });

  it("keeps #2829's guard green and adds nothing to its baseline", () => {
    const doc = JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ) as { files: Record<string, string> };
    // A ceiling, never an equality: the other #2872 slices are moving this number down.
    expect(Object.keys(doc.files).length).toBeLessThanOrEqual(0);
    for (const file of PAGES) {
      expect(doc.files[file], `${file} should never have been allowlisted`).toBeUndefined();
    }
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    // Every one of these three binds `error` and renders a failure affordance, which is all the
    // screen asks — at base, after the fix, and with the split rewound. The render cases above are
    // what stands in its place for this class.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewind: Record<string, (src: string) => string> = {
      [LIST]: (src) => src
        .replace(/\n\s*\{\s*\/\* Kept tickets[\s\S]*?\n\s*\)\}\n/, '\n')
        .replace(/\) : failed \? \(/, ') : error ? ('),
      [QUOTES_FILE]: (src) => src
        .replace(/\n\s*\{\s*\/\* Kept quotes[\s\S]*?\n\s*\)\}\n/, '\n')
        .replace(/\{failed \? \(/, '{error ? ('),
      [DETAIL]: (src) => src
        .replace(/\n\s*\{\s*\/\* Kept conversation[\s\S]*?\n\s*\)\}\n/g, '\n')
        .replace('if (failed && !notFound) {', 'if (error) {'),
    };
    for (const file of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const back = rewind[file](src);
      expect(back, `${file}: the split changed shape, update this check`).not.toBe(src);
      expect(inspect(file, src).offends, `${file} is visible to the guard today`).toBe(false);
      expect(inspect(file, back).offends, `${file} would be visible with the split rewound`).toBe(false);
    }
  });

  it('does not teach the #2825 suite to speak about a kept read', () => {
    // Overlap hygiene: that suite is the outage contract for these same two list pages.
    for (const spec of [
      'tests/unit/portal-page-error-not-empty-2825.test.tsx',
      'tests/unit/portal-catch-not-empty-2825.test.ts',
      'tests/unit/portal-invoice-shape-2747.test.tsx',
    ]) {
      expect(readFileSync(join(ROOT, spec), 'utf8'), `${spec} speaks about a kept read`).not.toMatch(/last read/);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const file of PAGES) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1;
      expect(lines, `${file} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
