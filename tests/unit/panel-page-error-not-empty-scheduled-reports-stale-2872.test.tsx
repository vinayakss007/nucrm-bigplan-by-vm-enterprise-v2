// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/reports/scheduled/page.tsx`, the fifth `reports/*` panel.
 *
 * #2829 converted the other four and left this one alone, so it still had exactly one failure
 * channel and it was `if (error) toast.error('Failed to load')` in the RENDER BODY: a toast that
 * re-fires on every render, erases itself after four seconds, and leaves the panel underneath
 * answering a permanent refusal with "No scheduled reports / Create a schedule to automate report
 * delivery". On this page that sentence is the dangerous one — the reason anyone opens a schedule
 * list is to check whether a report is due, and a read that never answered told them it wasn't.
 *
 * The other half is why #2872 is a separate epic. `load()` invalidates `SCHEDULED_QUERY`, which is
 * the key this very read is cached under, and pause, delete and create all call `load()` on
 * success. TanStack Query keeps `data` when a refetch of an already-succeeded query fails, so the
 * state right after the operator pressed pause is "rows on screen, refresh refused" — which a
 * branch on the bare flag reports as an outage, minus the list that would have proved the pause
 * landed.
 *
 * `failed = Boolean(error) && !data` keeps the outage banner; `stale = Boolean(error) && data`
 * keeps the schedules and says they are the last read.
 *
 * The #2829 screen cannot see this page in either direction: its empty-sentence vocabulary is
 * `No … yet|found|here|configured|recorded|logged|sent|match`, and "No scheduled reports" is not
 * in it, so `check-panel-error-state.mjs` scored zero false-empty statements here even at base.
 * The cases that rewind the split (see the last describe) are what proves no guard covers this
 * class and that this file is the only screen on it.
 *
 * RED AT BASE. With this file as committed and the page at `ae866c07`: 9 of the 15 cases fail — the
 * four that put the panel in the stale state (kept rows, refused refresh, one of them over an empty
 * answer), the three that ask a refused read for a durable on-page state, and the two source cases
 * that pin the split and the removal of the render-body toast. The other 6 pass at base and must
 * keep passing: the two #2829 controls (a good read, a genuine zero), the pause button's own
 * revalidation both at runtime and in source, and the three that prove the #2829 guard could never
 * have seen this page — including the case that keeps this fix off the baseline.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
// The mutations still toast — an action deserves transient feedback, a page state does not. The
// mock exists so the module imports cleanly, NOT so a case can assert on it: the read's failure is
// proven below without touching `toast.error` once.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import ScheduledReportsPage from '@/app/tenant/reports/scheduled/page';

const PAGE = 'app/tenant/reports/scheduled/page.tsx';
const SCHEDULED = '/api/tenant/reports/scheduled';
const SCHEDULED_KEY = ['tenant', 'reports', 'scheduled'];

