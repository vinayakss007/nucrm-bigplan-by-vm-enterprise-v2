// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/analytics/email/stale-2872`: the analytics panel that answered two opposite
 * questions with one branch.
 *
 * One read — `['tenant','email','analytics']` → `/api/tenant/email/analytics` — and at base it
 * destructured **neither** `error` nor `refetch`:
 *
 *     const { data: resp, isLoading: loading } = useApiQuery(…);
 *     …
 *     { label: 'Total Tracked', value: data?.totalTracked ?? 0, … }        // a refusal printed 0
 *     { label: 'Open Rate',    value: `${data?.openRate ?? 0}%`, … }       // and a refusal 0%
 *     …
 *     ) : (<p>No tracking events yet</p>);                                  // and "the tenant sent nothing"
 *
 * Every figure on this page (totalTracked, opens, clicks, openRate, clickRate, events) is derived
 * from that single read — `openRate`/`clickRate` are `opens ÷ totalTracked` and `clicks ÷
 * totalTracked` (app/api/tenant/email/analytics/route.ts). So `failed = Boolean(error) && !data`
 * (never answered) had to withhold ALL of them, not print a dashboard of zeros and "No tracking
 * events yet": that reports a dead pool as "this tenant has sent no email and nobody opened it", and
 * a rate of `opens ÷ totalTracked` cannot show 0% when totalTracked is unread. `stale =
 * Boolean(error) && Boolean(data)` (refused refresh — useApiQuery keeps `data`, lib/query/client.tsx)
 * keeps the last read on screen under a banner that names the concrete loss: opens/clicks that
 * happened since are missing from the totals and no fresh event reaches the list. There is no
 * campaign/summary split here because both come off the same read, so one banner covers the whole
 * derived body; the only control on the page is each banner's own retry, so nothing is gated over a
 * stale read. `scripts/check-panel-error-state.mjs` never counted the page — its empty-sentence
 * screen looks BACKWARDS only ten lines, and "No tracking events yet" sat ~40 lines under
 * `data.events.length > 0` — so these render tests are the only thing carrying the rule.
 *
 * RED AT BASE — measured on `1d1bba2f` (this branch's base) with the page rewound to what main
 * carries and this file as committed: see the run log below.
 *
 * Fixtures are documentation-only (RFC 2606 .test names, synthetic ids).
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
// The page never toasts, but mocking the channel is how this suite proves a read failure could not
// be routed there: no assertion below can be satisfied by a toast.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import EmailAnalyticsPage from '@/app/tenant/analytics/email/page';

const ANALYTICS = '/api/tenant/email/analytics';

// 25% open rate, 10% click rate over 200 tracked; two recent events with distinct contacts.
const analyticsPayload = {
  data: {
    totalTracked: 200,
    opens: 50,
    clicks: 20,
    openRate: 25,
    clickRate: 10,
    events: [
      { id: 'e-1', type: 'open', contactEmail: 'ada@northwind.test', subject: 'Q3 update', timestamp: '2026-10-01T00:00:00Z' },
      { id: 'e-2', type: 'click', contactEmail: 'grace@acme.test', subject: 'Q3 update', timestamp: '2026-10-02T00:00:00Z', link: 'https://initech.test/pricing' },
    ],
  },
};
// The read answered, and the honest answer is: nothing tracked, no events.
const emptyPayload = { data: { totalTracked: 0, opens: 0, clicks: 0, openRate: 0, clickRate: 0, events: [] } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const pending = (): QueryResult => ({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });
/** Nothing in hand — the read never answered. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh was refused and the payload came back with it. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. The outage copy retires the absence sentence in its
 * own words, so a bare queryByText would otherwise find the banner quoting it and report the false
 * claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('email analytics: the one read bound neither error nor refetch (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('says nothing about freshness when the read answers, showing every derived figure', () => {
    registry.byUrl = { [ANALYTICS]: ok(analyticsPayload) };
    wrapped(<EmailAnalyticsPage />);
    expect(screen.getByText('Total Tracked')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10%').length).toBeGreaterThan(0);
    expect(screen.getByText('Recent Events')).toBeTruthy();
    expect(screen.getByText('ada@northwind.test')).toBeTruthy();
    expect(screen.getByText('grace@acme.test')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/No tracking events yet/)).toEqual([]);
  });

  it('says the honest empties when empty is what a healthy read returned', () => {
    registry.byUrl = { [ANALYTICS]: ok(emptyPayload) };
    wrapped(<EmailAnalyticsPage />);
    expect(screen.getByText('No tracking events yet')).toBeTruthy();
    expect(screen.getByText('Engagement Overview')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('keeps the last-read figures and rows on a refused refresh, with the caveat above them', () => {
    registry.byUrl = { [ANALYTICS]: staleRead(analyticsPayload) };
    wrapped(<EmailAnalyticsPage />);
    // the kept content survives
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('Recent Events')).toBeTruthy();
    expect(screen.getByText('ada@northwind.test')).toBeTruthy();
    // the banner names what a refused refresh hid
    expect(alerts()).toContain('Could not refresh email analytics');
    expect(alerts()).toContain('are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('Opens and clicks that happened since this was fetched are missing');
    // and does not pretend the read never answered
    expect(claimsOutsideAlerts(/Failed to load email analytics/)).toEqual([]);
    expect(alerts()).not.toContain('unanswered, not zero');
    // retry re-runs only this read
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ANALYTICS].refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the banner over an empty last read, and still calls it the last read', () => {
    registry.byUrl = { [ANALYTICS]: staleRead(emptyPayload) };
    wrapped(<EmailAnalyticsPage />);
    expect(screen.getByText('No tracking events yet')).toBeTruthy();
    expect(alerts()).toContain('are the last read');
    expect(alerts()).toContain('Request failed (504)');
  });

  it('a read that never answered is an outage: no absence sentence, no derived number', () => {
    registry.byUrl = { [ANALYTICS]: failed('Request failed (500)') };
    wrapped(<EmailAnalyticsPage />);
    expect(alerts()).toContain('Failed to load email analytics: Request failed (500)');
    expect(alerts()).toContain('unanswered, not zero');
    expect(alerts()).not.toMatch(/last read/i);
    // the false all-clear is unreachable outside the alert that retires it
    expect(claimsOutsideAlerts(/No tracking events yet/)).toEqual([]);
    // every figure derived from the failed read is withheld — no zero, no 0%
    expect(screen.queryByText('Total Tracked')).toBeNull();
    expect(screen.queryByText('Opens')).toBeNull();
    expect(screen.queryByText('Clicks')).toBeNull();
    expect(screen.queryByText('Open Rate')).toBeNull();
    expect(screen.queryByText('Engagement Overview')).toBeNull();
    expect(screen.queryByText('Recent Events')).toBeNull();
    expect(screen.queryByText('200')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('ada@northwind.test')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ANALYTICS].refetch).toHaveBeenCalledTimes(1);
  });

  it('a messageless refusal names the server, never undefined, on both arms', () => {
    registry.byUrl = { [ANALYTICS]: failed('') };
    wrapped(<EmailAnalyticsPage />);
    expect(alerts()).toContain('Failed to load email analytics: no response from the server');
    expect(alerts()).not.toMatch(/undefined|null/);

    registry.byUrl = { [ANALYTICS]: staleRead(analyticsPayload, '') };
    wrapped(<EmailAnalyticsPage />);
    expect(alerts()).toContain('are the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined|null/);
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('skeletonizes on the first load, with no alert and no figure', () => {
    registry.byUrl = { [ANALYTICS]: pending() };
    const { container } = wrapped(<EmailAnalyticsPage />);
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Email Analytics')).toBeNull();
    expect(screen.queryByText('Total Tracked')).toBeNull();
    expect(screen.queryByText('No tracking events yet')).toBeNull();
  });

  it('walks the walk: good read, refused refresh, good read again', () => {
    registry.byUrl = { [ANALYTICS]: ok(analyticsPayload) };
    const view = wrapped(<EmailAnalyticsPage />);
    expect(screen.getByText('200')).toBeTruthy();
    expect(alerts()).toBe('');

    registry.byUrl = { [ANALYTICS]: staleRead(analyticsPayload) };
    view.rerender(tree(<EmailAnalyticsPage />));
    expect(screen.getByText('200')).toBeTruthy();
    expect(alerts()).toContain('are the last read');

    registry.byUrl = { [ANALYTICS]: ok(analyticsPayload) };
    view.rerender(tree(<EmailAnalyticsPage />));
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/analytics/email/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the one read into the three states instead of ignoring its error', () => {
    const s = src();
    expect(s, 'the read still refuses to look at its own error or refetch')
      .toMatch(/const \{ data, isLoading: loading, error, refetch \} = useApiQuery/);
    expect(s).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(s).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(s, 'the outage arm does not stand where the rows/figures would have been').toMatch(/\{failed \? \(/);
    expect(s, 'kept figures carry no saying-they-are-the-last-read banner').toMatch(/\{stale && \(/);
  });

  it('waits for itself — no `isLoading ||` union across reads', () => {
    const s = src();
    expect(s, 'one read still skeletonized another under a loading union').not.toMatch(/isLoading\s*\|\|/);
  });

  it('puts the stale banner above the figures and rows it describes', () => {
    const s = src();
    const banner = s.indexOf('{stale && (');
    expect(banner, 'no stale banner').toBeGreaterThan(-1);
    // anchors that only exist in the RENDERED body (below the banner), not the `stats` array literal
    const firstFigure = Math.min(
      s.indexOf('{s.value}'),
      s.indexOf('Engagement Overview'),
      s.indexOf('Recent Events'),
    );
    expect(firstFigure, 'a rendered figure/row anchor is missing').toBeGreaterThan(-1);
    expect(banner, 'the stale banner sits below the derived content').toBeLessThan(firstFigure);
  });

  it('prints no server internals in the copy the page writes itself', () => {
    const s = src();
    const messages = s.match(/message=\{`[\s\S]*?`\}/g) ?? [];
    expect(messages.length, 'expected two banner message templates').toBe(2);
    for (const m of messages) {
      expect(m, 'a banner message names a source path').not.toMatch(/\/api\/|\.tsx|route\.ts|lib\/query/);
      expect(m, 'a banner message uses server vocabulary').not.toMatch(/\bendpoint\b|\broute\b|\bstatus code\b/i);
      expect(m, 'a banner message hard-codes a status code; only ${reason} is allowed').not.toMatch(/\(\d{3}\)/);
      expect(m, 'a banner message must interpolate the refusal as-is').toContain('${reason}');
    }
  });

  it('retries through the read, never the document or a cache poke', () => {
    const s = src();
    expect(s, 'a banner still reloads the whole document').not.toMatch(/location\.reload/);
    expect(s, 'a banner still invalidates instead of refetching').not.toMatch(/invalidateQueries/);
    expect(s.match(/onRetry=\{\(\) => void refetch\(\)\}/g)?.length, 'both banners retry their own read').toBe(2);
  });

  it('keeps #2829\'s guard blind to this class and the baseline untouched', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files, `${FILE} should never have been baselined`).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is invisible to the guard before and after each rewind to the base shape', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
    const rewinds: [RegExp, string][] = [
      [/\{failed \? \(/, '{false ? ('],
      [/\{stale && \(/, '{false && ('],
      [/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);\n/, ''],
    ];
    for (const [pattern, replacement] of rewinds) {
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `${FILE} became visible to the guard after the rewind: ${replacement}`,
      ).toBe(false);
    }
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
