// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the four `app/tenant/reports/*` panels still on the ratchet list.
 *
 * A report page is the one place where "there are none" is a statement about the
 * tenant's business, so a refused read here is the most expensive version of this bug.
 * Measured on this branch before the fix with the repo's own screen (`inspect()` from
 * `scripts/check-panel-error-state.mjs`):
 *
 *   - `funnel`             — bound `refetch` but **no `error` at all**: the refusal had
 *     no channel whatsoever, and the page answered it with "No deals for this period
 *     yet." above a disabled CSV button. The funnel's whole job is stating deal volume
 *     per stage, so it reported a pipeline with no deals in it.
 *   - `team-performance`   — bound `error` and routed it to a `useEffect` toast, then
 *     printed "No leads yet." **twice** — once per table — because one read feeds both.
 *     Two independent-looking claims about reps and teams, neither of which the server
 *     had answered, each next to its own CSV button.
 *   - `saved`              — `if (error) toast.error('Failed to load reports')` sitting
 *     in the *render body*, so it re-fired on every render of a four-second toast while
 *     the page kept answering with "No saved reports / Run a report and save it to see
 *     it here" and a link away. The filters hide when the list is empty, so there was
 *     nothing left to show the refusal.
 *   - `custom`             — the report builder. Its `useApiQuery` destructured
 *     **neither `error` nor `refetch`**, so the header button counted the read that
 *     never arrived: "Saved Reports (0)", and opening the panel gave "No saved reports
 *     yet". A builder that says you have no saved reports invites rebuilding one that
 *     exists.
 *
 * Two of the four (team-performance, saved) had a toast as their only failure channel,
 * so the announcement-once case is a real regression pin for them; the other two had no
 * channel at all, and their alert-and-no-sentence cases are what go red. The split is
 * asserted at base below.
 *
 * Per panel: failed read → `role="alert"` naming that read, its own `refetch` behind
 * "Try again", the false-empty sentence unreachable; succeeded-and-empty → the sentence,
 * no alert; rows → the rows, no alert. Plus the panel-specific halves: the one-banner-
 * replaces-two-tables property for team-performance, the `Saved Reports (—)` count for
 * the builder, the CTA link being gone under a failure on `saved`, and — as the opposite
 * assertion — `saved`'s honest client-side arm still saying "No reports match your
 * filters" with no alert, because a read that succeeded and matched nothing is not an outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

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

import FunnelPage from '@/app/tenant/reports/funnel/page';
import TeamPerformancePage from '@/app/tenant/reports/team-performance/page';
import SavedReportsPage from '@/app/tenant/reports/saved/page';
import CustomReportBuilderPage from '@/app/tenant/reports/custom/page';

const NOW = '2026-10-01T00:00:00Z';
// The funnel builds its url from the range selector; the default range is "All
// time", which adds no query string, so this key is the one the first render uses.
const FUNNEL = '/api/tenant/reports/conversion-funnel';
const TEAM = '/api/tenant/reports/team-performance';
const SAVED = '/api/tenant/reports/saved';
const CUSTOM = '/api/tenant/reports/custom';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => render(tree(node));

