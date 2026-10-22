// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/forms/[id]/analytics/page.tsx`, the one page in this epic that did not merely
 * mis-report a refused read, it *acted* on it:
 *
 * ```ts
 * useEffect(() => { if (error) router.push('/tenant/forms'); }, [error, router]);   // :74
 * ```
 *
 * TanStack Query keeps `data` when a refetch of a query that already answered fails
 * (`lib/query/client.tsx:51-53`: `staleTime: 30_000`, `retry: 2`, `refetchOnWindowFocus: false`), so
 * that effect fires on a refresh, not only on a first load. The operator reading 90-day analytics on
 * a form that had answered perfectly well one moment earlier was thrown back to `/tenant/forms` the
 * next, with the window they had picked (`7`/`30`/`90`/`365`, page state at `:66`) reset and nothing
 * on screen saying the read was refused. This is the epic's rule 1 — a failed read must not drive an
 * irreversible action — in its purest form here, because the action is navigation itself and the
 * thing destroyed is the read the page was holding.
 *
 * The same flag on a first load that never answered walks `if (loading)` → false, then
 * `if (!data) return null` (`:84`): the page renders *nothing* for the tick before the redirect, so
 * an outage and an empty answer were both "the page is not a page". `app/api/tenant/forms/[id]/analytics/route.ts:105,112`
 * reserves 404 for an id that matches no form of this tenant — an answer about this id — so that one
 * case gets an honest "Form not found" card; a 5xx, a 403 or a network refusal gets the outage card.
 * None of them navigates on its own any more: leaving is a click on the back link, never a side
 * effect of a flag.
 *
 * One read carries everything on this screen (`useApiQuery<` appears once, `:70`), so a single
 * refusal stales the name, both counters, the derived conversion rate, the whole time series and
 * every field's completion bar at once. There is no sibling query to retry by accident, and the
 * derived figure at risk is not a `0` but `(submissions / views) * 100` — which is why the stale
 * banner names the conversion rate and the per-field completion specifically.
 *
 * The honest zeros still have to survive: `:125` prints "No submissions in this period." for a
 * time series that genuinely came back empty, and `:147` withholds the Field Performance card for a
 * form with no fields. Both are answers, so both stay, and both must stay silent when the read was
 * refused rather than become an all-clear.
 *
 * RED AT BASE. Measured by running this file against the page exactly as it stands on the branch
 * point (`9c1f6e1f`, and identically on `5f53fe71`, where the page is byte-identical and this slice
 * was first written) in a clean tree: **17 failed | 9 passed (26)**. The seventeen are the eleven
 * states the flag could not express — ten of them live cases (the stale render with its banner and
 * its retry, the two specific-loss claims, the window picker surviving a refusal, the single-banner
 * union, the never-answered outage, its no-figures/no-window card, the 403, the outage staying put
 * instead of departing, and the 404 as an answer) and seven source ratchets (no navigation on the
 * flag, the three-state split, the gate order before `!data`, the shared banner component, no reload
 * or cache poke, `${reason}` rather than the Error, and one durable channel instead of the effect).
 * The nine that pass at base are the behaviour this fix must not regress: the kept read that already
 * rendered its counters, the answered zero time series, the honestly withheld Field Performance
 * card, the clean-read freshness silence, the zero-submission answered body, the first-load spinner,
 * the single-read pin, the line ceiling, and the hygiene check that no other suite mounts this page.
 *
 * Fixtures are documentation-only (RFC 2606 .test names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
const pushSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
// The page toasts for its writes only; an error STATE must not be satisfiable from a fading toast,
// so every assertion below reads role="alert" inside the page instead.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'form-9' }),
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/forms/form-9/analytics',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub,
    Cell: Stub, Legend: Stub, AreaChart: Stub, Area: Stub,
  };
});

import toast from 'react-hot-toast';
import FormAnalyticsPage from '@/app/tenant/forms/[id]/analytics/page';

const PAGE = 'app/tenant/forms/[id]/analytics/page.tsx';
const A30 = '/api/tenant/forms/form-9/analytics?days=30';
const A7 = '/api/tenant/forms/form-9/analytics?days=7';

