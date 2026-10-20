// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/tenant/search` and `/tenant/data-explorer`, the two panels whose "empty" verdict is
 * usually one the operator built themselves. That is what makes this pair hard: on these pages a
 * zero is a normal, correct answer, so the fix cannot simply wave an alert over every empty arm.
 * It has to tell a refused refresh apart from an honest miss, and keep both.
 *
 * The reads, their keys and their URLs:
 *
 *   search — `useApiQuery(['tenant','search', activeType, trimmed], '/api/tenant/search?q=…&type=…
 *     &limit=12')`: the debounced term AND the type are in the key, so every term is its own read.
 *     plus `useQuery(['tenant','search','advanced', submitted], POST /api/tenant/search/advanced)`,
 *     where `submitted` — type, term, chips, page — is the key. A term or a page 2 that has never
 *     answered has no last read to keep: those are outages, never stale reads.
 *   data-explorer — `useApiQuery(['tenant','data-explorer', { entityType, page, sort, order, q }],
 *     '/api/tenant/data-explorer?type=…&page=…&limit=50&sort=…&order=…[&q=…]')`, one key per view.
 *
 * Where the refusal comes from:
 *   data-explorer writes: the inline editor's PUT and the row DELETE each call `refetch()` on the
 *   very key on screen, and the Search button is a `refetch()` too — so "kept rows + refused
 *   revalidation" is the ordinary state one moment after editing a cell. Its whole failure channel
 *   was `if (error) toast.error('Search failed')` in an effect: a ~4-second toast over a table that
 *   went on saying whatever the kept payload happened to say, up to "No contacts found" for a read
 *   that never answered. And that branch gated the table on `isFetching`, which is true for a
 *   background revalidation of rows the key already has, so every reload blanked the table for a
 *   spinner — the refusal that followed had nothing left on screen to keep.
 *   search writes nothing (the advanced POST is a read of the search route, not a mutation, and it
 *   invalidates nothing). Its refusals are the same key asked again: "Try again", re-entering
 *   `/tenant/search?q=…` past the 30-second `staleTime`, or TanStack's reconnect revalidation. Both
 *   banners keyed off the bare `isError`, so a kept answer got the outage sentence — "did not run",
 *   "nothing was counted" — spoken over the rows, or the counted zero, still on screen; and the
 *   typeahead gated on `isFetching`, same spinner-over-kept-rows.
 *
 * The fix is the house shape: `failed = Boolean(error) && !data` (never answered → outage, the only
 * thing that may dash a figure), `stale = Boolean(error) && Boolean(data)` (kept rows + a "last read"
 * caveat naming what the refused refresh does not show), and a genuinely empty answer still gets its
 * plain sentence with no alert — an operator-confirmed zero is a fact, not a missing number. The
 * search page's pre-submit prompt ("Start typing to search") is an IDLE state, not a failure, so it
 * stays keyed off the empty input.
 *
 * RED AT BASE: with the two product files at their `origin/main` state and this file as committed,
 * 28 of the 42 cases fail. Ten are the refused-refresh states that have no words at base — six for
 * the search typeahead (kept rows called an outage, the caveat's retry, the spinner over rows being
 * revalidated, a refusal over a counted zero, a messageless refusal) and four for the filtered read
 * re-run of the identical submitted body. Nine are data-explorer over kept rows, including the write
 * walk, the deals tab's money figure and the Export click — which at base fires its "Search failed"
 * toast over a table that is perfectly well. Four are data-explorer's never-answered read, whose only
 * channel at base is that four-second toast: the outage card, its retry, the dashed results count
 * and "no toast carried it". One is a refusal over an answered-empty table (the zero must stay AND
 * the caveat appear). Four are the source ratchets — and the guard-blindness case fails at base only
 * on "is the split still bound this way", because both `inspect()` claims hold at base too, which is
 * exactly the blindness. The other 14 pass at base and stay green: #2829/#2838's controls — the
 * searched term's outage and its retry, the honest empty answer on all three reads, the filtered "did
 * not run" arm, page 2 as a fresh key that never answered, the pre-submit prompt — plus the
 * explorer's plain success and genuine-zero rows, and the sweep / ceiling / silence pins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
/** the `?q=` the search page is entered with; '' is the pre-submit state. */
const nav = vi.hoisted(() => ({ q: 'acme' }));