/** Everything below the fold on the two panels that keep the list behind a toggle. */
function openSavedPanel() {
  fireEvent.click(screen.getByRole('button', { name: /saved reports \(/i }));
}

// ── fixtures, shaped like each endpoint's own response ─────────────────────────
const funnelStages = {
  total: 12,
  pipeline: { id: 'pl-1', stageCount: 3 },
  data: [
    {
      stageId: 'st-1', stageName: 'Qualified', order: 1, count: 7, value: '70000',
      cumulativeCount: 7, cumulativeValue: '70000', conversionToNext: 42.9,
    },
    {
      stageId: 'st-2', stageName: 'Negotiation', order: 2, count: 3, value: '30000',
      cumulativeCount: 3, cumulativeValue: '30000', conversionToNext: 66.7,
    },
    {
      stageId: 'st-3', stageName: 'Closed won', order: 3, count: 2, value: '20000',
      cumulativeCount: 2, cumulativeValue: '20000', conversionToNext: null,
    },
  ],
};

const teamRows = {
  data: {
    byRep: [
      {
        userId: 'u-1', name: 'Priya Raman', total: 9, converted: 3, open: 4,
        pipelineValue: '120000', conversionRate: 33,
      },
    ],
    byTeam: [
      {
        teamId: 't-1', name: 'Gulf Region', total: 14, converted: 5, open: 6,
        pipelineValue: '210000', conversionRate: 36,
      },
    ],
  },
};

const savedReports = {
  data: [
    {
      id: 'sr-1', name: 'Q3 deal pipeline', reportType: 'deals', chartType: null,
      isPublic: true, lastRunAt: NOW, createdBy: 'u-1', createdAt: NOW, updatedAt: NOW,
      createdByName: 'Priya Raman',
    },
    {
      id: 'sr-2', name: 'Unworked leads', reportType: 'leads', chartType: null,
      isPublic: false, lastRunAt: null, createdBy: 'u-2', createdAt: NOW, updatedAt: NOW,
      createdByName: 'Nadia Farouk',
    },
  ],
};

// The builder reads `savedReports` in *its* shape — `type`, not `reportType`.
const builderReports = {
  data: [
    {
      id: 'cr-1', name: 'Deals by source', type: 'deals', description: '',
      filters: {}, columns: ['name', 'value'],
    },
    {
      id: 'cr-2', name: 'Contacts without owner', type: 'contacts', description: '',
      filters: {}, columns: ['name'],
    },
  ],
};

type Panel = {
  key: string;
  Page: () => ReactNode;
  failUrl: string;
  withFailure: Record<string, QueryResult>;
  /** the "there are none" claim the page used to make */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  empty: Record<string, QueryResult>;
  rows: Record<string, QueryResult>;
  rowText: RegExp;
  /** some panels only show the list after a disclosure is opened */
  reveal?: () => void;
  /** true when a toast was the page's only mention of the failure at base */
  toastedAtBase: boolean;
};

const PANELS: Panel[] = [
  {
    key: 'funnel',
    Page: FunnelPage,
    failUrl: FUNNEL,
    withFailure: { [FUNNEL]: failed('Request failed (503)') },
    sentence: /No deals for this period yet/,
    phrase: /conversion funnel|funnel/i,
    empty: { [FUNNEL]: ok({ data: [], total: 0, pipeline: null }) },
    rows: { [FUNNEL]: ok(funnelStages) },
    rowText: /Negotiation/,
    toastedAtBase: false,
  },
  {
    key: 'team-performance',
    Page: TeamPerformancePage,
    failUrl: TEAM,
    withFailure: { [TEAM]: failed() },
    sentence: /No leads yet/,
    phrase: /team performance/i,
    empty: { [TEAM]: ok({ data: { byRep: [], byTeam: [] } }) },
    rows: { [TEAM]: ok(teamRows) },
    rowText: /Priya Raman/,
    toastedAtBase: true,
  },
  {
    key: 'saved',
    Page: SavedReportsPage,
    failUrl: SAVED,
    withFailure: { [SAVED]: failed('Request failed (500)') },
    sentence: /No saved reports/,
    phrase: /saved reports/i,
    empty: { [SAVED]: ok({ data: [] }) },
    rows: { [SAVED]: ok(savedReports) },
    rowText: /Q3 deal pipeline/,
    toastedAtBase: true,
  },
  {
    key: 'custom',
    Page: CustomReportBuilderPage,
    failUrl: CUSTOM,
    withFailure: { [CUSTOM]: failed() },
    sentence: /No saved reports yet/,
    phrase: /saved reports/i,
    empty: { [CUSTOM]: ok({ data: [] }) },
    rows: { [CUSTOM]: ok(builderReports) },
    rowText: /Deals by source/,
    reveal: openSavedPanel,
    toastedAtBase: false,
  },
];

describe('a refused report read is not reported as "there are none" (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  for (const p of PANELS) {
    describe(p.key, () => {
      const show = () => {
        wrapped(<p.Page />);
        p.reveal?.();
      };

      it('names the failed read instead of claiming the tenant has none', () => {
        registry.byUrl = { ...p.withFailure };
        expect(() => show()).not.toThrow();
        expect(alerts()).toMatch(p.phrase);
        expect(alerts()).toMatch(/failed|did not (load|answer)|could not be read/i);
        expect(
          screen.queryAllByText(p.sentence).length,
          `${p.key}: still states the absence`,
        ).toBe(0);
      });

      it('keeps its honest sentence when the read answers with none', () => {
        registry.byUrl = { ...p.empty };
        show();
        expect(screen.queryAllByText(p.sentence).length, `${p.key}: the sentence went missing`).toBeGreaterThan(0);
        expect(alerts(), `${p.key}: an outage banner on a read that succeeded`).toBe('');
      });

      it('shows the rows the read actually returned', () => {
        registry.byUrl = { ...p.rows };
        show();
        expect(screen.queryAllByText(p.rowText).length, `${p.key}: its own row went missing`).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        show();
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('announces the failure from the banner, not from the render body or an effect', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, `${p.key} fires a load-failure toast on the first render`).not.toHaveBeenCalled();
        if (p.key === 'custom') {
          // The builder keeps the failure unannounced until the panel is opened, so
          // opening it is a re-render — exactly the re-render a render-body toast fired on.
          openSavedPanel();
        } else {
          rerender(tree(<p.Page />));
        }
        expect(toast.error, `${p.key} toasts again on every re-render after it`).not.toHaveBeenCalled();
      });
    });
  }
});