const analytics = {
  name: 'Enterprise demo request',
  views: 1240,
  submissions: 87,
  timeSeries: [
    { date: '2026-10-01', count: 3 },
    { date: '2026-10-02', count: 5 },
  ],
  fields: [
    { key: 'company', label: 'Company', type: 'text', total: 87, filled: 80, completionRate: 92 },
    { key: 'seats', label: 'Seats', type: 'number', total: 87, filled: 44, completionRate: 51, numericStats: { min: 1, max: 500, avg: 42 } },
    { key: 'plan', label: 'Plan', type: 'select', total: 87, filled: 61, completionRate: 70, valueDistribution: [{ value: 'Growth', count: 40 }] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const broken = (message = 'Request failed (500)', status?: number): QueryResult => {
  const error = Object.assign(new Error(message), status === undefined ? {} : { status });
  return { data: undefined, error, isLoading: false, refetch: vi.fn() };
};
/** The state the page could not tell apart from an outage: a kept read and a refused refresh. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** What the route really answers for an id that matches no form of this tenant (`route.ts:112`). */
const gone = (): QueryResult => broken('Request failed (404)', 404);

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(node);
};

const srcOf = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

beforeEach(() => {
  registry.byUrl = {};
  pushSpy.mockClear();
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); });

describe('form analytics: a refused refresh does not throw the operator off the record (#2872)', () => {
  const OUTAGE = /Failed to load this form's analytics/;
  const CAVEAT = /the figures below are the last read/;

  it('keeps every figure the read answered and calls them the last read', () => {
    const result = staleRead(analytics);
    registry.byUrl = { [A30]: result };
    wrapped(<FormAnalyticsPage />);
    expect(screen.getByText('Enterprise demo request')).toBeTruthy();
    expect(screen.getByText('10-02')).toBeTruthy();
    expect(alerts()).toContain('the figures below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toMatch(OUTAGE);
    // The redirect this page used to run on `error` is the whole defect: a refresh that had a good
    // answer on screen threw the window selection away with it.
    expect(pushSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the specific loss: a submission that arrived after the read, and the derived rate', () => {
    registry.byUrl = { [A30]: staleRead(analytics) };
    wrapped(<FormAnalyticsPage />);
    expect(alerts()).toMatch(/A submission that arrived since that read is missing here/);
    expect(alerts()).toMatch(/conversion rate/);
    expect(alerts()).toMatch(/per-field completion/);
  });

  it('the kept read is still the whole screen — counters, derived rate, series and field cards', () => {
    registry.byUrl = { [A30]: staleRead(analytics) };
    wrapped(<FormAnalyticsPage />);
    expect(screen.getByText('Total views').parentElement?.textContent).toContain('1,240');
    expect(screen.getByText('Submissions').parentElement?.textContent).toContain('87');
    expect(screen.getByText('Conversion rate').parentElement?.textContent).toContain('7.0%');
    expect(screen.getByText('Company')).toBeTruthy();
    expect(screen.getByText('Field Performance')).toBeTruthy();
    expect(screen.queryByText('Form not found')).toBeNull();
  });

  it('the window picker keeps working over a stale read and re-reads under the new key', () => {
    const lastWeek = ok({ ...analytics, name: 'Enterprise demo request', views: 90, submissions: 4, timeSeries: [] });
    registry.byUrl = { [A30]: staleRead(analytics), [A7]: lastWeek };
    wrapped(<FormAnalyticsPage />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '7' } });
    // The days window is part of the query key (`:71`), so switching is a fresh read — and a refused
    // one of those must still not navigate.
    expect(pushSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Total views').parentElement?.textContent).toContain('90');
  });

  it('one stale read raises exactly one banner — no second outage card below it', () => {
    registry.byUrl = { [A30]: staleRead(analytics) };
    wrapped(<FormAnalyticsPage />);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).not.toMatch(OUTAGE);
  });

  it('a refresh that never had anything to keep says so, and does not pretend the form is gone', () => {
    registry.byUrl = { [A30]: broken('Request failed (500)') };
    wrapped(<FormAnalyticsPage />);
    expect(alerts()).toContain('Failed to load this form\'s analytics: Request failed (500)');
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('Form not found')).toBeNull();
    expect(screen.queryByText('Enterprise demo request')).toBeNull();
    expect(document.body.textContent).not.toMatch(/No submissions in this period/);
    expect(pushSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[A30].refetch).toHaveBeenCalledTimes(1);
  });

  it('the outage offers no window to switch and no figure to read', () => {
    registry.byUrl = { [A30]: broken('Request failed (502)') };
    wrapped(<FormAnalyticsPage />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/1,240|1,240%|\d+\.\d%/);
    expect(screen.getByText(/Back to forms/i)).toBeTruthy();
  });

  it('a 403 refusal is an outage, not a statement that this form has no submissions', () => {
    registry.byUrl = { [A30]: broken('Request failed (403)') };
    wrapped(<FormAnalyticsPage />);
    expect(alerts()).toContain('Failed to load this form\'s analytics: Request failed (403)');
    expect(alerts()).toMatch(/not a statement that the form has no submissions/);
    expect(screen.queryByText('No submissions in this period.')).toBeNull();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('the outage is a card that stays, not a toast and not a departure', async () => {
    registry.byUrl = { [A30]: broken('Request failed (500)') };
    wrapped(<FormAnalyticsPage />);
    expect(alerts()).toMatch(OUTAGE);
    expect(toast.error).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('a 404 for this id is the server answering the question: not found, with no alert', () => {
    registry.byUrl = { [A30]: gone() };
    wrapped(<FormAnalyticsPage />);
    expect(screen.getByText('Form not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Failed to load this form/);
    expect(document.body.textContent).not.toMatch(/last read/);
  });

  it('the not-found card leaves by the link the operator clicks, not by a flag', () => {
    registry.byUrl = { [A30]: gone() };
    wrapped(<FormAnalyticsPage />);
    const back = screen.getByText(/Back to forms/i).closest('a');
    expect(back?.getAttribute('href')).toBe('/tenant/forms');
  });
});

describe('form analytics: what a refused read may never claim (#2872 controls)', () => {
  it('a clean read says nothing about freshness', () => {
    registry.byUrl = { [A30]: ok(analytics) };
    wrapped(<FormAnalyticsPage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('Enterprise demo request')).toBeTruthy();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('an empty time series that really was answered still says "No submissions in this period."', () => {
    registry.byUrl = { [A30]: ok({ ...analytics, timeSeries: [] }) };
    wrapped(<FormAnalyticsPage />);
    expect(screen.getByText('No submissions in this period.')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a form with no fields still withholds the Field Performance card honestly', () => {
    registry.byUrl = { [A30]: ok({ ...analytics, fields: [] }) };
    wrapped(<FormAnalyticsPage />);
    expect(screen.queryByText('Field Performance')).toBeNull();
    expect(alerts()).toBe('');
  });

  it('the first load is a spinner, not an outage card and not a blank page', () => {
    registry.byUrl = { [A30]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    const { container } = wrapped(<FormAnalyticsPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('a zero-submission form with a real body is an answered zero, not an outage', () => {
    registry.byUrl = {
      [A30]: ok({ name: 'Enterprise demo request', views: 0, submissions: 0, timeSeries: [], fields: [] }),
    };
    wrapped(<FormAnalyticsPage />);
    expect(screen.getByText('Conversion rate').parentElement?.textContent).toContain('0.0%');
    expect(screen.getByText('No submissions in this period.')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('form analytics: source ratchets', () => {
  it('never navigates on the read flag — the effect that did is gone, router.push is not used', () => {
    const src = srcOf(PAGE);
    expect(src).not.toMatch(/if \(error\)[\s\S]{0,120}router\.push/);
    expect(src).not.toMatch(/failed[\s\S]{0,120}router\.push/);
    expect(src).not.toMatch(/router\.push/);
    // Nothing left to navigate with: the page keeps useParams for the id and drops the router.
    expect(src).not.toMatch(/useRouter/);
  });

  it('binds the three-state split in the house shape, and keeps the fourth arm for a 404', () => {
    const src = srcOf(PAGE);
    expect(src).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(src).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(src).toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
    expect(src).toMatch(/const notFound = failed && error\?\.status === 404;/);
  });

  it('the outage gate runs before the `!data` fallthrough, so a never-answered read cannot render null', () => {
    const src = srcOf(PAGE);
    const failedAt = src.search(/if \(failed && !notFound\)/);
    const nullAt = src.search(/if \(!data\) return null/);
    expect(failedAt).toBeGreaterThan(-1);
    expect(nullAt).toBeGreaterThan(-1);
    expect(failedAt).toBeLessThan(nullAt);
  });

  it('reads failure through the shared banner component, not bespoke markup', () => {
    const src = srcOf(PAGE);
    expect(src).toMatch(/import InlineErrorState from '@\/components\/shared\/inline-error-state';/);
    expect(src).toMatch(/<InlineErrorState/);
    expect(src).not.toMatch(/role="alert"/);
  });

  it('no reload, no cache poke, no second refresh channel — the banner retries this read', () => {
    const src = srcOf(PAGE);
    expect(src).not.toMatch(/location\.reload|invalidateQueries|refetchOnWindowFocus|setInterval/);
    expect(src.match(/onRetry=\{refetch\}/g)).toHaveLength(2);
  });

  it('prints the reason, never the Error object or its stack', () => {
    const src = srcOf(PAGE);
    expect(src).toMatch(/\$\{reason\}/);
    expect(src).not.toMatch(/String\(error\)|error\.stack|\{error\}/);
  });

  it('one read feeds the whole page, so one refusal is stale for all of it', () => {
    const src = srcOf(PAGE);
    expect(src.match(/useApiQuery</g)).toHaveLength(1);
  });

  it('the read failure has one durable channel: never the effect that navigated, never a toast', () => {
    const src = srcOf(PAGE);
    expect(src).not.toMatch(/useEffect\(\(\) => \{ if \(error\)/);
    // This page never had a toast to lean on — the redirect WAS its only failure surface, which is
    // why the fix has to add a banner rather than move the flag to another transient channel.
    expect(src).not.toMatch(/toast\.error\(/);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(res.stdout + res.stderr).toContain('OK');
    expect(res.status).toBe(0);
    expect(srcOf(PAGE).split('\n').length).toBeLessThan(500);
  });

  it('no other suite mounts this page, so this file owns its behaviour', () => {
    const res = spawnSync('grep', ['-rlF', 'forms/[id]/analytics/page', 'tests/unit'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    const files = (res.stdout ?? '').trim().split('\n').filter(Boolean);
    expect(files).toEqual(['tests/unit/panel-page-error-not-empty-forms-analytics-stale-2872.test.tsx']);
  });
});