vi.mock('@/lib/query/client', () => ({
  // The page constructs this for a failed filtered search, so it has to exist.
  ApiQueryError: class ApiQueryError extends Error {
    status: number;
    info: unknown;
    constructor(message: string, status: number, info: unknown) {
      super(message);
      this.name = 'ApiQueryError';
      this.status = status;
      this.info = info;
    }
  },
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? {
      data: undefined, error: null, isLoading: false, isFetching: false, isError: false,
      refetch: vi.fn(),
    },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.q ? `q=${nav.q}` : ''),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenant/search',
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
// The saved-view picker reads its own roster; neither page here is about presets.
vi.mock('@/components/tenant/saved-views', () => ({ SavedViews: () => null }));
// Both pages still toast for ACTIONS (record updated, deleted, and the export guard). Stubbing the
// library is what lets the cases below assert that no page STATE travels in it.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import toast from 'react-hot-toast';
import SearchPage from '@/app/tenant/search/page';
import DataExplorerPage from '@/app/tenant/data-explorer/page';

const QUICK_ALL = '/api/tenant/search?q=acme&type=all&limit=12';
const QUICK_CONTACTS = '/api/tenant/search?q=acme&type=contacts&limit=12';
const ADVANCED_URL = '/api/tenant/search/advanced';
const EXPLORER_CONTACTS = '/api/tenant/data-explorer?type=contacts&page=1&limit=50&sort=created_at&order=desc';
const EXPLORER_DEALS = '/api/tenant/data-explorer?type=deals&page=1&limit=50&sort=created_at&order=desc';

/** Names that never contain the term, so `<Highlight>` does not split them across nodes. */
const quickRows = {
  contacts: [
    { id: 'q-1', first_name: 'Grace', last_name: 'Hopper', email: 'grace@navy.test', lead_status: 'new', company_name: 'Navy Bureau' },
  ],
};
const quickEmpty = { contacts: [], leads: [], deals: [], companies: [], tasks: [] };
const filteredRows = {
  data: [
    { id: 'a-1', first_name: 'Alan', last_name: 'Turing', email: 'alan@bletchley.test', lead_status: 'qualified', company_name: 'Code No. 1' },
  ],
  pagination: { total: 60, page: 1, limit: 25, totalPages: 3, hasMore: true },
};
const filteredEmpty = { data: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0, hasMore: false } };

const contactRows = {
  data: [
    { id: 'r-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@analytical.test', phone: '207 555 0142', lead_status: 'new', company_name: 'Analytical Engines', created_at: '2026-03-01T00:00:00.000Z' },
    { id: 'r-2', first_name: 'Grace', last_name: 'Hopper', email: 'grace@navy.test', phone: '207 555 0177', lead_status: 'qualified', company_name: 'Navy Bureau', created_at: '2026-03-02T00:00:00.000Z' },
  ],
  total: 137, page: 1, limit: 50, hasMore: true, sort: 'created_at', order: 'desc',
};
const explorerEmpty = { data: [], total: 0, page: 1, limit: 50, hasMore: false, sort: 'created_at', order: 'desc' };
const dealRows = {
  data: [
    { id: 'd-1', title: 'Annual support retainer', amount: '180000', stage_id: 'discovery', close_date: null, contact_name: 'Ada Lovelace', created_at: '2026-03-03T00:00:00.000Z' },
  ],
  total: 1, page: 1, limit: 50, hasMore: false, sort: 'created_at', order: 'desc',
};

const ok = (data: unknown): QueryResult => ({
  data, error: null, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
});
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, isError: true, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, isError: true, refetch: vi.fn(),
});
/** In flight over an answer the key already has: the rows must stay on screen. */
const refetching = (data: unknown): QueryResult => ({
  data, error: null, isLoading: false, isFetching: true, isError: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** The one alert whose copy matches `re` — so a retry click can be pinned to a single read. */
function caveat(re: RegExp): HTMLElement {
  const hit = screen.queryAllByRole('alert').find((el) => re.test(el.textContent ?? ''));
  expect(hit, `no alert matching ${re} — alerts were: ${alerts()}`).toBeTruthy();
  return hit as HTMLElement;
}
const retryIn = (re: RegExp) => {
  const alert = caveat(re);
  const button = within(alert).getByRole('button', { name: /try again/i });
  fireEvent.click(button);
};

/** `POST /api/tenant/search/advanced` and the data-explorer writes. */
const net = {
  post: { status: 200, body: filteredRows as unknown },
  posts: [] as Record<string, unknown>[],
  writes: [] as { method: string; body: string }[],
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubNet() {
  net.post = { status: 200, body: filteredRows };
  net.posts = [];
  net.writes = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url === ADVANCED_URL) {
      net.posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(net.post.body, net.post.status);
    }
    if (url === '/api/tenant/data-explorer') {
      net.writes.push({ method, body: String(init?.body ?? '') });
      return jsonResponse({ ok: true }, 200);
    }
    return jsonResponse({}, 500);
  }));
}

const makeClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
});
const draw = (node: ReactNode, client = makeClient()) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};
const openSearch = (client?: QueryClient) => draw(<SearchPage />, client);
const openExplorer = () => draw(<DataExplorerPage />);

/** Contacts tab → the Filters panel → Apply Filters. The submitted body is always the same, so
 *  repeating this on a second mount re-runs the SAME advanced key: the refused re-run #2872 is about. */
async function applyContactsSearch() {
  fireEvent.click(screen.getByRole('button', { name: /^Contacts/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  await waitFor(() => expect(net.posts.length).toBeGreaterThan(0));
}

beforeEach(() => {
  nav.q = 'acme';
  registry.byUrl = {};
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  stubNet();
});
afterEach(() => {
  cleanup();
  nav.q = 'acme';
  vi.unstubAllGlobals();
});

describe('search: a refused refresh of the term it answered keeps the answer (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = { [QUICK_ALL]: staleRead(quickRows), [QUICK_CONTACTS]: ok(quickRows) };
  });

  it('keeps the rows it counted and says they are the last read, not an outage', () => {
    openSearch();
    expect(screen.getByText(/Grace Hopper/)).toBeTruthy();
    expect(alerts()).toContain('the results below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The base page said the opposite over these same rows.
    expect(alerts()).not.toContain('nothing was counted');
    expect(screen.queryByText(/Searching/)).toBeNull();
  });

  it('names what the kept answer cannot show and still counts it in the tab chips', () => {
    openSearch();
    expect(alerts()).toContain('Anything created since that read is not in them');
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toContain('1');
  });

  it('re-runs the typeahead from the caveat, not a sibling read', () => {
    const quick = registry.byUrl[QUICK_ALL];
    openSearch();
    retryIn(/last read/);
    expect(quick?.refetch).toHaveBeenCalledTimes(1);
    expect(net.posts).toHaveLength(0);
  });

  it('keeps the rows while the same term is being revalidated, instead of a spinner', () => {
    registry.byUrl = { [QUICK_ALL]: refetching(quickRows) };
    openSearch();
    expect(screen.getByText(/Grace Hopper/)).toBeTruthy();
    expect(screen.queryByText(/Searching/)).toBeNull();
    expect(alerts()).toBe('');
  });

  it('calls a counted zero the last read when the refresh was refused over it', () => {
    // The hard case: an empty answer is correct here, and so is the caveat. Neither replaces the other.
    registry.byUrl = { [QUICK_ALL]: staleRead(quickEmpty) };
    openSearch();
    expect(screen.getByText(/No results for "acme"/)).toBeTruthy();
    expect(alerts()).toContain('the results below are the last read');
    expect(alerts()).not.toContain('nothing was counted');
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [QUICK_ALL]: staleRead(quickRows, '') };
    openSearch();
    expect(alerts()).toContain('no response from the server');
    expect(screen.getByText(/Grace Hopper/)).toBeTruthy();
  });

  it('carries the refusal in the panel, not in a toast', () => {
    openSearch();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('search: the typeahead that never answered is still an outage (#2829/#2838 controls)', () => {
  it('quotes the reason, dashes nothing and never says "no results"', () => {
    registry.byUrl = { [QUICK_ALL]: failed('Request failed (500)') };
    openSearch();
    expect(alerts()).toContain('Search failed: Request failed (500)');
    expect(alerts()).toContain('not "no results"');
    expect(screen.queryByText(/No results for/)).toBeNull();
    expect(alerts()).not.toContain('last read');
    // The chip row is gated on an answer, so it prints no false zero.
    expect(screen.queryByRole('button', { name: /^Contacts/ })).toBeNull();
  });

  it('offers to re-run the term that failed', () => {
    registry.byUrl = { [QUICK_ALL]: failed('Request failed (500)') };
    const quick = registry.byUrl[QUICK_ALL];
    openSearch();
    retryIn(/Search failed/);
    expect(quick?.refetch).toHaveBeenCalledTimes(1);
  });

  it('says nothing matched, with no alert, when the term came back empty', () => {
    registry.byUrl = { [QUICK_ALL]: ok(quickEmpty) };
    openSearch();
    expect(screen.getByText(/No results for "acme"/)).toBeTruthy();
    expect(screen.getByText(/Try a different search term/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('shows the rows of a term it answered with no caveat at all', () => {
    registry.byUrl = { [QUICK_ALL]: ok(quickRows) };
    openSearch();
    expect(screen.getByText(/Grace Hopper/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('is not a failure before a search has been submitted: the prompt is an idle state', () => {
    // No `?q=`, so no read was ever asked. The prompt belongs here and keyed off `failed` would
    // have hidden it — an idle panel is not an outage.
    nav.q = '';
    openSearch();
    expect(screen.getByText(/Start typing to search/)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it('keeps the idle prompt when a cleared term left an error bound', () => {
    // The read is disabled for an empty term, but its previous error is still on the result object.
    // That is not a page state worth an alert — nothing is being asked of the route.
    nav.q = '';
    registry.byUrl = { '/api/tenant/search?q=&type=all&limit=12': failed('Request failed (500)') };
    openSearch();
    expect(screen.getByText(/Start typing to search/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('search: the filtered read keeps its answer through a refused re-run (#2872)', () => {
  // The typeahead rows have to exist for the tab chips — and so the Filters panel — to render.
  beforeEach(() => {
    registry.byUrl = { [QUICK_ALL]: ok(quickRows), [QUICK_CONTACTS]: ok(quickRows) };
  });

  it('a refused re-run of the same submitted body keeps the rows and calls them the last read', async () => {
    // Nothing on this page writes: this is re-entry asking the identical key — the body, the type,
    // the chips and the page are the key — after the 30-second stale window.
    const client = makeClient();
    openSearch(client);
    await applyContactsSearch();
    await screen.findByText(/Alan Turing/);
    expect(alerts()).toBe('');

    net.post = { status: 504, body: { error: 'Search index is rebuilding' } };
    openSearch(client);
    await applyContactsSearch();
    await waitFor(() => expect(alerts()).toContain('the answer below is the last read'));
    expect(screen.getByText(/Alan Turing/)).toBeTruthy();
    expect(alerts()).toContain('Search index is rebuilding');
    expect(alerts()).not.toContain('did not run');

    net.post = { status: 200, body: filteredRows };
    openSearch(client);
    await applyContactsSearch();
    await screen.findByText(/Alan Turing/);
    expect(alerts()).toBe('');
  });

  it('a refused re-run over a filtered zero keeps the zero and adds the caveat', async () => {
    const client = makeClient();
    net.post = { status: 200, body: filteredEmpty };
    openSearch(client);
    await applyContactsSearch();
    await screen.findByText(/No contacts match this search/);

    net.post = { status: 500, body: { error: 'boom' } };
    openSearch(client);
    await applyContactsSearch();
    await waitFor(() => expect(alerts()).toContain('the answer below is the last read'));
    // The counted zero is a fact about the tenant's data; the caveat is what stops it claiming more.
    expect(screen.getByText(/No contacts match this search/)).toBeTruthy();
    expect(screen.getByText(/The request succeeded and counted nothing/)).toBeTruthy();
    expect(alerts()).not.toContain('still unknown');
  });

  it('re-runs the filtered read from the caveat and leaves the typeahead alone', async () => {
    const client = makeClient();
    openSearch(client);
    await applyContactsSearch();
    await screen.findByText(/Alan Turing/);

    net.post = { status: 500, body: { error: 'boom' } };
    openSearch(client);
    await applyContactsSearch();
    await waitFor(() => expect(alerts()).toContain('the answer below is the last read'));
    const askedBefore = net.posts.length;
    const quick = registry.byUrl[QUICK_CONTACTS];
    retryIn(/last read/);
    expect(quick?.refetch).not.toHaveBeenCalled();
    await waitFor(() => expect(net.posts.length).toBe(askedBefore + 1));
  });

  it('names the server when the route refuses without saying why', async () => {
    net.post = { status: 500, body: { error: '' } };
    openSearch();
    await applyContactsSearch();
    await waitFor(() => expect(alerts()).toContain('The filtered contacts search did not run'));
    expect(alerts()).toContain('no response from the server');
  });
});

describe('search: a filtered view that never answered is not a last read (#2838 controls)', () => {
  beforeEach(() => {
    registry.byUrl = { [QUICK_ALL]: ok(quickRows), [QUICK_CONTACTS]: ok(quickRows) };
  });

  it('says the search did not run and keeps the "no match" sentence unreachable', async () => {
    net.post = { status: 500, body: { error: 'Search is unavailable right now' } };
    openSearch();
    await applyContactsSearch();
    await waitFor(() => expect(alerts()).toContain('did not run'));
    expect(alerts()).toContain('Search is unavailable right now');
    expect(alerts()).toContain('still unknown');
    expect(screen.queryByText(/No contacts match this search/)).toBeNull();
    expect(alerts()).not.toContain('last read');
  });

  it('treats page 2 of a filtered search that never answered as a failure, not a stale read', async () => {
    // `submitted` carries the page, so Next makes a NEW key: there is no last read of page 1 to keep
    // for a page that has never been asked.
    openSearch();
    await applyContactsSearch();
    await screen.findByText(/Alan Turing/);

    net.post = { status: 500, body: { error: 'page 2 unavailable' } };
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(net.posts).toHaveLength(2));
    await waitFor(() => expect(alerts()).toContain('did not run'));
    expect(net.posts[1]).toMatchObject({ page: 2 });
    expect(screen.queryByText(/Alan Turing/)).toBeNull();
    expect(alerts()).not.toContain('last read');
  });
});

describe('data-explorer: a refused refresh keeps the table and says what it hides (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = { [EXPLORER_CONTACTS]: staleRead(contactRows), [EXPLORER_DEALS]: ok(dealRows) };
  });

  it('keeps both rows and the counted total and labels them the last read', () => {
    openExplorer();
    expect(screen.getByText('Lovelace')).toBeTruthy();
    expect(screen.getByText('Hopper')).toBeTruthy();
    expect(screen.getByText(/^137 results/)).toBeTruthy();
    expect(alerts()).toContain('the contacts table below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toContain('Could not load');
    expect(screen.queryByText(/No contacts found/)).toBeNull();
  });

  it('names the edits and deletes a refused refresh would not reflect', () => {
    openExplorer();
    expect(alerts()).toContain('A cell you just edited or a row you just deleted is still shown the way it was');
    expect(alerts()).toContain('Export CSV writes these rows');
  });

  it('keeps a row actionable through the refusal, and the caveat outlives the write', async () => {
    openExplorer();
    const row = screen.getByText('Lovelace').closest('tr');
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByTitle('Delete'));
    await waitFor(() => expect(net.writes.some((w) => w.method === 'DELETE')).toBe(true));
    expect(screen.getByText('Lovelace')).toBeTruthy();
    await waitFor(() => expect(alerts()).toContain('the contacts table below is the last read'));
  });

  it('keeps money figures the last read printed', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: ok(contactRows), [EXPLORER_DEALS]: staleRead(dealRows) };
    openExplorer();
    fireEvent.click(screen.getByRole('button', { name: /Deals/ }));
    expect(screen.getByText('Annual support retainer')).toBeTruthy();
    expect(screen.getByText('180000')).toBeTruthy();
    expect(screen.getByText(/^1 result$/)).toBeTruthy();
    expect(alerts()).toContain('the deals table below is the last read');
  });

  it('shows the rows while they are being revalidated instead of a spinner', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: refetching(contactRows) };
    openExplorer();
    expect(screen.getByText('Lovelace')).toBeTruthy();
    expect(screen.getByText(/^137 results/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('re-runs the refused table from the caveat, not the entity tab beside it', () => {
    const contacts = registry.byUrl[EXPLORER_CONTACTS];
    const deals = registry.byUrl[EXPLORER_DEALS];
    openExplorer();
    retryIn(/last read/);
    expect(contacts?.refetch).toHaveBeenCalledTimes(1);
    expect(deals?.refetch).not.toHaveBeenCalled();
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: staleRead(contactRows, '') };
    openExplorer();
    expect(alerts()).toContain('no response from the server');
    expect(screen.getByText('Lovelace')).toBeTruthy();
  });

  it('exports the kept rows rather than refusing to say what it is holding', async () => {
    let csv = '';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, writable: true,
      value: (b: Blob) => { void b.text().then((t) => { csv = t; }); return 'blob:fixture'; },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} });
    openExplorer();
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(csv).toContain('ada@analytical.test'));
    expect(csv).toContain('grace@navy.test');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('walks a write: a good read, the refused reload the write triggers, a good read again', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: ok(contactRows) };
    openExplorer();
    expect(screen.getByText('Lovelace')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [EXPLORER_CONTACTS]: staleRead(contactRows) };
    draw(<DataExplorerPage />);
    expect(screen.getByText('Lovelace')).toBeTruthy();
    expect(alerts()).toContain('the contacts table below is the last read');

    registry.byUrl = { [EXPLORER_CONTACTS]: ok(contactRows) };
    draw(<DataExplorerPage />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('data-explorer: a table that never answered is not an empty table (#2872)', () => {
  it('shows the outage with its reason and makes "No contacts found" unreachable', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: failed('Request failed (500)') };
    openExplorer();
    expect(alerts()).toContain('Could not load contacts: Request failed (500)');
    expect(alerts()).toContain('this is a failed request, not an empty table');
    expect(screen.queryByText(/No contacts found/)).toBeNull();
    expect(alerts()).not.toContain('last read');
  });

  it('dashes the results count the base page hid behind an absent figure', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: failed('Request failed (500)') };
    openExplorer();
    expect(screen.getByText(/^— results/)).toBeTruthy();
  });

  it('re-runs the read that never answered from the outage card', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: failed('Request failed (500)') };
    const contacts = registry.byUrl[EXPLORER_CONTACTS];
    openExplorer();
    retryIn(/Could not load contacts/);
    expect(contacts?.refetch).toHaveBeenCalledTimes(1);
  });

  it('takes the page state out of the toast: the read failure is rendered, not faded', () => {
    // At base this was the only channel — `if (error) toast.error('Search failed')` in an effect.
    registry.byUrl = { [EXPLORER_CONTACTS]: failed('Request failed (500)') };
    openExplorer();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Could not load contacts');
  });
});

describe('data-explorer: what an answered read still says (#2872 controls)', () => {
  it('says no contacts were found, with a real zero and no alert', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: ok(explorerEmpty) };
    openExplorer();
    expect(screen.getByText(/No contacts found/)).toBeTruthy();
    expect(screen.getByText(/^0 results/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('calls a refused refresh over an answered empty table a last read, keeping the zero', () => {
    // Both statements are true at once and neither may swallow the other: the count is what the
    // last read counted, the caveat is what a re-run would not have confirmed.
    registry.byUrl = { [EXPLORER_CONTACTS]: staleRead(explorerEmpty) };
    openExplorer();
    expect(screen.getByText(/No contacts found/)).toBeTruthy();
    expect(screen.getByText(/^0 results$/)).toBeTruthy();
    expect(alerts()).toContain('the contacts table below is the last read');
    expect(alerts()).not.toContain('Could not load');
  });

  it('renders the rows with their columns and no caveat when the read is fine', () => {
    registry.byUrl = { [EXPLORER_CONTACTS]: ok(contactRows) };
    openExplorer();
    expect(screen.getByText('Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@analytical.test')).toBeTruthy();
    expect(screen.getByText(/^137 results \(showing page 1 of 3\)$/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const SEARCH_FILE = 'app/tenant/search/page.tsx';
  const EXPLORER_FILE = 'app/tenant/data-explorer/page.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('search splits each of its two reads instead of reading the flag', () => {
    const s = src(SEARCH_FILE);
    expect(s).toMatch(/const quickFailed = Boolean\(quickQuery\.error\) && !quickQuery\.data;/);
    expect(s).toMatch(/const quickStale = Boolean\(quickQuery\.error\) && Boolean\(quickQuery\.data\);/);
    expect(s).toMatch(/const advancedFailed = Boolean\(advancedQuery\.error\) && !advancedQuery\.data;/);
    expect(s).toMatch(/const advancedStale = Boolean\(advancedQuery\.error\) && Boolean\(advancedQuery\.data\);/);
    expect(s).toMatch(/Query\.error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\{submitted && !loading && advancedStale && \(/);
    expect(s).toMatch(/\{!submitted && trimmed\.length > 0 && quickStale && \(/);
    // Neither banner may be the bare flag any more, and neither may be gated on `loading` alone.
    expect(s, 'a kept answer is still being called an outage').not.toMatch(/quickQuery\.isError/);
    expect(s, 'a kept answer is still being called an outage').not.toMatch(/advancedQuery\.isError/);
    expect(s, 'the typeahead still blanks its rows for a background revalidation')
      .not.toMatch(/loadingQuery = quickQuery\.isFetching/);
    // The pre-submit prompt is an idle state: it must not be gated on the failure flags.
    expect(s).toMatch(/\{!query && !loading && !submitted && \(/);
  });

  it('data-explorer splits its one read and stopped toasting the refusal', () => {
    const s = src(EXPLORER_FILE);
    expect(s).toMatch(/const failed = Boolean\(error\) && !results;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(results\);/);
    expect(s).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/\) : failed \? \(/);
    // The table branch may not be gated on `isFetching`: a background revalidation of kept rows
    // would swap those rows for a spinner, and the refusal after it would have nothing to keep.
    expect(s, 'isFetching still gates the table over kept rows').not.toMatch(/isFetching: loading/);
    expect(s).toMatch(/isLoading: loading/);
    expect(s, 'the failure is still fired from an effect').not.toMatch(/if \(error\) toast\.error/);
    expect(s).not.toMatch(/^\s*if \(error\) toast\./m);
    expect(s, 'the load failure is still routed to a toast at all').not.toMatch(/toast\.error\([^)]*[Ss]earch failed/);
    // The export guard may not report an unread table as an empty one.
    expect(s).toMatch(/failed \? `Cannot export/);
  });

  it('keeps the figures keyed off the outage, not the flag', () => {
    const s = src(EXPLORER_FILE);
    expect(s).toMatch(/\{failed \? '— results'/);
    expect(s, 'a kept read is dashed as though it never answered').not.toMatch(/error \? '—'/);
  });

  it('reports both pages clean before and after the split is rewound', async () => {
    // The proof that the screen is blind to this pair: both files pass it at base too. data-explorer
    // interpolates its own empty sentence ("No {entityType} found"), which its EMPTY_SENTENCE pattern
    // cannot match, and search's is inside a template literal — so neither page is even counted.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, RegExp, string][] = [
      [EXPLORER_FILE, /const failed = Boolean\(error\) && !results;[^\n]*\n\s*const stale = Boolean\(error\) && Boolean\(results\);[^\n]*/, 'const failed = Boolean(error);'],
      [SEARCH_FILE, /const quickFailed = Boolean\(quickQuery\.error\) && !quickQuery\.data;[^\n]*\n\s*const quickStale = Boolean\(quickQuery\.error\) && Boolean\(quickQuery\.data\);[^\n]*/, 'const quickFailed = Boolean(quickQuery.error);'],
      [SEARCH_FILE, /const advancedFailed = Boolean\(advancedQuery\.error\) && !advancedQuery\.data;[^\n]*\n\s*const advancedStale = Boolean\(advancedQuery\.error\) && Boolean\(advancedQuery\.data\);[^\n]*/, 'const advancedFailed = Boolean(advancedQuery.error);'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `the shape this slice depends on moved: ${file}`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${file}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'search went back on the list it was never on').not.toContain(SEARCH_FILE);
    expect(files, 'data-explorer went back on the list it was never on').not.toContain(EXPLORER_FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [SEARCH_FILE, EXPLORER_FILE]) {
      const lines = src(f).split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the suites that already mount these pages silent about a kept read', () => {
    // #2829/#2838 grade which answer a failed read may speak for. None of them speaks about rows
    // kept through a refused refresh, and this slice must not make them start.
    for (const f of [
      'tests/unit/search-advanced-filters-2838.test.tsx',
      'tests/unit/advanced-search-scope-2690.test.ts',
      'tests/unit/csv-formula-injection.test.ts',
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} started talking about the last read`)
        .not.toMatch(/last read/);
    }
  });
});