describe('team-performance: one read feeds both tables, so one banner replaces both (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('prints the claim twice when the read is refused', () => {
    // The bug in its own words: at base `byRep` and `byTeam` both fell back to `[]`
    // and each table said "No leads yet." — two separate-sounding verdicts about
    // reps and teams from the one request that never answered.
    registry.byUrl = { [TEAM]: failed('Request failed (500)') };
    wrapped(<TeamPerformancePage />);
    expect(screen.queryAllByText(/No leads yet/)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    expect(
      screen.queryByText('Priya Raman') ?? screen.queryByText('Gulf Region'),
      'a table left standing under the banner would still read as a report',
    ).toBeNull();
  });

  it('says it twice when the read succeeded and both really are empty', () => {
    registry.byUrl = { [TEAM]: ok({ data: { byRep: [], byTeam: [] } }) };
    wrapped(<TeamPerformancePage />);
    expect(screen.queryAllByText(/No leads yet/)).toHaveLength(2);
    expect(alerts()).toBe('');
  });

  it('states the figures it actually read', () => {
    registry.byUrl = { [TEAM]: ok(teamRows) };
    wrapped(<TeamPerformancePage />);
    expect(screen.getByText('Priya Raman')).toBeTruthy();
    expect(screen.getByText('Gulf Region')).toBeTruthy();
    expect(screen.getByText('33%')).toBeTruthy();
    expect(screen.getByText('$120,000')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the report builder refuses to count a read that never arrived (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('shows an em dash where it would have claimed zero saved reports', () => {
    registry.byUrl = { [CUSTOM]: failed() };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(—\)/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /saved reports \(0\)/i })).toBeNull();
  });

  it('counts them when the read answers', () => {
    registry.byUrl = { [CUSTOM]: ok(builderReports) };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(2\)/i })).toBeTruthy();
    openSavedPanel();
    expect(screen.getByText(/Deals by source/)).toBeTruthy();
    expect(screen.getByText(/Contacts without owner/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says "No saved reports yet" — no dash, no alert — for a list that really is empty', () => {
    registry.byUrl = { [CUSTOM]: ok({ data: [] }) };
    wrapped(<CustomReportBuilderPage />);
    expect(screen.getByRole('button', { name: /saved reports \(0\)/i })).toBeTruthy();
    openSavedPanel();
    expect(screen.getByText('No saved reports yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('routes retry to the builder read, not to any other report endpoint', () => {
    registry.byUrl = { [CUSTOM]: failed(), [SAVED]: ok(savedReports) };
    wrapped(<CustomReportBuilderPage />);
    openSavedPanel();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CUSTOM].refetch).toHaveBeenCalled();
    expect(registry.byUrl[SAVED].refetch).not.toHaveBeenCalled();
  });
});

