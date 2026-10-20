// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the four `app/tenant/reports/*` panels.
 *
 * `panel-page-error-not-empty-reports-2829` gave these pages a failure channel: bind `error`,
 * render `InlineErrorState`, stop answering a refused read with "No deals for this period yet."
 * That half is correct and stays. This slice is the other half, which #2829 never asked about —
 * the read that *did* answer, and then failed to answer again.
 *
 * TanStack Query keeps `data` when a refetch of an already-succeeded query fails. All four pages
 * branched on the flag alone:
 *
 *     : error ? (<InlineErrorState …/>) : rows
 *
 * so the ordinary state after the page's own action renders as an outage. `funnel` and
 * `team-performance` both take it from the Refresh button the user presses to see fresh numbers;
 * `saved` takes it from `reload()`, which both delete and run call — so deleting a report and
 * having the refetch refused produced "Failed to load saved reports" with the list gone, and no
 * way to tell whether the delete worked; `custom` invalidates its saved-reports read when the
 * operator saves a report, and its header button then counted `—` over a list it was still
 * showing. That last one is the case #2872 exists for: `savedError ? '—' : n` is correct-looking
 * code, invisible to a guard that only asks whether an error reaches the screen.
 *
 * Per page: `failed = Boolean(err) && !data` keeps the banner #2829 added; `stale =
 * Boolean(err) && data` keeps the rows and says they are the last read; every derived number keys
 * off `failed`.
 *
 * RED AT BASE. On `main` at `768241ef`, with the four product files untouched and this file as
 * committed: 10 of the 19 cases fail — the six that put a page in the stale state (one `funnel`,
 * two `team-performance`, two `saved` including the success → refused-reload → success walk, one
 * `custom`), plus the four ratchet cases that read the source for `failed` / `stale` and prove the
 * guard cannot see this class. The other 9 are the outage-and-empty controls from #2829, kept as
 * regression pins because replacing `error ?` with `failed ?` can break them; they pass at base and
 * must keep passing.
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

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
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
  usePathname: () => '/tenant/reports',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import CustomReportBuilderPage from '@/app/tenant/reports/custom/page';
import FunnelPage from '@/app/tenant/reports/funnel/page';
import SavedReportsPage from '@/app/tenant/reports/saved/page';
import TeamPerformancePage from '@/app/tenant/reports/team-performance/page';

const NOW = '2026-10-01T00:00:00Z';
const FUNNEL = '/api/tenant/reports/conversion-funnel';
const TEAM = '/api/tenant/reports/team-performance';
const SAVED = '/api/tenant/reports/saved';
const CUSTOM = '/api/tenant/reports/custom';

const funnelStages = {
  total: 12,
  pipeline: { id: 'pl-1', stageCount: 3 },
  data: [
    { stageId: 'st-1', stageName: 'Qualified', order: 1, count: 7, value: '70000', cumulativeCount: 7, cumulativeValue: '70000', conversionToNext: 42.9 },
    { stageId: 'st-2', stageName: 'Negotiation', order: 2, count: 3, value: '30000', cumulativeCount: 3, cumulativeValue: '30000', conversionToNext: 66.7 },
  ],
};
const teamRows = {
  data: {
    byRep: [{ userId: 'u-1', name: 'Priya Raman', total: 9, converted: 3, open: 4, pipelineValue: '120000', conversionRate: 33 }],
    byTeam: [{ teamId: 't-1', name: 'Gulf Region', total: 14, converted: 5, open: 6, pipelineValue: '210000', conversionRate: 36 }],
  },
};
const savedReports = {
  data: [
    { id: 'sr-1', name: 'Q3 deal pipeline', reportType: 'deals', chartType: null, isPublic: true, lastRunAt: NOW, createdBy: 'u-1', createdAt: NOW, updatedAt: NOW, createdByName: 'Priya Raman' },
    { id: 'sr-2', name: 'Unworked leads', reportType: 'leads', chartType: null, isPublic: false, lastRunAt: null, createdBy: 'u-2', createdAt: NOW, updatedAt: NOW, createdByName: 'Nadia Farouk' },
  ],
};
const builderReports = {
  data: [
    { id: 'cr-1', name: 'Deals by source', type: 'deals', description: '', filters: {}, columns: ['name', 'value'] },
    { id: 'cr-2', name: 'Contacts without owner', type: 'contacts', description: '', filters: {}, columns: ['name'] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

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

/** The builder's saved list only exists behind its disclosure button. */
function openSavedPanel() {
  fireEvent.click(screen.getByRole('button', { name: /saved reports \(/i }));
}

describe('funnel: a refused refresh keeps the funnel (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows the stages the last read returned and names them the last read', () => {
    const result = staleRead(funnelStages);
    registry.byUrl = { [FUNNEL]: result };
    wrapped(<FunnelPage />);
    // Each stage is rendered twice — once in the volume bars, once in the table — so both
    // halves of the report survive the refused refresh.
    expect(screen.getAllByText('Qualified')).toHaveLength(2);
    expect(screen.getAllByText('Negotiation')).toHaveLength(2);
    expect(alerts()).toContain('Could not refresh this report');
    expect(alerts()).toContain('the funnel below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be a lie here: the report is on the screen.
    expect(screen.queryByText(/Failed to load the conversion funnel/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread period is still an outage, and still not "No deals for this period yet."', () => {
    registry.byUrl = { [FUNNEL]: failed('Request failed (500)') };
    wrapped(<FunnelPage />);
    expect(screen.queryByText(/No deals for this period yet/)).toBeNull();
    expect(alerts()).toContain('Failed to load the conversion funnel');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [FUNNEL]: ok(funnelStages) };
    wrapped(<FunnelPage />);
    expect(screen.getAllByText('Qualified')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('team-performance: one refused refresh does not blank two tables (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both tables and labels them the last read', () => {
    const result = staleRead(teamRows);
    registry.byUrl = { [TEAM]: result };
    wrapped(<TeamPerformancePage />);
    // One read feeds both, so one banner has to cover both — and neither table may fall back to
    // its own "No leads yet." while the other is showing rows.
    expect(screen.getByText('Priya Raman')).toBeTruthy();
    expect(screen.getByText('Gulf Region')).toBeTruthy();
    expect(screen.queryByText('No leads yet.')).toBeNull();
    expect(alerts()).toContain('the tables below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('counts what it holds, not what it could not read', () => {
    registry.byUrl = { [TEAM]: staleRead(teamRows) };
    wrapped(<TeamPerformancePage />);
    expect(screen.getByText('$120,000')).toBeTruthy();
  });

  it('a report that never loaded is one banner, not two empty tables', () => {
    registry.byUrl = { [TEAM]: failed('Request failed (500)') };
    wrapped(<TeamPerformancePage />);
    expect(screen.queryByText('No leads yet.')).toBeNull();
    expect(alerts()).toContain('Failed to load team performance');
  });
});

describe('saved reports: deleting a report no longer hides the proof it went away (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the list, the filters and the caveat that a delete may not be reflected', () => {
    const result = staleRead(savedReports);
    registry.byUrl = { [SAVED]: result };
    wrapped(<SavedReportsPage />);
    // Both delete and run call reload(), so this is the page's state right after either action.
    expect(screen.getByText('Q3 deal pipeline')).toBeTruthy();
    expect(screen.getByText('Unworked leads')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search reports...')).toBeTruthy();
    expect(alerts()).toContain('the list below is the last read');
    expect(alerts()).toContain('A report you just deleted may still appear here');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/Failed to load saved reports/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('walks the delete path: a good read, then a refused reload, then a good read again', () => {
    // The other cases hand each page one state; this is the transition the page is actually in on
    // a delete — list loads, `reload()` runs, the refetch comes back refused. Asserting the hop is
    // what proves the rows are *kept*, not re-fetched from a fresh mock.
    registry.byUrl = { [SAVED]: ok(savedReports) };
    const view = wrapped(<SavedReportsPage />);
    expect(screen.getByText('Q3 deal pipeline')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [SAVED]: staleRead(savedReports) };
    view.rerender(tree(<SavedReportsPage />));
    expect(screen.getByText('Q3 deal pipeline')).toBeTruthy();
    expect(screen.getByText('Unworked leads')).toBeTruthy();
    expect(alerts()).toContain('A report you just deleted may still appear here');
    expect(screen.queryByText(/Failed to load saved reports/)).toBeNull();

    // A later good read has to take the caveat away with it.
    registry.byUrl = { [SAVED]: ok(savedReports) };
    view.rerender(tree(<SavedReportsPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an unread list is an outage, and not "No saved reports"', () => {
    registry.byUrl = { [SAVED]: failed('Request failed (500)') };
    wrapped(<SavedReportsPage />);
    expect(screen.queryByText('No saved reports')).toBeNull();
    expect(alerts()).toContain('Failed to load saved reports');
  });

  it('a filtered miss is still an honest client-side sentence', () => {
    registry.byUrl = { [SAVED]: ok(savedReports) };
    wrapped(<SavedReportsPage />);
    fireEvent.change(screen.getByPlaceholderText('Search reports...'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No reports match your filters')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the builder: a saved report no longer counts as unreadable (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows the true number of saved reports after the save-refetch fails', () => {
    // Saving a report invalidates CUSTOM_REPORTS_QUERY, so the header used to print
    // `Saved Reports (—)` over two reports the panel was still listing — #2872's
    // correct-looking-counter case, invisible to a guard that only tracks banners.
    const result = staleRead(builderReports);
    registry.byUrl = { [CUSTOM]: result };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(2\)/i })).toBeTruthy();
    openSavedPanel();
    expect(screen.getByText('Deals by source')).toBeTruthy();
    expect(screen.getByText('Contacts without owner')).toBeTruthy();
    expect(alerts()).toContain('the list below is the last read');
    expect(screen.queryByText(/Failed to load your saved reports/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('counts — only when there is nothing to count', () => {
    registry.byUrl = { [CUSTOM]: failed('Request failed (500)') };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(—\)/i })).toBeTruthy();
    openSavedPanel();
    expect(alerts()).toContain('Failed to load your saved reports');
    expect(screen.queryByText('No saved reports yet')).toBeNull();
  });

  it('a genuine zero is still a zero', () => {
    registry.byUrl = { [CUSTOM]: ok({ data: [] }) };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(0\)/i })).toBeTruthy();
    openSavedPanel();
    expect(screen.getByText('No saved reports yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/reports/funnel/page.tsx',
    'app/tenant/reports/team-performance/page.tsx',
    'app/tenant/reports/saved/page.tsx',
    'app/tenant/reports/custom/page.tsx',
  ];

  it('splits the two states apart on all four pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/\bfailed \?/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*error \? \(/);
    }
  });

  it('leaves no derived number keyed off the bare error', () => {
    // `savedError ? '—' : n` reports an unread list above a list it is counting. The dash has to
    // key off the outage, and nothing may key off the flag any more.
    const src = readFileSync(join(ROOT, 'app/tenant/reports/custom/page.tsx'), 'utf8');
    expect(src).toMatch(/\{failed \? '—' : savedReports\.length\}/);
    for (const f of FILES) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} still dashes on the bare error`)
        .not.toMatch(/\w*[Ee]rror \? '—'/);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each had
    // to undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never have been baselined — it was already visible to the guard`)
        .not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // Every one of these four bound `error`, rendered `InlineErrorState`, and was invisible to the
    // screen for exactly the reason #2872 is a separate epic: the question the guard asks is
    // whether a failure reaches the screen at all, and here it reaches it too eagerly.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*stale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`)
        .not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
    }
  });

  it('is not something the branch order could have caught either', async () => {
    // Rewinding `failed` to the bare flag keeps the guard, the baseline and every #2829 assertion
    // green — which is what makes the cases in this file the only screen on this class.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\bfailed \?/g, 'errorFlag ?')
        .replace(/const failed = [^\n]*\n/g, '');
      expect(bare, `${f}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(inspect(f, bare).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
