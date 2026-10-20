// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three `app/superadmin` panels whose rows the page keeps in cache.
 *
 * #2829 gave `templates`, `billing/dunning` and `modules` a failure channel: bind `error`, render
 * `InlineErrorState`, and stop answering a refused read with "No templates yet." / "No dunning
 * attempts found" / "Modules will appear here once they are registered". That half is correct and
 * stays. This slice is the other half #2829 never asked about — the read that DID answer, and then
 * failed to answer again.
 *
 * TanStack Query keeps `data` when a refetch of an already-succeeded query fails. All three pages
 * branched on the flag alone:
 *
 *     : error ? (<InlineErrorState …/>) : rows
 *
 * and dashed every number computed off the rows with `error ? '—' : n`. The refused reload is not
 * exotic here: `retry: 2` and `staleTime: 30_000` mean the ordinary remount refetch past thirty
 * seconds takes it, `templates` also takes it from the `invalidateQueries` its create button fires,
 * and `dunning` from the one each retried payment fires. `modules` is the worst of the three: its
 * rows are seeded into local state once and never cleared, so the page replaced a matrix it was
 * still holding in `modules` with an outage card, over four cards counting that same local state.
 *
 * Per page: `failed = Boolean(err) && !data` keeps the banner #2829 added; `stale =
 * Boolean(err) && data` keeps the rows and says they are the last read; every derived number keys
 * off `failed`.
 *
 * RED AT BASE — measured on `main` at `493065e2` with the three product files untouched and this
 * file as committed: 12 of these 22 cases fail. Eight put a page in the stale state — the three
 * kept-rows cases, the three card-count cases, and the two cases where a filter or a search matches
 * nothing in that last read — and four are the source ratchets (split-the-states-apart,
 * no-number-off-the-bare-error, and both anti-vacuity rewinds). The other 10 are the outage-and-
 * empty controls from #2829 plus the guard/file-size cases; they pass at base and must keep passing,
 * because replacing `error ?` with `failed ?` is exactly the edit that breaks them.
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
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import DunningDashboard from '@/app/superadmin/billing/dunning/page';
import ModulesPage from '@/app/superadmin/modules/page';
import TemplatesPage from '@/app/superadmin/templates/page';

const NOW = '2026-10-01T00:00:00Z';
const TEMPLATES = '/api/superadmin/templates';
const DUNNING = '/api/superadmin/billing/dunning';
const MODULES = '/api/superadmin/modules';

const templateRows = {
  data: [
    { id: 'tpl-1', name: 'Property Brokerage Suite', description: 'Deals, listings and maintenance.', icon: null, status: 'active', is_builtin: false, tenant_count: 7, modules: ['deals', 'contacts'], created_at: NOW },
    { id: 'tpl-2', name: 'Gym Membership Starter', description: null, icon: null, status: 'draft', is_builtin: false, tenant_count: 2, modules: [], created_at: NOW },
  ],
};
const dunningRows = {
  data: [
    { id: 'da-1', subscriptionId: 'sub-11', attemptNumber: 2, status: 'pending', scheduledAt: '2026-10-05T00:00:00Z', executedAt: null, paymentAmount: 1500, errorMessage: null, retryCount: 1, tenant: { name: 'Coral Realty', id: 'tn-1' } },
    { id: 'da-2', subscriptionId: 'sub-22', attemptNumber: 3, status: 'failed', scheduledAt: '2026-10-02T00:00:00Z', executedAt: '2026-10-02T09:00:00Z', paymentAmount: 800, errorMessage: 'card declined', retryCount: 2, tenant: { name: 'Harbor Fitness', id: 'tn-2' } },
  ],
};
const moduleRows = {
  data: [
    { id: 'crm.sales', name: 'Deals Pipeline', category: 'sales', icon: null, total_installs: 14, pricing: { free: { enabled: true, price: 0 }, starter: { enabled: true, price: 29 }, pro: { enabled: true, price: 99 }, enterprise: { enabled: false } } },
    { id: 'crm.vertical', name: 'Class Scheduling', category: 'utility', icon: null, total_installs: 3, pricing: { free: { enabled: false }, starter: { enabled: false }, pro: { enabled: true, price: 49 }, enterprise: { enabled: true, price: 199 } } },
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

/**
 * Matches of `re` that are NOT inside an alert. Every replacement banner here quotes the sentence
 * it retires ("…would be a claim that nothing is offered"), so a bare `queryByText(/No modules
 * configured/)` would find the alert's own copy and report the false claim as still standing.
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

/**
 * The stat value for a label, read off the card that carries it.
 *
 * `templates` and `modules` render `<p>{label}</p><p class="text-2xl font-bold">{value}</p>`;
 * `dunning` renders `<span>{label}</span>` inside `.admin-card` with the value in
 * `<p class="text-2xl font-bold">`. Matching the label text directly is not enough — dunning's
 * filter tabs are also called "Completed" and "Failed" — so the candidate has to sit in a box that
 * holds a `.text-2xl`. Matching on the value directly would collide with the rows (a count of `2`
 * against the table's `#2`).
 */
