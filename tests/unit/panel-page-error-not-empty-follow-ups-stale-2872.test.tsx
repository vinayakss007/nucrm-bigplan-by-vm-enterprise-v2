// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/follow-ups/page.tsx`, whose single flag decided both questions.
 *
 * `const error = queryError ? \`Failed to load follow-ups: ${queryError.message}\` : null`
 * was the whole read model, and every arm below it — the outage card, the empty card, the
 * rows, the `Showing 1–2 of 42` line and the pager — keyed off `!error`. Mark complete and
 * Delete both call `reload()`, which invalidates `['tenant','follow-ups']`; when that
 * refresh was refused, TanStack Query handed the page back the payload it already had and
 * the page behaved as if it had nothing: 42 follow-ups, two of them on screen, gone, and
 * the operator told the list could not be loaded. #2829 fixed the read-that-never-answered
 * half of that, and this slice keeps it exactly — the outage copy and the hidden rows are
 * right when there is genuinely nothing to keep.
 *
 * The other difference from lead-warming is that the query key carries
 * `{statusFilter, offset}`, so the filter views are separate cache entries: switching to a
 * status the operator has never opened is a read that never answered *while the view they
 * came from still holds its rows*. Both arms are reachable from one page, and the cases
 * below pin them against each other rather than picking one.
 *
 * `scripts/check-panel-error-state.mjs` reports this file clean before and after the split
 * is rewound — the sweep asks whether a panel binds an error and renders a failure
 * affordance, and this page already did both. These assertions are the only thing keeping
 * the stale half honest.
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

import FollowUpsPage from '@/app/tenant/follow-ups/page';

const ALL = '/api/tenant/follow-ups?limit=20&offset=0';
const MISSED = '/api/tenant/follow-ups?limit=20&offset=0&status=missed';

const rows = {
  data: [
    { id: 'f1', title: 'Renew the Andheri lease', description: null, dueDate: '2026-03-04T10:00:00.000Z', status: 'pending', missedDays: null, autoAiEnabled: null, completedAt: null, contactName: 'Kavya Rane', leadName: null, assigneeName: 'Vinayak' },
    { id: 'f2', title: 'Chase the Santacruz survey', description: null, dueDate: '2026-02-20T10:00:00.000Z', status: 'pending', missedDays: 3, autoAiEnabled: null, completedAt: null, contactName: 'Imran Shaikh', leadName: null, assigneeName: null },
    { id: 'f3', title: 'Send the Thane addendum', description: null, dueDate: '2026-02-10T10:00:00.000Z', status: 'completed', missedDays: null, autoAiEnabled: null, completedAt: '2026-02-11T10:00:00.000Z', contactName: 'Deepa Iyer', leadName: null, assigneeName: null },
  ],
  total: 42,
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
const titles = () =>
  [...document.querySelectorAll('p.truncate')].map((el) => el.textContent ?? '');
const pager = () =>
  [...document.querySelectorAll('p.text-sm')]
    .map((el) => el.textContent ?? '')
    .find((t) => t.startsWith('Showing')) ?? '';
const pageLine = () =>
  [...document.querySelectorAll('span.text-xs')]
    .map((el) => el.textContent ?? '')
    .find((t) => t.startsWith('Page')) ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const showAll = () => wrapped(<FollowUpsPage />);
const switchToMissed = () =>
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missed' } });

describe('a refused refresh keeps the rows, the count and the pager (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ALL]: staleRead(rows) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps all three follow-ups and says they are the last read, with the reason', () => {
    showAll();
    expect(titles()).toEqual(expect.arrayContaining([
      'Renew the Andheri lease', 'Chase the Santacruz survey', 'Send the Thane addendum',
    ]));
    expect(alerts()).toContain('Could not refresh, so the follow-ups below are the last read: Request failed (504)');
  });

  it('does not tell the operator the list could not be loaded while it is on screen', () => {
    showAll();
    expect(alerts()).not.toContain('Failed to load follow-ups');
  });

  it('names the count at stake instead of saying some data may be out of date', () => {
    showAll();
    expect(alerts()).toMatch(/"of 42" is the count from before/);
    expect(alerts()).toMatch(/Mark complete and Delete buttons/);
    expect(alerts()).toMatch(/land past the real end|past the real end/);
  });

  it('keeps the last read\'s page arithmetic rather than dashing it', () => {
    showAll();
    expect(pager()).toBe('Showing 1–20 of 42');
    expect(pageLine()).toBe('Page 1 of 3');
  });

  it('keeps the row buttons attached to the rows it is still showing', () => {
    showAll();
    // Deliberate, and pinned: PATCH/DELETE re-read the row by id + tenant and 404
    // on the way, so acting on a kept row is refused server-side rather than guessed.
    expect(screen.getAllByTitle('Mark complete')).toHaveLength(2);
    expect(screen.getAllByTitle('Delete')).toHaveLength(3);
  });

  it('keeps the overdue marker it read, and the 3d overdue row is still flagged', () => {
    showAll();
    expect(screen.getByText('3d overdue')).toBeTruthy();
  });

  it('re-runs this read from the caveat', () => {
    const result = staleRead(rows);
    registry.byUrl = { [ALL]: result };
    showAll();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the filter select on the view whose refresh was refused', () => {
    showAll();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });
});

