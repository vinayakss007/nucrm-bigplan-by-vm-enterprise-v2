// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/forms/page.tsx` and `app/tenant/reports/page.tsx`.
 *
 * Both pages were given a failure channel by #2829 and both still answer a
 * *revalidation* with the wrong thing, because TanStack Query keeps `data` when a
 * refetch of a read that already succeeded fails. Branching on the flag alone makes
 * "answered, then refused" indistinguishable from "never answered".
 *
 * `forms` has two reads and its own trigger: every mutation — create, publish/unpublish,
 * delete — calls `reload()`, which invalidates the prefix `['tenant','forms']`. That
 * prefix matches the paged list (`['tenant','forms',{offset}]`) *and* the open
 * submissions drawer (`['tenant','forms','submissions',id]`), so the action that just
 * changed the data revalidates both reads, and a refused revalidation replaced the forms
 * the operator can see with "Failed to load your forms" — or emptied a drawer of the
 * leads someone is chasing, with only the outage card's retry left. `offset` is in the
 * list key, so a page that has never answered is `failed`, not a last read of the page
 * before it.
 *
 * `reports` is the same bug pointed the other way. It already keeps its rows (the banner
 * branch needs `!results.length`), but the ONLY thing that says the refresh failed is a
 * toast fired once and auto-dismissed in about four seconds — so the panel goes on
 * claiming "43 records · Last 30 days" over numbers that are as old as the last
 * successful run, and nothing on screen can be re-tried. The `records` figure is the one
 * number that must dash: on a read that never answered there is no count to print.
 *
 * The split is the house shape: `failed` keeps #2829's outage card, `stale` keeps what is
 * on screen and says it is the last read, and every derived figure keys off `failed`.
 *
 * RED AT BASE: measured on `ae866c07` with the two product files as committed there and
 * this file as written here — see the PR. Controls keep the never-answered half, the real
 * zeros, and per-read retries exactly as #2829 left them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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
  // `reports` keeps the whole result object and reads `isFetching` / `isError` off it,
  // which is what `useQuery` returns; the rest of the pages destructure.
  useApiQuery: (_key: unknown, url: string) => {
    const r = registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() };
    return { ...r, isFetching: false, isError: Boolean(r.error) };
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import FormsPage from '@/app/tenant/forms/page';
import ReportsPage from '@/app/tenant/reports/page';

const NOW = '2026-10-01T00:00:00Z';
const FORMS = '/api/tenant/forms?limit=20&offset=0';
const FORM_SUBS = '/api/tenant/forms/fm-1';
const REPORT = '/api/tenant/reports?type=contacts&days=30';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state the bare flag cannot express: it answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const formRows = {
  data: [
    { id: 'fm-1', name: 'Website enquiry', is_active: true, views_count: 41, submissions_count: 7, fields: [] },
    { id: 'fm-2', name: 'Demo booking', is_active: false, views_count: 8, submissions_count: 2, fields: [] },
  ],
  total: 2,
};
const submissionRows = {
  data: {
    submissions: [
      { id: 's1', first_name: 'Iman', last_name: 'Reyes', contact_email: 'iman@acme.test', data: { email: 'iman@acme.test' }, created_at: NOW },
      { id: 's2', first_name: 'Theo', last_name: ' Park', contact_email: 'theo@bolt.test', data: { email: 'theo@bolt.test' }, created_at: NOW },
    ],
  },
};
const reportRows = {
  data: [
    { name: 'Ada Operator', deals_won: 2, source: 'web' },
    { name: 'Bo Operator', deals_won: 5, source: 'referral' },
  ],
};

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** The alert that speaks about a refresh, as opposed to the one that says never answered. */
const staleAlert = () => {
  const found = screen.queryAllByRole('alert').filter((el) => /last read/i.test(el.textContent ?? ''));
  expect(found.length, `expected exactly one last-read alert, saw: ${alerts()}`).toBe(1);
  return found[0];
};

const openDrawer = () => {
  wrapped(<FormsPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /submissions/i })[0]);
};
const runReport = () => {
  wrapped(<ReportsPage />);
  fireEvent.click(screen.getByRole('button', { name: /run report/i }));
};

