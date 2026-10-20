// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/trash/page.tsx`, where the bare flag reported two opposite things.
 *
 * The page bound `error: trashError` and gated its outage card on
 * `trashError && !items.length`, and `load()` invalidates `['tenant','trash']` after
 * every restore and every permanent delete. TanStack Query hands the page back the
 * payload it already had when that refresh is refused, so a kept list either showed its
 * tombstones with no word that another user may have restored or purged one, or — when
 * the kept payload happened to be empty — printed "Could not load the trash" as though
 * the read had never answered at all. The first hides the loss; the second invents an
 * outage over a list the server did give.
 *
 * #2829 fixed the read that truly never came back, and this slice keeps that copy word
 * for word on the `failed` arm (a pre-existing render test,
 * `panel-page-error-not-empty-2829`, pins "Could not load the trash" against this very
 * page). The new `stale` arm keeps the rows and names the specific thing at risk on the
 * page where it bites hardest: Delete forever is irreversible, and the buttons are still
 * attached to a list that may be behind.
 *
 * The buttons stay enabled on purpose. PATCH restore re-reads the row by id + tenant +
 * deletedAt and 404s on a gone id (route.ts:232-239), and DELETE hard-deletes and 404s
 * the same way (route.ts:358-362) — so clicking a stale row is refused server-side, not
 * guessed. There is no page-wide purge button wired up: every DELETE sends an `id`, so
 * the dunning/follow-ups "leave the row buttons up" precedent applies with no bulk action
 * to gate. `scripts/check-panel-error-state.mjs` reports this file clean before and after
 * the split is rewound — the sweep only asks whether a panel binds an error and renders a
 * failure affordance, and #2829 already gave this page both. These assertions are what
 * keeps the stale half honest.
 *
 * Fixtures are documentation-only (`Wayne Enterprises`, RFC-style names).
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
}));

import TrashPage from '@/app/tenant/trash/page';

const TRASH = '/api/tenant/trash';
const TRASH_DEALS = '/api/tenant/trash?type=deal';

const rows = {
  data: [
    { id: 't1', name: 'Wayne Enterprises', resource_type: 'company', email: null, extra: null, deleted_at: '2026-01-10T00:00:00.000Z', days_remaining: 9 },
    { id: 't2', name: 'Acme Rocket Supply', resource_type: 'company', email: null, extra: null, deleted_at: '2026-02-01T00:00:00.000Z', days_remaining: 2 },
  ],
  total: 2,
};
const emptyRead = { data: [], total: 0 };

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
const names = () =>
  [...document.querySelectorAll('p.truncate')].map((el) => el.textContent ?? '');
const restoreButtons = () => screen.queryAllByRole('button', { name: 'Restore' });
const purgeButtons = () => screen.queryAllByRole('button', { name: 'Delete forever' });

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const showAll = () => wrapped(<TrashPage />);
const switchToDeals = () => fireEvent.click(screen.getByRole('button', { name: /^deals/i }));
const switchToAll = () => fireEvent.click(screen.getByRole('button', { name: /^all/i }));