describe('the read that never answered keeps #2829\'s copy (#2872)', () => {
  afterEach(cleanup);

  it('shows the outage card, no rows and no pager when the read never answered', () => {
    registry.byUrl = { [ALL]: failedRead() };
    showAll();
    expect(alerts()).toContain('Failed to load follow-ups: Request failed (500)');
    expect(titles()).toHaveLength(0);
    expect(pager()).toBe('');
    expect(screen.queryByText('No follow-ups found')).toBeNull();
  });

  it('names the server rather than printing undefined when the refusal has no message', () => {
    registry.byUrl = { [ALL]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    showAll();
    expect(alerts()).toContain('Failed to load follow-ups: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('names the server in the stale caveat the same way', () => {
    registry.byUrl = { [ALL]: { data: rows, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    showAll();
    expect(alerts()).toContain('are the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('says "No follow-ups found" only for the read that came back with nobody', () => {
    registry.byUrl = { [ALL]: ok(emptyRead) };
    showAll();
    expect(screen.getByText('No follow-ups found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still says none exist, with the caveat over it, when the empty list is all the last read has', () => {
    registry.byUrl = { [ALL]: staleRead(emptyRead) };
    showAll();
    expect(screen.getByText('No follow-ups found')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('each filter view is its own read, and each is judged on its own (#2872)', () => {
  afterEach(cleanup);

  it('calls a filter that never answered an outage, not a stale copy of the view it replaced', () => {
    registry.byUrl = { [ALL]: staleRead(rows), [MISSED]: failedRead('Request failed (503)') };
    showAll();
    switchToMissed();
    expect(alerts()).toContain('Failed to load follow-ups: Request failed (503)');
    expect(alerts()).not.toMatch(/last read/i);
    expect(titles()).toHaveLength(0);
    expect(pager()).toBe('');
  });

  it('gives the view you came back to its rows and its caveat, not the outage you just saw', () => {
    registry.byUrl = { [ALL]: staleRead(rows), [MISSED]: failedRead() };
    showAll();
    switchToMissed();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(titles()).toHaveLength(3);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('Failed to load follow-ups');
  });

  it('shows the kept rows and no alert at all once the refresh answers', () => {
    registry.byUrl = { [ALL]: ok(rows) };
    showAll();
    expect(titles()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pager()).toBe('Showing 1–20 of 42');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/follow-ups/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all').toMatch(/const failed = Boolean\(queryError\) && !json;/);
    expect(s).toMatch(/const stale = Boolean\(queryError\) && Boolean\(json\);/);
    expect(s).toMatch(/queryError\?\.message \|\| 'no response from the server'/);
    expect(s, 'the old one-flag collapse is still there').not.toMatch(/queryError \? `Failed to load follow-ups/);
    expect(s).toMatch(/\{stale && \(/);
  });

  it('never hides the rows or the empty card on the bare flag', () => {
    const s = src();
    expect(s, 'an arm still reads the bare flag').not.toMatch(/!loading && !queryError/);
    expect(s, 'the outage sentence is built from a message that can be undefined').not.toMatch(/\$\{queryError\.message\}/);
    expect(s).toMatch(/!loading && !error && data\.length === 0/);
    expect(s).toMatch(/!loading && !error && data\.length > 0/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string][] = [
      [/const failed = Boolean\(queryError\) && !json;\s*\n\s*const stale = Boolean\(queryError\) && Boolean\(json\);/,
       'const failed = Boolean(queryError);'],
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
    expect(files, 'follow-ups went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