describe('the funnel keeps the report operable under the banner (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('names the failed read, hides the deal total it never read, and stays usable', () => {
    registry.byUrl = { [FUNNEL]: failed('Request failed (503)') };
    wrapped(<FunnelPage />);
    expect(alerts()).toMatch(/conversion funnel/i);
    // "Funnel (12 deals)" is derived from the read, so under a failure no total at all.
    expect(screen.queryByText(/Funnel \(/)).toBeNull();
    expect(screen.queryByText(/Stage details/)).toBeNull();
    // The range selector and Refresh both stay live — a failed read must not strand
    // the page — and CSV stays disabled, because there is nothing to export.
    expect(screen.getByLabelText('Date range')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(registry.byUrl[FUNNEL].refetch).toHaveBeenCalled();
    // CSV is disabled by `stages.length === 0`, which is still true under a failure —
    // the fix must not hand the operator a download of a report that was never read.
    expect((screen.getByRole('button', { name: /csv/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('states the total and the stage-to-stage conversion it did read', () => {
    registry.byUrl = { [FUNNEL]: ok(funnelStages) };
    wrapped(<FunnelPage />);
    expect(screen.getByText('Funnel (12 deals)')).toBeTruthy();
    // Each stage is rendered twice — the bar and the table — so these are counts, not singles.
    expect(screen.queryAllByText('42.9%').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Closed won').length).toBeGreaterThan(0);
    expect(alerts()).toBe('');
    expect((screen.getByRole('button', { name: /csv/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says "No deals for this period yet" without an alert when the read answered empty', () => {
    registry.byUrl = { [FUNNEL]: ok({ data: [], total: 0, pipeline: null }) };
    wrapped(<FunnelPage />);
    expect(screen.getByText(/No deals for this period yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('saved reports: the failure is a banner, the CTA is not (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('does not send the operator off to create a report that may already exist', () => {
    registry.byUrl = { [SAVED]: failed('Request failed (500)') };
    wrapped(<SavedReportsPage />);
    expect(alerts()).toMatch(/saved reports/i);
    expect(screen.queryByText('Run a report and save it to see it here')).toBeNull();
    expect(screen.queryByRole('link', { name: /go to reports/i })).toBeNull();
    expect(screen.queryByText('Q3 deal pipeline')).toBeNull();
  });

  it('keeps the empty-state prose and link for a list that really is empty', () => {
    registry.byUrl = { [SAVED]: ok({ data: [] }) };
    wrapped(<SavedReportsPage />);
    expect(screen.getByText('No saved reports')).toBeTruthy();
    expect(screen.getByText('Run a report and save it to see it here')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to reports/i })).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says "No reports match your filters" with no alert — a read that succeeded and matched nothing is not an outage', () => {
    registry.byUrl = { [SAVED]: ok(savedReports) };
    wrapped(<SavedReportsPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'companies' } });
    expect(screen.getByText('No reports match your filters')).toBeTruthy();
    expect(alerts(), 'the fix is not "turn every empty branch into a banner"').toBe('');
    expect(screen.queryByText('No saved reports')).toBeNull();
  });

  it('keeps the list on screen while a keystroke re-renders it', () => {
    registry.byUrl = { [SAVED]: ok(savedReports) };
    wrapped(<SavedReportsPage />);
    fireEvent.change(screen.getByPlaceholderText('Search reports...'), { target: { value: 'unworked' } });
    expect(screen.getByText('Unworked leads')).toBeTruthy();
    expect(screen.queryByText('Q3 deal pipeline')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Search reports...'), { target: { value: '' } });
    expect(screen.getByText('Q3 deal pipeline')).toBeTruthy();
  });

  it('re-runs the saved-list read, not the builder read beside it', () => {
    registry.byUrl = { [SAVED]: failed(), [CUSTOM]: ok(builderReports) };
    wrapped(<SavedReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SAVED].refetch).toHaveBeenCalled();
    expect(registry.byUrl[CUSTOM].refetch).not.toHaveBeenCalled();
  });
});

describe('the ratchet decayed by exactly these four (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/reports/funnel/page.tsx',
    'app/tenant/reports/team-performance/page.tsx',
    'app/tenant/reports/saved/page.tsx',
    'app/tenant/reports/custom/page.tsx',
  ];

  function baselineKeys() {
    const doc = JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    return Object.keys(doc.files);
  }

  it('is still green, and still counts what the baseline actually holds', () => {
    const keys = baselineKeys();
    // 24 at the time this slice was cut. The two sibling slices in flight (#2851's
    // five `ai/*` pages, #2855's four super-admin panels) each delete more, so this
    // is a ceiling rather than an exact number — the point is that these four left.
    expect(keys.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain(`OK — ${keys.length} panel(s)`);
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale').not.toContain('no longer offends');
  });

  it('no longer carries any of the four', () => {
    const files = baselineKeys();
    for (const f of FILES) {
      expect(files, `${f} stayed on the list after being fixed`).not.toContain(f);
    }
  });

  it('and the screen now sees what it saw before: each page reads its failure and shows it', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still offends the screen`).toBe(false);
      // The removal is honest: the page binds the failure AND renders for it.
      expect(src, `${f} does not bind error`).toMatch(/\berror\b/);
      expect(src, `${f} binds error and never renders it`).toMatch(/InlineErrorState/);
    }
  });

  it('leaves no load-failure toast behind on these four pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure`).not.toMatch(/if \((?:error|\w*[Ee]rror)\)\s*toast\.error/);
      expect(src, `${f} still imports toast for a read that is announced in the panel`).not.toMatch(
        /useEffect\(\(\) => \{\s*if \(error\)/,
      );
    }
  });

  it('keeps every file it touches inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
