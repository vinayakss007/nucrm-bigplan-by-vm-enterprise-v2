// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2231 — tenant header global search:
 *   - a 500 / HTML / network reply must render an explicit error affordance
 *     with retry, never "No results" and never a spinner stuck on forever;
 *   - a genuine zero-match response keeps the empty state;
 *   - typing while a request is in flight aborts the older one so stale
 *     responses can't clobber newer results.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), pathname: '/tenant' }),
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/components/shared/bug-report-button', () => ({
  default: () => null,
}));

import TenantHeader from '@/components/tenant/layout/header';
import type { TenantInfo, ProfileInfo } from '@/components/tenant/layout/types';

const tenant = { primary_color: '#7c3aed' } as unknown as TenantInfo;
const profile = { full_name: 'Test User', email: 't@t.com' } as unknown as ProfileInfo;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function htmlResponse(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

function mountWithSearch(handler: FetchHandler) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/tenant/search')) return handler(url, init);
    return jsonResponse({ data: [], count: 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<TenantHeader tenant={tenant} profile={profile} roleSlug="admin" />);
  return fetchMock;
}

/** Type into the header search and wait for the 250ms debounce to fire. */
async function searchFor(query: string) {
  fireEvent.change(screen.getByTestId('search-input'), { target: { value: query } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).startsWith('/api/tenant/search'))).toBe(true));
  // Let the resolved fetch settle into state.
  await waitFor(() => expect(document.querySelector('.animate-spin')).toBeNull());
}

describe('TenantHeader search error handling (#2231)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an error affordance with retry on a 500 — not "No results", not a frozen spinner', async () => {
    mountWithSearch(async () => jsonResponse({ error: 'search index unavailable' }, false, 500));
    await searchFor('acme');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('search index unavailable');
    expect(screen.getByRole('alert').textContent).toContain('Try again');
    expect(screen.queryByText(/No results/)).toBeNull();
    // `searching` was cleared: the input spinner element is gone.
    expect(document.querySelector('.animate-spin')).toBeNull();

    // Retry re-runs the search and recovers.
    vi.mocked(fetch).mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/tenant/search')) return jsonResponse({ leads: [], contacts: [], deals: [], companies: [], tasks: [] });
      return jsonResponse({ data: [], count: 0 });
    });
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('No results for "acme"')).toBeTruthy();
  });

  it('an HTML error page (unparseable body) also surfaces an error, and the spinner never sticks', async () => {
    mountWithSearch(async () => htmlResponse(502));
    await searchFor('widget');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Request failed with status 502');
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('a network rejection is an error state, not a silent infinite search', async () => {
    mountWithSearch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await searchFor('anything');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/No results/)).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('keeps the genuine empty state when the API succeeds with zero matches', async () => {
    mountWithSearch(async () => jsonResponse({ leads: [], contacts: [], deals: [], companies: [], tasks: [] }));
    await searchFor('zzzz');
    await waitFor(() => expect(screen.getByText('No results for "zzzz"')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders results on success', async () => {
    mountWithSearch(async () => jsonResponse({ leads: [{ id: 'l1', first_name: 'Ada', last_name: 'Lovelace', company_name: 'Analytical' }], contacts: [], deals: [], companies: [], tasks: [] }));
    await searchFor('ada');
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts the previous in-flight request when a newer query supersedes it (no stale clobbering)', async () => {
    const signals: AbortSignal[] = [];
    mountWithSearch(async (_url, init) => {
      signals.push((init?.signal ?? new AbortController().signal) as AbortSignal);
      // Slow first response — the classic out-of-order race.
      await new Promise(r => setTimeout(r, 400));
      return jsonResponse({ leads: [], contacts: [], deals: [], companies: [], tasks: [] });
    });
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'old' } });
    await waitFor(() => expect(signals.length).toBe(1));
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'newer' } });
    await waitFor(() => expect(signals.length).toBe(2));

    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    await waitFor(() => expect(document.querySelector('.animate-spin')).toBeNull());
  });

  it('search dropdown shows a loading row (not an empty box) while the first request is pending', async () => {
    let resolveFetch: ((r: Response) => void) | undefined;
    mountWithSearch(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'slow' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Searching…'));
    resolveFetch?.(jsonResponse({ leads: [], contacts: [], deals: [], companies: [], tasks: [] }));
    await waitFor(() => expect(screen.getByText('No results for "slow"')).toBeTruthy());
  });
});
