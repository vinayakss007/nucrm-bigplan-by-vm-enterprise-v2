// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/offers/page.tsx`, the money page #2829's sweep could not reach.
 *
 * Its read model was one line: `const error = queryError ? \`Failed to load offers: …\` : null`.
 * Two separate lies followed from that. When a refresh was *refused* — the Refresh button, a
 * page step or a status pill all revalidate, and `page`/`status` are in the query key — TanStack
 * Query returned the payload the view already had, `filteredOffers` still mapped real rows at the
 * bottom of the page, and `error` still printed "Failed to load offers" over them: the offers were
 * on screen and declared unloadable in the same view. When a read *never answered*, `data?.summary`
 * was `{}`, so the four money cards printed `Drafts 0 · Awaiting 0 · Accepted 0 · Declined 0` with
 * `$0.00` beneath them and every status pill printed a count of 0 — an owner reads that as "nobody
 * has accepted anything", which is the damaging direction of the error. #2829 pinned exactly that
 * discipline for invoices, orders, contracts and subscriptions, but its `money[]` block works off
 * the rendered array and offers' figures come from the server's `summary`, so this page was never
 * in it and stayed unguarded.
 *
 * Both halves are pinned here against each other: the outage dashes the figures and the pill
 * counts (`—`, still clickable — the pill is the way out of the view), while a refused refresh
 * keeps rows, figures, counts and page arithmetic and names the specific loss. The loss is real
 * and out of band: the buyer accepts on `app/api/public/offers/[publicToken]/accept/route.ts`, so
 * an offer can move to accepted without anything on this page touching it.
 *
 * `scripts/check-panel-error-state.mjs` reports the page clean before and after the split is
 * rewound — it asks whether a panel binds an error and renders a failure affordance, and offers
 * already did both. The assertions below are the only thing keeping the stale half honest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import OffersPage from '@/app/tenant/offers/page';

const ALL = '/api/tenant/offers?page=1&pageSize=25';
const ACCEPTED = '/api/tenant/offers?page=1&pageSize=25&status=accepted';

const NOW = '2026-03-02T10:00:00.000Z';
const summary = {
  draft: { count: 2, amount: 1500 },
  sent: { count: 5, amount: 9800 },
  viewed: { count: 1, amount: 2400 },
  accepted: { count: 3, amount: 14600 },
  declined: { count: 1, amount: 900 },
};
const row = (id: string, title: string, status: string) => ({
  id, quote_number: `OF-${id}`, title, status, total_amount: '9800.00', expires_at: null,
  sent_at: NOW, accepted_at: null, declined_at: null, contact_id: 'ct1',
  contact_name: 'Kestrel Vane', contact_email: null, created_at: NOW, public_token: 'tok',
  sent_to_email: null, viewed_count: 2,
});
const payload = {
  offers: [
    row('a', 'Pilot — three depots', 'sent'),
    row('b', 'Annual service renewal', 'accepted'),
    row('c', 'Warehouse add-on', 'draft'),
  ],
  pagination: { page: 1, pageSize: 25, total: 9, pageCount: 2 },
  summary,
};
const emptyPayload = { offers: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 0 }, summary: {} };
const acceptedPayload = { ...payload, offers: [row('b', 'Annual service renewal', 'accepted')], pagination: { page: 1, pageSize: 25, total: 3, pageCount: 1 } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** Stat renders `<p>{label}</p><p class="text-3xl">{value}</p><p>{hint}</p>` in one card.
 *  Queried on `p` because the status pills carry the same words as buttons. */
const card = (label: string) => {
  const ps = [...document.querySelectorAll('p')].filter((el) => el.textContent === label);
  expect(ps.length, `expected one "${label}" stat label, saw ${ps.length}`).toBe(1);
  const parent = ps[0].parentElement;
  expect(parent, `the "${label}" card lost its wrapper`).not.toBeNull();
  return parent!.textContent ?? '';
};
const rowTitles = () =>
  screen.queryAllByRole('link', { name: /—|[A-Za-z]/ })
    .map((el) => el.textContent ?? '')
    .filter((t) => ['Pilot — three depots', 'Annual service renewal', 'Warehouse add-on'].includes(t));
const pillText = (label: string) => {
  const el = screen.getByRole('button', { name: new RegExp(`^${label}`) });
  return el.textContent ?? '';
};
const pagerLine = () =>
  [...document.querySelectorAll('span')]
    .map((el) => el.textContent ?? '')
    .find((t) => /^Page \d+ of \d+ ·/.test(t)) ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const showAll = () => wrapped(<OffersPage />);
const openPill = (label: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));