function statValue(label: string): string {
  const cards = screen.getAllByText(label)
    .map((el) => el.closest('.admin-card') ?? el.parentElement)
    .filter((card): card is HTMLElement => Boolean(card?.querySelector('.text-2xl')));
  expect(cards.length, `${label}: expected exactly one stat card`).toBe(1);
  return (cards[0].querySelector('.text-2xl')?.textContent ?? '').trim();
}

function dashed(label: string) {
  expect(statValue(label), `${label}: states a number this read never produced`).toBe('—');
}

describe('templates: a refused reload keeps the catalogue (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows the templates the last read returned and names them the last read', () => {
    const result = staleRead(templateRows);
    registry.byUrl = { [TEMPLATES]: result };
    wrapped(<TemplatesPage />);
    expect(screen.getByText('Property Brokerage Suite')).toBeTruthy();
    expect(screen.getByText('Gym Membership Starter')).toBeTruthy();
    expect(alerts()).toContain('the templates below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be a lie: the catalogue is on the screen.
    expect(claimsOutsideAlerts(/Failed to load templates/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('counts the four cards from the rows it is still holding', () => {
    registry.byUrl = { [TEMPLATES]: staleRead(templateRows) };
    wrapped(<TemplatesPage />);
    expect(statValue('Total Templates')).toBe('2');
    expect(statValue('Active')).toBe('1');
    expect(statValue('Draft')).toBe('1');
    expect(statValue('Total Assignments')).toBe('9');
  });

  it('an unread catalogue is still an outage, and never "No templates yet."', () => {
    registry.byUrl = { [TEMPLATES]: failed('Request failed (500)') };
    wrapped(<TemplatesPage />);
    expect(claimsOutsideAlerts(/No templates yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load templates');
    expect(alerts()).not.toContain('Could not refresh');
    for (const label of ['Total Templates', 'Active', 'Draft', 'Total Assignments']) {
      dashed(label);
    }
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [TEMPLATES]: ok({ data: [] }) };
    wrapped(<TemplatesPage />);
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
    expect(statValue('Total Templates')).toBe('0');
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when the read answers with rows', () => {
    registry.byUrl = { [TEMPLATES]: ok(templateRows) };
    wrapped(<TemplatesPage />);
    expect(screen.getByText('Property Brokerage Suite')).toBeTruthy();
    expect(statValue('Total Templates')).toBe('2');
    expect(alerts()).toBe('');
  });
});

describe('dunning: a refused reload keeps the money panel (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both attempts on the table and labels them the last read', () => {
    const result = staleRead(dunningRows);
    registry.byUrl = { [DUNNING]: result };
    wrapped(<DunningDashboard />);
    expect(screen.getByText('Coral Realty')).toBeTruthy();
    expect(screen.getByText('Harbor Fitness')).toBeTruthy();
    expect(claimsOutsideAlerts(/No dunning attempts found/)).toEqual([]);
    expect(alerts()).toContain('the attempts below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load dunning attempts/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('the four cards count the cached attempts instead of dashing', () => {
    registry.byUrl = { [DUNNING]: staleRead(dunningRows) };
    wrapped(<DunningDashboard />);
    expect(statValue('Pending Retries')).toBe('1');
    expect(statValue('Completed')).toBe('0');
    expect(statValue('Failed')).toBe('1');
    expect(statValue('Total Amount')).toBe('$2,300');
  });

  it('an unread panel is still an outage, and never zero retries owed', () => {
    registry.byUrl = { [DUNNING]: failed('Request failed (500)') };
    wrapped(<DunningDashboard />);
    expect(claimsOutsideAlerts(/No dunning attempts found/)).toEqual([]);
    expect(alerts()).toContain('Failed to load dunning attempts');
    expect(alerts()).not.toContain('Could not refresh');
    for (const label of ['Pending Retries', 'Completed', 'Failed', 'Total Amount']) {
      dashed(label);
    }
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [DUNNING]: ok({ data: [] }) };
    wrapped(<DunningDashboard />);
    expect(screen.getByText('No dunning attempts found')).toBeTruthy();
    expect(statValue('Total Amount')).toBe('$0');
    expect(alerts()).toBe('');
  });

  it('a filter that matches nothing in the last read is still the filter\'s own truth', () => {
    // Under a stale read the rows on screen ARE what the page has; selecting "Completed" and
    // getting none is not the outage speaking, it is this filter over the last read. The caveat
    // still has to be standing above it.
    registry.byUrl = { [DUNNING]: staleRead(dunningRows) };
    wrapped(<DunningDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText('No dunning attempts found')).toBeTruthy();
    expect(alerts()).toContain('the attempts below are the last read');
  });
});

describe('modules: a refused reload keeps the plan offerings matrix (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the rows and their toggles and names the read it is standing on', () => {
    const result = staleRead(moduleRows);
    registry.byUrl = { [MODULES]: result };
    wrapped(<ModulesPage />);
    expect(screen.getByText('Deals Pipeline')).toBeTruthy();
    expect(screen.getByText('Class Scheduling')).toBeTruthy();
    // Both plan columns of the first row are on, so the matrix is still operable.
    expect(screen.getAllByText('On').length).toBeGreaterThan(0);
    expect(claimsOutsideAlerts(/No modules configured/)).toEqual([]);
    expect(alerts()).toContain('the matrix below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('the four cards count the seeded rows instead of dashing', () => {
    registry.byUrl = { [MODULES]: staleRead(moduleRows) };
    wrapped(<ModulesPage />);
    expect(statValue('Total Modules')).toBe('2');
    expect(statValue('Free')).toBe('1');
    expect(statValue('Starter')).toBe('1');
    expect(statValue('Pro')).toBe('2');
  });

  it('an unread matrix is still an outage, and never "Modules will appear here"', () => {
    registry.byUrl = { [MODULES]: failed('Request failed (500)') };
    wrapped(<ModulesPage />);
    expect(claimsOutsideAlerts(/Modules will appear here|No modules configured/)).toEqual([]);
    expect(alerts()).toContain('Failed to load the plan offerings');
    expect(alerts()).not.toContain('Could not refresh');
    for (const label of ['Total Modules', 'Free', 'Starter', 'Pro']) {
      dashed(label);
    }
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [MODULES]: ok({ data: [] }) };
    wrapped(<ModulesPage />);
    expect(screen.getByText('No modules configured')).toBeTruthy();
    expect(statValue('Total Modules')).toBe('0');
    expect(alerts()).toBe('');
  });

  it('a search that matches nothing in the last read is the search speaking, not the outage', () => {
    registry.byUrl = { [MODULES]: staleRead(moduleRows) };
    wrapped(<ModulesPage />);
    fireEvent.change(screen.getByPlaceholderText('Search modules...'), { target: { value: 'nothing' } });
    expect(screen.getByText('No modules match your search')).toBeTruthy();
    expect(claimsOutsideAlerts(/No modules configured/)).toEqual([]);
    expect(alerts()).toContain('the matrix below is the last read');
  });

  it('says nothing about freshness when the read answers with rows', () => {
    registry.byUrl = { [MODULES]: ok(moduleRows) };
    wrapped(<ModulesPage />);
    expect(screen.getByText('Deals Pipeline')).toBeTruthy();
    expect(statValue('Total Modules')).toBe('2');
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/superadmin/templates/page.tsx',
    'app/superadmin/billing/dunning/page.tsx',
    'app/superadmin/modules/page.tsx',
  ];

  it('splits the two states apart on all three pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/\bfailed \?/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*error \? \(/);
      expect(src, `${f} still gates a table body on the bare flag`).not.toMatch(/\{\s*error \? \(/);
    }
  });

  it('leaves no derived number keyed off the bare error', () => {
    // `error ? '—' : modules.length` reports an unread matrix above the matrix it is counting —
    // correct-looking code, and invisible to a screen that only asks whether a failure reaches
    // the page at all. The dash has to key off the outage.
    for (const f of FILES) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} still dashes on the bare error`)
        .not.toMatch(/\w*[Ee]rror \? '—'/);
    }
    const src = readFileSync(join(ROOT, 'app/superadmin/modules/page.tsx'), 'utf8');
    expect(src).toMatch(/\{ label: 'Total Modules', value: failed \? '—' : modules\.length/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866 each had to
    // undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is visible to the guard`).not.toContain(f);
    }
  });

  it('would not have been caught by the guard if the stale banner were deleted', async () => {
    // Deleting the whole stale block from each page leaves the guard just as satisfied as it was
    // before this slice: these pages already bound `error` and rendered a failure affordance, so
    // the screen never asked the question this slice answers. That is why these cases exist.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*stale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('would not have been caught by the guard with the flags rewound to the bare error', async () => {
    // The actual regression this file guards: `failed` back to `error` keeps the guard, the
    // baseline, the #2829 import, and every outage assertion green. Only the render cases above
    // can see it.
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