describe('forms: a refused refresh of the list keeps the forms it had read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('keeps both rows on screen and says they are the last read', () => {
    registry.byUrl = { [FORMS]: staleRead(formRows) };
    wrapped(<FormsPage />);
    expect(screen.getByText('Website enquiry', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Demo booking', { selector: 'p' })).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The outage copy would tell them to go and re-find forms that are in front of them.
    expect(alerts()).not.toMatch(/nothing to show|Failed to load your forms/i);
  });

  it('re-runs the list read from the caveat, not some sibling', () => {
    registry.byUrl = { [FORMS]: staleRead(formRows) };
    wrapped(<FormsPage />);
    fireEvent.click(within(staleAlert()).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[FORMS].refetch).toHaveBeenCalled();
  });

  it('keeps the drawer open on the leads it had read when the refresh is refused', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: staleRead(submissionRows, 'Request failed (500)') };
    openDrawer();
    expect(screen.getByText(/Iman/)).toBeTruthy();
    expect(screen.getByText(/Theo/)).toBeTruthy();
    expect(staleAlert().textContent).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/No submissions yet/i);
  });

  it('gives the drawer caveat its own retry, aimed at the submissions read', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: staleRead(submissionRows) };
    openDrawer();
    fireEvent.click(within(staleAlert()).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[FORM_SUBS].refetch).toHaveBeenCalled();
    expect(registry.byUrl[FORMS].refetch).not.toHaveBeenCalled();
  });

  it('says the list is the last read even when the answer was empty', () => {
    registry.byUrl = { [FORMS]: staleRead({ data: [], total: 0 }) };
    wrapped(<FormsPage />);
    expect(screen.getByText('No forms yet')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('says the drawer is empty even when the answer was empty', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: staleRead({ data: { submissions: [] } }) };
    openDrawer();
    expect(screen.getByText('No submissions yet')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('forms: the never-answered half stays exactly as #2829 left it', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('banners instead of claiming there are no forms', () => {
    registry.byUrl = { [FORMS]: failed('Request failed (500)') };
    wrapped(<FormsPage />);
    expect(alerts()).toMatch(/Failed to load your forms: Request failed \(500\)/);
    expect(screen.queryByText('No forms yet')).toBeNull();
    expect(screen.queryByRole('button', { name: /build first form/i })).toBeNull();
    expect(screen.queryByText(/last read/i)).toBeNull();
  });

  it('banners inside the drawer and leaves the list beside it alone', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: failed('Request failed (500)') };
    openDrawer();
    expect(alerts()).toMatch(/Failed to load this form's submissions: Request failed \(500\)/);
    expect(screen.queryByText('No submissions yet')).toBeNull();
    expect(screen.getByText('Website enquiry', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText(/last read/i)).toBeNull();
  });

  it('quotes "no response from the server" for a refusal with no message', () => {
    registry.byUrl = { [FORMS]: failed('') };
    wrapped(<FormsPage />);
    expect(alerts()).toMatch(/no response from the server/);
  });

  it('keeps a real zero a real zero, with no alert', () => {
    registry.byUrl = { [FORMS]: ok({ data: [], total: 0 }) };
    wrapped(<FormsPage />);
    expect(screen.getByText('No forms yet')).toBeTruthy();
    expect(screen.getByText('Build a lead capture form and embed it on any website in seconds')).toBeTruthy();
    expect(alerts()).toBe('');

    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: ok({ data: { submissions: [] } }) };
    openDrawer();
    expect(screen.getByText('No submissions yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('renders both reads plainly when both answered', () => {
    registry.byUrl = { [FORMS]: ok(formRows), [FORM_SUBS]: ok(submissionRows) };
    openDrawer();
    expect(screen.getByText(/Iman/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('reports: a refused refresh says the figures are the last read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the rows and puts the caveat on the page, where it does not fade', () => {
    registry.byUrl = { [REPORT]: staleRead(reportRows) };
    runReport();
    expect(screen.getByText(/Ada Operator/)).toBeTruthy();
    expect(staleAlert().textContent).toMatch(/last read/i);
    expect(staleAlert().textContent).toMatch(/Request failed \(504\)/);
    // The outage copy would announce a report that ran as one that did not.
    expect(alerts()).not.toMatch(/did not run/i);
  });

  it('re-runs the report from the caveat', () => {
    registry.byUrl = { [REPORT]: staleRead(reportRows) };
    runReport();
    fireEvent.click(within(staleAlert()).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[REPORT].refetch).toHaveBeenCalled();
  });

  it('dashes the record count when the read never answered, and does not claim zero', () => {
    registry.byUrl = { [REPORT]: failed('Request failed (500)') };
    runReport();
    expect(screen.getByText(/^— records/, { selector: 'p' })).toBeTruthy();
    expect(alerts()).toMatch(/This report did not run.*Request failed \(500\)/s);
    expect(screen.queryByText('No data found for this period')).toBeNull();
    expect(screen.queryByText(/last read/i)).toBeNull();
  });

  it('keeps a genuinely empty report empty, with no alert and a real zero', () => {
    registry.byUrl = { [REPORT]: ok({ data: [] }) };
    runReport();
    expect(screen.getByText('No data found for this period')).toBeTruthy();
    expect(screen.getByText(/^0 records/, { selector: 'p' })).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('treats a refused refresh of an empty answer as still empty, plus the caveat', () => {
    registry.byUrl = { [REPORT]: staleRead({ data: [] }) };
    runReport();
    expect(screen.getByText('No data found for this period')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/did not run/i);
  });

  it('quotes the reason when the refusal arrives with no message', () => {
    registry.byUrl = { [REPORT]: { data: reportRows, error: Object.assign(new Error(), { name: 'ApiQueryError' }), isLoading: false, refetch: vi.fn() } };
    runReport();
    expect(alerts()).toMatch(/no response from the server/);
  });

  it('renders the report plainly when the refresh succeeded', () => {
    registry.byUrl = { [REPORT]: ok(reportRows) };
    runReport();
    expect(screen.getByText(/Ada Operator/)).toBeTruthy();
    expect(screen.getByText(/^2 records/, { selector: 'p' })).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the guard cannot see either page, so this suite is what does (#2872)', () => {
  const ROOT = process.cwd();

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, not a count: the list is empty since #2829's last slice, and every
    // follow-on deletes from it rather than memorising how many are left.
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files).not.toContain('app/tenant/forms/page.tsx');
    expect(files).not.toContain('app/tenant/reports/page.tsx');
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('reports each page clean with the split taken back out, which is the blindness', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: Array<[string, RegExp, string]> = [
      ['app/tenant/forms/page.tsx', /const formsFailed = Boolean\(formsError\) && !data;/, 'const formsFailed = Boolean(formsError);'],
      ['app/tenant/reports/page.tsx', /const reportFailed = Boolean\(reportQuery\.error\) && !reportQuery\.data;/, 'const reportFailed = Boolean(reportQuery.error);'],
    ];
    for (const [file, pattern, swap] of rewinds) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `the shape this slice depends on moved in ${file}`).toMatch(pattern);
      const stripped = src.replace(pattern, swap);
      expect(stripped).not.toBe(src);
      expect(inspect(file, src).offends, `${file} was already on the screen's list`).toBe(false);
      expect(inspect(file, stripped).offends, 'the guard would catch this one after all').toBe(false);
    }
  });

  it('binds the two states apart instead of reading one flag', () => {
    const forms = readFileSync(join(ROOT, 'app/tenant/forms/page.tsx'), 'utf8');
    expect(forms).toMatch(/Boolean\(formsError\) && !data/);
    expect(forms).toMatch(/Boolean\(formsError\) && Boolean\(data\)/);
    expect(forms).toMatch(/Boolean\(submissionsError\) && !submissionsData/);
    expect(forms).toMatch(/Boolean\(submissionsError\) && Boolean\(submissionsData\)/);
    expect(forms, 'a bare flag in a render branch is the bug').not.toMatch(/\{formsError \? \(/);
    expect(forms).not.toMatch(/\{submissionsError \? \(/);

    const reports = readFileSync(join(ROOT, 'app/tenant/reports/page.tsx'), 'utf8');
    expect(reports).toMatch(/Boolean\(reportQuery\.error\) && !reportQuery\.data/);
    expect(reports).toMatch(/Boolean\(reportQuery\.error\) && Boolean\(reportQuery\.data\)/);
    expect(reports, 'the outage branch must key off never-answered, not off no-rows').not.toMatch(/!results\.length && reportQuery\.isError/);
    expect(reports).toMatch(/reportFailed \? '—' : results\.length/);
  });

  it('does not overlap the suites that own the never-answered half', () => {
    const comms = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-comms-2829.test.tsx'), 'utf8');
    expect(comms, 'the comms suite now speaks about a kept read too').not.toMatch(/last read/);
    expect(comms).toMatch(/No forms yet/);
    // `object-2829` owns this page's outage branch. It used to pin the stale state as
    // "rows kept, no alert at all" — which is this slice's bug, not a guarantee. The one
    // case that asserted it now points here instead, and still owns the copy #2829 added.
    const object = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-object-2829.test.tsx'), 'utf8');
    expect(object).toMatch(/This report did not run/);
    expect(object, '#2872 owns the reports stale state — say so where the case lives').toMatch(/forms-reports-stale-2872/);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