describe('a refused refresh keeps the offers, the figures and the counts (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = { [ALL]: staleRead(payload), [ACCEPTED]: ok(acceptedPayload) };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('keeps all three offers and says they are the last read, with the reason', () => {
    showAll();
    expect(rowTitles()).toEqual(['Pilot — three depots', 'Annual service renewal', 'Warehouse add-on']);
    expect(alerts()).toContain('Could not refresh, so the offers, the four figures and the pill counts are the last read: Request failed (504)');
  });

  it('does not call the offers it is showing a load failure (#2829\'s other half)', () => {
    showAll();
    expect(alerts()).not.toContain('Failed to load offers');
  });

  it('keeps the four money figures rather than dropping them with the rows', () => {
    showAll();
    expect(card('Drafts')).toContain('2');
    expect(card('Drafts')).toContain('$1,500');
    expect(card('Awaiting')).toContain('6');
    expect(card('Awaiting')).toContain('$12,200');
    expect(card('Accepted')).toContain('3');
    expect(card('Accepted')).toContain('$14,600');
    expect(card('Declined')).toContain('1');
  });

  it('keeps the pill counts that came with the read', () => {
    showAll();
    expect(pillText('Sent')).toContain('5');
    expect(pillText('Accepted')).toContain('3');
    expect(pillText('All')).toContain('12');
  });

  it('names the loss the buyer causes out of band, not a vague warning', () => {
    showAll();
    expect(alerts()).toMatch(/accepted or declined on their public link/);
    expect(alerts()).toMatch(/old status/);
    expect(alerts()).toMatch(/money totals are the older ones/);
    expect(alerts()).not.toMatch(/may be out of date/i);
  });

  it('keeps the last read\'s page arithmetic', () => {
    showAll();
    expect(pagerLine()).toBe('Page 1 of 2 · 9 total');
  });

  it('re-runs this read from the caveat', () => {
    const result = staleRead(payload);
    registry.byUrl = { [ALL]: result };
    showAll();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('still filters the rows it kept for the search box, which is client-side', () => {
    showAll();
    fireEvent.change(screen.getByPlaceholderText(/Search title/), { target: { value: 'depot' } });
    expect(rowTitles()).toEqual(['Pilot — three depots']);
    // The caveat survives a client-side narrowing: what is on screen is still the old read.
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('the read that never answered dashes the money instead of reporting zero (#2872)', () => {
  afterEach(cleanup);

  it('shows the outage card and dashes all four figures', () => {
    registry.byUrl = { [ALL]: failedRead() };
    showAll();
    expect(alerts()).toContain('Failed to load offers: Request failed (500)');
    expect(card('Drafts')).toContain('—');
    expect(card('Accepted')).toContain('—');
    expect(card('Awaiting')).toContain('—');
    expect(card('Declined')).toContain('—');
    // fmtCurrency prints whole dollars, so a false zero here reads "$0" — and a card
    // that says "$0" under an outage banner is the money lie this slice exists for.
    expect(card('Drafts')).not.toMatch(/\$/);
    expect(card('Accepted')).not.toMatch(/\$/);
    expect(rowTitles()).toHaveLength(0);
    expect(pagerLine()).toBe('');
  });

  it('dashes the pill counts but leaves the pills clickable', () => {
    registry.byUrl = { [ALL]: failedRead(), [ACCEPTED]: ok(acceptedPayload) };
    showAll();
    expect(pillText('Accepted')).toContain('—');
    expect(pillText('All')).toContain('—');
    openPill('Accepted');
    expect(rowTitles()).toEqual(['Annual service renewal']);
  });

  it('names the server rather than printing undefined when the refusal has no message', () => {
    registry.byUrl = { [ALL]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    showAll();
    expect(alerts()).toContain('Failed to load offers: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('says "No offers yet" only for the read that came back with nobody', () => {
    registry.byUrl = { [ALL]: ok(emptyPayload) };
    showAll();
    expect(screen.getByText(/No offers yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // A real zero is still a zero: the dash belongs to the unread, not to the empty.
    expect(card('Drafts')).toContain('0');
    expect(card('Accepted')).toContain('0');
  });

  it('still says none exist, with the caveat over it, when the empty list is all the last read has', () => {
    registry.byUrl = { [ALL]: staleRead(emptyPayload) };
    showAll();
    expect(screen.getByText(/No offers yet/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('each view is its own read, and each is judged on its own (#2872)', () => {
  afterEach(cleanup);

  it('calls a page that never answered an outage, not a stale copy of the view it replaced', () => {
    registry.byUrl = { [ALL]: staleRead(payload), [ACCEPTED]: failedRead('Request failed (503)') };
    showAll();
    openPill('Accepted');
    expect(alerts()).toContain('Failed to load offers: Request failed (503)');
    expect(alerts()).not.toMatch(/last read/i);
    expect(rowTitles()).toHaveLength(0);
    // The dashed figures belong to the view that never answered, not to the one it left.
    expect(card('Drafts')).toContain('—');
  });

  it('gives the view you came back to its rows and its caveat, not the outage you just saw', () => {
    registry.byUrl = { [ALL]: staleRead(payload), [ACCEPTED]: failedRead() };
    showAll();
    openPill('Accepted');
    openPill('All');
    expect(rowTitles()).toHaveLength(3);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('Failed to load offers');
    expect(card('Drafts')).toContain('2');
  });

  it('shows the kept rows and no alert at all once the refresh answers', () => {
    registry.byUrl = { [ALL]: ok(payload) };
    showAll();
    expect(rowTitles()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pagerLine()).toBe('Page 1 of 2 · 9 total');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/offers/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all').toMatch(/const failed = Boolean\(queryError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(queryError\) && Boolean\(data\);/);
    expect(s).toMatch(/const reason = queryError\?\.message \|\| 'no response from the server';/);
    expect(s, 'the old one-flag collapse is still there').not.toMatch(/queryError \? `Failed to load offers/);
    expect(s).toMatch(/\{stale && \(/);
  });

  it('gates every figure the read produces, not just the banner', () => {
    const s = src();
    const dashed = (s.match(/failed \? '—'/g) ?? []).length;
    expect(dashed, 'a money card or pill count still reports 0 for an unread summary').toBeGreaterThanOrEqual(9);
    expect(s).toMatch(/const count = failed \? '—'/);
    expect(s, 'a stat still reads the summary unguarded').not.toMatch(/value=\{summary\['draft'\]\?\.count/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string][] = [
      [/const failed = Boolean\(queryError\) && !data;\s*\n\s*const stale = Boolean\(queryError\) && Boolean\(data\);/,
       'const failed = Boolean(queryError);'],
      [/\{stale && \(/, '{false && ('],
      [/const count = failed \? '—' : s\.id/, "const count = failed ? 0 : s.id"],
    ];
    for (const [pattern, replacement] of rewinds) {
      const s = src();
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'offers went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