describe('a refused refresh keeps the tombstones and names the loss (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [TRASH]: staleRead(rows) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both deleted rows on screen', () => {
    showAll();
    expect(names()).toEqual(expect.arrayContaining(['Wayne Enterprises', 'Acme Rocket Supply']));
  });

  it('says they are the last read, with the reason', () => {
    showAll();
    expect(alerts()).toContain('the last read: Request failed (504)');
  });

  it('does not claim the trash could not be loaded while it is showing rows', () => {
    showAll();
    expect(alerts()).not.toContain('failed request, not an empty one');
  });

  it('names the specific loss instead of saying some data may be out of date', () => {
    showAll();
    expect(alerts()).toMatch(/restored or permanently purged/);
    expect(alerts()).toMatch(/Restore and Delete forever buttons/);
    expect(alerts()).toMatch(/irreversible/);
    expect(alerts()).not.toMatch(/may be out of date/i);
  });

  it('keeps both row buttons attached — deliberate, the server 404s a gone id', () => {
    showAll();
    // PATCH (route.ts:239) and DELETE (route.ts:362) both re-read by id + tenant and
    // answer 404 when the row is already gone, so acting on a stale row is refused, not
    // guessed. Two rows → two Restore + two Delete forever.
    expect(restoreButtons()).toHaveLength(2);
    expect(purgeButtons()).toHaveLength(2);
  });

  it('re-runs the refused read from the caveat, once', () => {
    const result = staleRead(rows);
    registry.byUrl = { [TRASH]: result };
    showAll();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server rather than printing undefined when the refusal has no message', () => {
    registry.byUrl = { [TRASH]: { data: rows, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    showAll();
    expect(alerts()).toContain('the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('the read that never answered keeps #2829\'s copy (#2872)', () => {
  afterEach(cleanup);

  it('shows the outage sentence when the read never answered', () => {
    registry.byUrl = { [TRASH]: failedRead() };
    showAll();
    expect(alerts()).toContain('Could not load the trash — this is a failed request, not an empty one');
  });

  it('shows no rows over a failed read', () => {
    registry.byUrl = { [TRASH]: failedRead() };
    showAll();
    expect(names()).toHaveLength(0);
  });

  it('does not claim an empty bin on a failed read', () => {
    registry.byUrl = { [TRASH]: failedRead() };
    showAll();
    expect(screen.queryByText(/Trash is empty/)).toBeNull();
  });

  it('drives no row action affordance over a failed read', () => {
    // Rule 1 of the epic: an action button must not sit on rows the page never read.
    // There is no page-wide purge button on this panel, so "no action affordance" means
    // no Restore / Delete forever — none survive the outage arm.
    registry.byUrl = { [TRASH]: failedRead() };
    showAll();
    expect(restoreButtons()).toHaveLength(0);
    expect(purgeButtons()).toHaveLength(0);
  });

  it('names the server rather than undefined when the failure has no message', () => {
    registry.byUrl = { [TRASH]: failedRead('') };
    showAll();
    expect(alerts()).toContain('Could not load the trash');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('a genuine empty read is honest, and a stale empty keeps both (#2872)', () => {
  afterEach(cleanup);

  it('says the trash is empty with no alert when the read came back with nothing', () => {
    registry.byUrl = { [TRASH]: ok(emptyRead) };
    showAll();
    expect(screen.getByText('Trash is empty')).toBeTruthy();
    expect(screen.getByText('Nothing has been deleted yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still says empty, with the caveat above it, when the kept list was empty', () => {
    // A refused refresh whose last answer was empty: the empty sentence is honest about
    // the payload the server gave, and the caveat tells the operator the refresh failed.
    registry.byUrl = { [TRASH]: staleRead(emptyRead) };
    showAll();
    expect(screen.getByText('Trash is empty')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('failed request, not an empty one');
  });
});

describe('each filter view is its own read (#2872)', () => {
  // The query key carries {filter} and the URL carries ?type=, so a tab the operator
  // has never opened is a read that never answered while the view they came from still
  // holds its rows — both arms reachable from one page.
  afterEach(cleanup);

  it('calls a filter that never answered an outage, not the stale copy it replaced', () => {
    registry.byUrl = { [TRASH]: staleRead(rows), [TRASH_DEALS]: failedRead('Request failed (503)') };
    showAll();
    switchToDeals();
    expect(alerts()).toContain('Could not load the trash');
    expect(alerts()).not.toMatch(/last read/i);
    expect(names()).toHaveLength(0);
  });

  it('gives the view you came back to its rows and its caveat, not the outage', () => {
    registry.byUrl = { [TRASH]: staleRead(rows), [TRASH_DEALS]: failedRead() };
    showAll();
    switchToDeals();
    switchToAll();
    expect(names()).toHaveLength(2);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('Could not load the trash');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/trash/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all').toMatch(/const failed = Boolean\(trashError\) && !data;\s*\/\/ the read never answered/);
    expect(s).toMatch(/const stale = Boolean\(trashError\) && Boolean\(data\);/);
    expect(s).toMatch(/trashError\?\.message \|\| 'no response from the server'/);
    expect(s, 'the outage card is still gated on the bare flag').not.toMatch(/trashError && !items\.length \?/);
    expect(s).toMatch(/\{stale && \(/);
  });

  it('gates the outage card on failed and keeps #2829\'s sentence verbatim', () => {
    const s = src();
    expect(s).toMatch(/failed \? \(/);
    expect(s, '#2829 wording drifted').toContain('Could not load the trash — this is a failed request, not an empty one.');
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [RegExp, string][] = [
      [/const failed = Boolean\(trashError\) && !data;[^\n]*\n\s*const stale = Boolean\(trashError\) && Boolean\(data\);/,
        'const failed = Boolean(trashError);'],
      [/\{stale && \(/, '{false && ('],
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
    expect(files, 'trash went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
