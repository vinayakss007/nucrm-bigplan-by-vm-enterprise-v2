// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — three tenant list panels that gave up their rows to a refused refresh.
 *
 * `segments`, `industries` and `activities` all bind `error`, all render
 * `InlineErrorState`, and all pass `check-panel-error-state.mjs`: #2829/#2852 already
 * closed the half where a failed read claimed an absence. This slice is the other half
 * — the read that DID answer, and then refused to answer again — and TanStack Query
 * keeps `data` through it.
 *
 * All three branched on the flag alone:
 *
 *     {error ? (<InlineErrorState message="Failed to load …" />) : the rows}
 *
 * `segments` invalidates its key from both of its mutations (`reload()` on create and
 * on delete), and `industries` invalidates after applying a template, so the ordinary
 * path — press the button, the write succeeds, the reload is refused — replaced the
 * roster, the catalogue, or the log with an outage card over the payload the page was
 * still holding. `activities` is the sharpest because `offset` is part of its key and
 * it passes `placeholderData`: paging to page 2 hands page 1's rows to the new key, so
 * a refused page-2 read blanked them while the header still read "Page 2".
 *
 * Per page: `failed = Boolean(error) && !data` keeps the outage banner, `stale =
 * Boolean(error) && data` keeps the rows under a "last read" caveat, and the raw
 * `error.message` interpolation became the standard `reason` fallback.
 *
 * RED AT BASE — measured on `main` at `64875518` (this branch's base) with the three
 * product files untouched and this file as committed: 8 of these 21 cases fail. Five
 * put a page in the stale state — both `segments` refusals, the `industries`
 * catalogue, the `activities` refused reload, and the refused page-2 read — and three
 * are the source ratchets, which cannot pass until the split exists. The other 13 are
 * the outage-and-empty controls from #2829/#2852; they pass at base and must keep
 * passing, because replacing `error ?` with `failed ?` is exactly the edit that breaks
 * them.
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

import SegmentsPage from '@/app/tenant/segments/page';
import IndustriesPage from '@/app/tenant/industries/page';
import ActivitiesPage from '@/app/tenant/activities/page';

const SEGMENTS = '/api/tenant/segments';
const INDUSTRIES = '/api/tenant/industry-templates';
const PAGE_1 = '/api/tenant/activities?limit=50&offset=0';
const PAGE_2 = '/api/tenant/activities?limit=50&offset=50';

const segmentRows = {
  data: [
    { id: 'sg-1', name: 'Lapsed Warm Contacts', entity_type: 'contacts', filter_count: 3, created_at: '2026-09-02T00:00:00Z' },
    { id: 'sg-2', name: 'Tier 1 Accounts', entity_type: 'companies', created_at: '2026-09-11T00:00:00Z' },
  ],
};
const templateRows = {
  data: [
    { id: 'it-1', name: 'Property Brokerage', description: 'Fields, pipelines and automations for brokerage teams.', icon: '🏠', modules: ['contacts', 'deals'], custom_fields: [], pipelines: [], automations: [] },
    { id: 'it-2', name: 'Gym Operations', description: 'Class scheduling and member renewals out of the box.', icon: '🏋️', modules: ['members'], custom_fields: [], pipelines: [], automations: [] },
  ],
};
// A full page, so `Next` is enabled and paging is the reachable state.
const activityRows = {
  data: Array.from({ length: 50 }, (_, i) => ({
    id: `av-${i}`,
    action: i % 2 ? 'contact_update' : 'deal_create',
    entity_type: i % 2 ? 'contact' : 'deal',
    description: `Activity number ${i + 1}`,
    user_name: 'Priya Raman',
    created_at: '2026-10-01T08:00:00Z',
  })),
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const outage = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Every replacement banner in this
 * class quotes the sentence it retires, so a bare `queryByText(/No templates
 * available/)` would find the alert's own copy and report the false claim as still
 * standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('segments: a refused reload keeps the roster (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both segments, names the read, and retries only this read', () => {
    const result = staleRead(segmentRows);
    registry.byUrl = { [SEGMENTS]: result };
    wrapped(<SegmentsPage />);
    expect(screen.getByText('Lapsed Warm Contacts')).toBeTruthy();
    expect(screen.getByText('Tier 1 Accounts')).toBeTruthy();
    expect(alerts()).toContain('the segments below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load segments/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refusal after a create does not tell the operator the segment is missing', () => {
    // Both mutations call `reload()`, so this is the ordinary path: the write
    // answered, the reload did not, and the base branch replaced the roster.
    registry.byUrl = { [SEGMENTS]: staleRead(segmentRows) };
    wrapped(<SegmentsPage />);
    expect(claimsOutsideAlerts(/No segments defined\. Create your first/)).toEqual([]);
    expect(screen.getByText('Lapsed Warm Contacts')).toBeTruthy();
  });

  it('an unread roster is still an outage, and never the create-prompting absence', () => {
    registry.byUrl = { [SEGMENTS]: outage('Request failed (500)') };
    wrapped(<SegmentsPage />);
    expect(screen.queryByText('Lapsed Warm Contacts')).toBeNull();
    expect(claimsOutsideAlerts(/No segments defined/)).toEqual([]);
    expect(alerts()).toContain('Failed to load segments: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a refusal with no message says so, not undefined', () => {
    registry.byUrl = {
      [SEGMENTS]: { data: undefined, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() },
    };
    wrapped(<SegmentsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [SEGMENTS]: ok({ data: [] }) };
    wrapped(<SegmentsPage />);
    expect(screen.getByText(/No segments defined/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('industries: a refused reload keeps the catalogue (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both templates and their Apply buttons under a last-read caveat', () => {
    const result = staleRead(templateRows);
    registry.byUrl = { [INDUSTRIES]: result };
    wrapped(<IndustriesPage />);
    expect(screen.getByText('Property Brokerage')).toBeTruthy();
    expect(screen.getByText('Gym Operations')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /apply template/i })).toHaveLength(2);
    expect(alerts()).toContain('the templates below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load industry templates/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread catalogue is still an outage, and never "No templates available."', () => {
    registry.byUrl = { [INDUSTRIES]: outage('Request failed (500)') };
    wrapped(<IndustriesPage />);
    expect(screen.queryByText('Property Brokerage')).toBeNull();
    expect(claimsOutsideAlerts(/No templates available/)).toEqual([]);
    expect(alerts()).toContain('Failed to load industry templates: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [INDUSTRIES]: ok({ data: [] }) };
    wrapped(<IndustriesPage />);
    expect(screen.getByText('No templates available.')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [INDUSTRIES]: ok(templateRows) };
    wrapped(<IndustriesPage />);
    expect(screen.getByText('Property Brokerage')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('activities: a refused reload keeps the log, and page 2 says which rows it is', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a refused reload of the answered page keeps its entries', () => {
    const result = staleRead(activityRows);
    registry.byUrl = { [PAGE_1]: result };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('Activity number 1')).toBeTruthy();
    expect(screen.getByText('Activity number 50')).toBeTruthy();
    expect(alerts()).toContain('the entries below are the last read');
    expect(claimsOutsideAlerts(/Failed to load the activity log/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refused page-2 read keeps page 1 rows and admits the page number no longer matches', () => {
    // `placeholderData` hands page 1's rows to the page-2 key, which is exactly what
    // the mock returns for PAGE_2: the payload the real hook would be holding while
    // the new read refused. The base branch hid those rows behind an outage card and
    // left "Page 2" printed above nothing.
    registry.byUrl = { [PAGE_1]: ok(activityRows), [PAGE_2]: staleRead(activityRows) };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText(/Page 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    expect(screen.getByText(/Page 2/)).toBeTruthy();
    expect(screen.getByText('Activity number 1')).toBeTruthy();
    expect(alerts()).toContain('may not match these entries');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/No activity yet/)).toEqual([]);
  });

  it('an unread page is still an outage, and never "No activity yet"', () => {
    registry.byUrl = { [PAGE_1]: outage('Request failed (500)') };
    wrapped(<ActivitiesPage />);
    expect(screen.queryByText(/Activity number/)).toBeNull();
    expect(claimsOutsideAlerts(/No activity yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load the activity log: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a refusal with no message says so, not undefined', () => {
    registry.byUrl = {
      [PAGE_1]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() },
    };
    wrapped(<ActivitiesPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a read that answers "there is none" still says so, with no alert', () => {
    registry.byUrl = { [PAGE_1]: ok({ data: [] }) };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('No activity yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [PAGE_1]: ok(activityRows) };
    wrapped(<ActivitiesPage />);
    expect(screen.getByText('Activity number 7')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/segments/page.tsx',
    'app/tenant/industries/page.tsx',
    'app/tenant/activities/page.tsx',
  ];

  it('splits the two states apart on all three pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(error\) && !data/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(error\) && Boolean\(data\)/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/const reason = error\?\.message \|\| 'no response from the server'/);
      expect(src, `${f} never warns over rows it is still showing`).toMatch(/\{stale && \(/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*(?:\w*[Ee]rror|error) \? \(/);
      expect(src, `${f} still keys its failure copy off the bare flag`).not.toMatch(/error\.message \|\| 'no response from the server'/);
    }
  });

  it('leaves no derived value keyed off the bare flag', () => {
    // A dash or a count that keys off `error` reads as "there are none" while the
    // rows are still on screen — correct-looking code, invisible to a screen that
    // only asks whether a failure reaches the page at all.
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still dashes on the bare flag`).not.toMatch(/\w*[Ee]rror \? '—'/);
      expect(src, `${f} still disables a control on the bare flag`).not.toMatch(/\w*[Ee]rror \? (true|false)/);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866
    // each had to undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is visible to the guard`).not.toContain(f);
    }
  });

  it('would not have been caught by the guard if the stale banners were deleted', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\w*[Ss]tale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const \w*[Ss]tale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('would not have been caught by the guard with the flags rewound to the bare error', async () => {
    // The regression this file exists to catch: `failed` back to the bare flag keeps
    // the guard, the baseline, the #2829 import and every outage assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\bfailed(?=\s*\?|\s*&&|\s*\))/g, 'errorFlag')
        .replace(/const failed = [^\n]*\n/g, '')
        .replace(/if \(failed\) \{/g, 'if (errorFlag) {');
      expect(bare, `${f}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(bare, `${f}: the rewind never reached the gates`).toMatch(/errorFlag/);
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