// `recipients` is only ever rendered as a tally, so the fixture carries opaque ids rather than
// anything that looks like a live mailbox.
const schedules = {
  data: [
    {
      id: 'sch-1', name: 'Weekly contacts digest', type: 'contacts', frequency: 'weekly',
      recipients: ['r-1', 'r-2'], nextRunAt: '2026-11-04T09:00:00Z', status: 'active',
    },
    {
      id: 'sch-2', name: 'Monthly deals summary', type: 'summary', frequency: 'monthly',
      recipients: [], nextRunAt: null, status: 'paused',
    },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the schedules are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode, client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** Row one's first button is the active/paused toggle, its second the delete. */
const toggleOf = (name: string) =>
  within(screen.getByText(name).closest('.admin-card') as HTMLElement).getAllByRole('button')[0];

describe('scheduled reports: a refused refresh keeps the schedules (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the schedules on screen and names them the last read', () => {
    registry.byUrl = { [SCHEDULED]: staleRead(schedules) };
    wrapped(<ScheduledReportsPage />);
    expect(screen.getByText('Weekly contacts digest')).toBeTruthy();
    expect(screen.getByText('Monthly deals summary')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh');
    expect(alerts()).toContain('the schedules below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be a lie: both schedules are on the screen.
    expect(screen.queryByText(/Failed to load scheduled reports/)).toBeNull();
    // …and so would "No scheduled reports", which is what the page used to say.
    expect(screen.queryByText('No scheduled reports')).toBeNull();
  });

  it('the stale caveat retries exactly the read it is talking about', () => {
    const result = staleRead(schedules);
    registry.byUrl = { [SCHEDULED]: result };
    wrapped(<ScheduledReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an outage banner is retried too, and never becomes an empty panel', () => {
    const result = failed('Request failed (500)');
    registry.byUrl = { [SCHEDULED]: result };
    wrapped(<ScheduledReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a read that never answered is an outage, and not "No scheduled reports"', () => {
    registry.byUrl = { [SCHEDULED]: failed('Request failed (500)') };
    wrapped(<ScheduledReportsPage />);
    expect(alerts()).toContain('Failed to load scheduled reports');
    expect(alerts()).toContain('Request failed (500)');
    // Both halves of the false all-clear have to go: the headline and the instruction under it.
    expect(screen.queryByText('No scheduled reports')).toBeNull();
    expect(screen.queryByText(/Create a schedule to automate report delivery/)).toBeNull();
    // Nothing about refreshing — there is no read on screen to be stale.
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('a genuine empty answer still says so, with no alert above it', () => {
    registry.byUrl = { [SCHEDULED]: ok({ data: [] }) };
    wrapped(<ScheduledReportsPage />);
    expect(screen.getByText('No scheduled reports')).toBeTruthy();
    expect(screen.getByText(/Create a schedule to automate report delivery/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused refresh over an empty answer says none, and says it may not be the whole story', () => {
    // `data` is `{data: []}` — read, empty, kept. The sentence is true and the caveat is still owed.
    registry.byUrl = { [SCHEDULED]: staleRead({ data: [] }) };
    wrapped(<ScheduledReportsPage />);
    expect(screen.getByText('No scheduled reports')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/Failed to load scheduled reports/)).toBeNull();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [SCHEDULED]: ok(schedules) };
    wrapped(<ScheduledReportsPage />);
    expect(screen.getByText('Weekly contacts digest')).toBeTruthy();
    expect(screen.getByText('2 recipient(s)')).toBeTruthy();
    expect(screen.getByText('0 recipient(s)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the failure outlives the renders that used to re-fire a four-second toast', () => {
    // No `react-hot-toast` assertion in this case, on purpose: the channel being replaced is the
    // proof. The old code called `toast.error` from the render body, so its visibility depended on
    // when you looked; a `role="alert"` in the panel does not.
    registry.byUrl = { [SCHEDULED]: failed('Request failed (503)') };
    const view = wrapped(<ScheduledReportsPage />);
    const first = alerts();
    expect(first).toContain('Failed to load scheduled reports');
    expect(first).toContain('Request failed (503)');
    for (let i = 0; i < 4; i++) view.rerender(tree(<ScheduledReportsPage />));
    expect(alerts()).toBe(first);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('counts what it holds, and quotes no tally it never read', () => {
    // This page derives two numbers per row — the recipient tally and the next-run date — and both
    // are the read's own values, so under a refused refresh they are real and must stay.
    registry.byUrl = { [SCHEDULED]: staleRead(schedules) };
    wrapped(<ScheduledReportsPage />);
    expect(screen.getByText('2 recipient(s)')).toBeTruthy();
    expect(screen.getAllByText(/Next:/)).toHaveLength(1);

    // Under an outage there is nothing to count: the rows are gone, so no number may be quoted and
    // the panel has to say why it is silent instead of printing its empty sentence.
    cleanup();
    registry.byUrl = { [SCHEDULED]: failed('Request failed (500)') };
    wrapped(<ScheduledReportsPage />);
    expect(screen.queryByText(/recipient\(s\)/)).toBeNull();
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(alerts()).toContain('Failed to load scheduled reports');
  });

  it('the pause button revalidates this very read, which is where the stale state comes from', async () => {
    // WHY the stale state is ordinary rather than exotic: `load()` invalidates `SCHEDULED_QUERY`,
    // the key the list is cached under, and toggling status calls it on success.
    registry.byUrl = { [SCHEDULED]: ok(schedules) };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');
    cleanup();
    render(tree(<ScheduledReportsPage />, client));
    fireEvent.click(toggleOf('Weekly contacts digest'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual({ queryKey: SCHEDULED_KEY });
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const src = () => readFileSync(join(ROOT, PAGE), 'utf8');
  // #2829's screen, loaded the way `vitest.config.ts` needs under jsdom: an absolute file:// URL.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let guard: any;

  beforeAll(async () => {
    guard = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
  });

  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('splits the two states apart, and drops the self-erasing channel', () => {
    const s = src();
    expect(s).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(s).toMatch(/\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\bfailed \?/);
    expect(s).toMatch(/onRetry=\{refetch\}/);
    // A state that erases itself after four seconds is not a page state.
    expect(s).not.toMatch(/^ {2}if \(error\) toast\.error/m);
    expect(s).not.toMatch(/error \? \(/);
    expect(s).not.toMatch(/\w*[Ee]rror \? '—'/);
  });

  it('names the invalidation that makes a refused refresh the normal case', () => {
    // Read and revalidation have to share a constant, or the caveat above is a coincidence.
    const s = src();
    expect(s).toMatch(/const SCHEDULED_QUERY = \['tenant', 'reports', 'scheduled'\] as const;/);
    expect(s).toMatch(/invalidateQueries\(\{ queryKey: SCHEDULED_QUERY \}\)/);
    expect(s).toMatch(/useApiQuery<\{ data\?: ScheduledReport\[\] \}>\(\s*SCHEDULED_QUERY,/);
    expect(s.match(/\bload\(\);/g)).toHaveLength(3);
  });

  it('is not something the #2829 guard could have caught at all', () => {
    // "No scheduled reports" is outside the guard's empty-sentence vocabulary, so it scored this
    // page clean before the fix and scores it clean after — the screen here is this file.
    expect(guard.EMPTY_SENTENCE.test('No scheduled reports')).toBe(false);
    expect(guard.EMPTY_SENTENCE.test('No scheduled reports yet')).toBe(true);
    const base = 'const { data, error } = useApiQuery(k, url);\n'
      + 'if (error) toast.error(\'Failed to load\');\n'
      + '{reports.length === 0 ? (<p>No scheduled reports</p>) : rows}\n';
    expect(guard.inspect(PAGE, base).offends).toBe(false);
    expect(guard.inspect(PAGE, src()).offends).toBe(false);
  });

  it('rewinding the split keeps the guard green, which is the point of #2872', () => {
    const bare = src()
      .replace(/\n\s*\{\s*stale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
      .replace(/const stale = [^\n]*\n/g, '')
      .replace(/\bfailed \?/g, 'errorFlag ?')
      .replace(/const failed = [^\n]*\n/g, '');
    expect(bare).not.toBe(src());
    expect(guard.inspect(PAGE, bare).offends).toBe(false);
  });

  it('keeps the #2829 guard and the line ceiling green without a baseline entry', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, not a count — pinning the number is what #2858, #2865 and #2866 each had to undo.
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files, 'this fix must not be paid for with a baseline entry').not.toContain(PAGE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    const size = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(size.status, size.stdout + size.stderr).toBe(0);
    const lines = src().split('\n').length - 1;
    expect(lines, `${PAGE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
  });
});
