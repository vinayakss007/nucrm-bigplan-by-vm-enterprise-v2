// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2838 — the Filters panel asked its question and threw away the answer.
 *
 * `/tenant/search` rendered the typeahead GET (`/api/tenant/search`, no filters,
 * 12 rows) while the POST to `/api/tenant/search/advanced` — whose response the
 * page stored in `_advancedResults` and read nowhere — did the filtered work for
 * nothing. Picking `Status: Qualified` and pressing Apply Filters left the same
 * unfiltered rows on screen under chips that said otherwise.
 *
 * The page now renders what the filtered request returned, and each case below
 * pins one property of that:
 *
 *   - the rows on screen are the POST's, not the GET's (they are distinguishable
 *     fixtures, so a page that kept rendering the typeahead fails visibly);
 *   - the POST body carries the filters that were picked;
 *   - the count is the route's `pagination.total`, not the length of the page
 *     that arrived, and Next asks for page 2;
 *   - an empty filtered answer says "no match" with no alert, and a failed one
 *     says it did not run with no "no match" — the #2829 distinction, on the
 *     half of search that #2829's sweep found;
 *   - a failed typeahead renders a failure instead of nothing at all, which is
 *     what it used to do;
 *   - a filtered answer does not survive a tab switch into another type's list;
 *   - editing chips after applying says the list still answers the old question.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const net = vi.hoisted(() => ({
  /** url → what the next GET to it answers. */
  get: {} as Record<string, { status: number; body: unknown }>,
  post: { status: 200, body: {} as unknown },
  posts: [] as { url: string; body: Record<string, unknown> }[],
  gets: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('q=ada'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
// The saved-view picker fetches its own roster; this file is about which rows
// the page renders, not about presets loading.
vi.mock('@/components/tenant/saved-views', () => ({ SavedViews: () => null }));

import SearchPage from '@/app/tenant/search/page';

const QUICK_URL = '/api/tenant/search?q=ada&type=all&limit=12';
const ADVANCED_URL = '/api/tenant/search/advanced';

/** Two fixtures that can never be confused for one another. */
const typeahead = {
  contacts: [
    { id: 'q-1', first_name: 'Typeahead', last_name: 'Person', email: 'q@x.dev', lead_status: 'new' },
    { id: 'q-2', first_name: 'Another', last_name: 'Unfiltered', email: 'q2@x.dev', lead_status: 'contacted' },
  ],
};
const filtered = {
  data: [
    { id: 'a-1', first_name: 'Qualified', last_name: 'Only', email: 'a@x.dev', lead_status: 'qualified' },
  ],
  pagination: { total: 138, page: 1, limit: 25, totalPages: 6, hasMore: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

/** Seed the typeahead, wait for its rows, then narrow to one type. */
async function typeaheadOnScreen() {
  mount();
  await screen.findByText(/Typeahead Person/);
  fireEvent.click(screen.getByRole('button', { name: /Contacts/ }));
  await screen.findByRole('button', { name: /^Filters/ });
}

async function applyStatusFilter(value = 'Qualified') {
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  fireEvent.click(await screen.findByRole('button', { name: value }));
  fireEvent.click(await screen.findByRole('button', { name: 'Apply Filters' }));
}

beforeEach(() => {
  net.get = { [QUICK_URL]: { status: 200, body: typeahead } };
  net.post = { status: 200, body: filtered };
  net.posts = [];
  net.gets = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      net.posts.push({ url, body: JSON.parse(String(init?.body)) });
      return jsonResponse(net.post.body, net.post.status);
    }
    net.gets.push(url);
    const hit = net.get[url];
    return jsonResponse(hit?.body ?? {}, hit?.status ?? 200);
  }));
});

describe('#2838 — the filtered answer reaches the screen', () => {
  it('asks the advanced route with the filters that were picked', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();

    await waitFor(() => expect(net.posts).toHaveLength(1));
    expect(net.posts[0].url).toBe(ADVANCED_URL);
    expect(net.posts[0].body).toMatchObject({
      type: 'contacts',
      query: 'ada',
      filters: { status: ['qualified'] },
      page: 1,
    });
  });

  it('renders the rows the filtered request returned instead of the typeahead rows', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();

    // The filtered row arrives and the unfiltered ones go with it: a page that
    // kept rendering the typeahead would show "Typeahead Person" here.
    await screen.findByText(/Qualified Only/);
    expect(screen.queryByText(/Typeahead Person/)).toBeNull();
    expect(screen.queryByText(/Another Unfiltered/)).toBeNull();
  });

  it('counts what the route matched, not what the page handed back', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();

    // The route says 138 rows match; this response carried one. The control has
    // to speak of 138, not of the slice.
    await screen.findByText(/1–25 of 138/);
  });

  it('asks the route for the next page when Next is pressed', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();
    await screen.findByText(/1–25 of 138/);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(net.posts).toHaveLength(2));
    expect(net.posts[1].body).toMatchObject({ page: 2, type: 'contacts', filters: { status: ['qualified'] } });
  });

  it('says nothing matched, without an alert, when the filtered search succeeded and was empty', async () => {
    net.post = { status: 200, body: { data: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0, hasMore: false } } };
    await typeaheadOnScreen();
    await applyStatusFilter();

    await screen.findByText(/No contacts match this search/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the search did not run, without claiming no match, when the route fails', async () => {
    net.post = { status: 500, body: { error: 'Search is unavailable right now' } };
    await typeaheadOnScreen();
    await applyStatusFilter();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('did not run');
    expect(alert.textContent).toContain('Search is unavailable right now');
    expect(screen.queryByText(/No contacts match this search/)).toBeNull();
    // …and the typeahead rows it replaced are not left standing in as an answer.
    expect(screen.queryByText(/Typeahead Person/)).toBeNull();
  });

  it('re-runs the failed filtered search from the alert', async () => {
    net.post = { status: 500, body: { error: 'boom' } };
    await typeaheadOnScreen();
    await applyStatusFilter();
    await screen.findByRole('alert');
    expect(net.posts).toHaveLength(1);

    net.post = { status: 200, body: filtered };
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(net.posts).toHaveLength(2));
    await screen.findByText(/Qualified Only/);
  });

  it('renders a failure for the typeahead instead of an empty page', async () => {
    net.get = { [QUICK_URL]: { status: 500, body: { error: 'Search is down' } } };
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Search failed');
    expect(alert.textContent).toContain('not "no results"');
    expect(screen.queryByText(/No results for/)).toBeNull();
  });

  it('does not let a filtered answer pose as another type’s rows', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();
    await screen.findByText(/Qualified Only/);

    fireEvent.click(screen.getByRole('button', { name: /Companies/ }));
    expect(screen.queryByText(/Qualified Only/)).toBeNull();
    expect(net.posts).toHaveLength(1); // no company search was ever asked for
  });

  it('says the list still answers the applied filters when the chips have moved on', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();
    await screen.findByText(/Qualified Only/);

    // The panel is still open from applying; picking a second value edits the
    // chips without asking anything of the route.
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));

    await screen.findByText(/still answers the search that was applied/);
    expect(net.posts).toHaveLength(1);
  });

  it('does not run the typeahead over a filtered answer it is not showing', async () => {
    await typeaheadOnScreen();
    await applyStatusFilter();
    await screen.findByText(/Qualified Only/);
    const getsBefore = net.gets.length;

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ada lovelace' } });
    await new Promise((r) => setTimeout(r, 450)); // past the 300ms debounce

    // No second GET: the typeahead stands down while its rows are not the
    // answer on screen, so typing cannot replace them with a spinner.
    expect(net.gets).toHaveLength(getsBefore);
    expect(screen.getByText(/Qualified Only/)).toBeTruthy();
  });
});
