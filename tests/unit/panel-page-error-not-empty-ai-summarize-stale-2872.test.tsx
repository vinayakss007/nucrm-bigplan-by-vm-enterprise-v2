// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/tenant/ai/summarize`, the record-summariser's entity typeahead.
 *
 * Measured against `origin/main`'s copy of `app/tenant/ai/summarize/page.tsx` (scratch
 * worktree, `npx vitest run tests/unit/panel-page-error-not-empty-ai-summarize-stale-2872.test.tsx`):
 *   BEFORE the fix: 9 tests, 7 red, 2 green (the healthy read and Generate's disabled gate).
 *   AFTER  the fix: 9 tests, 0 red, 9 green.
 *
 * `ai/draft` — this page's twin — got its typeahead channels split in PR #3034. This one
 * still destructures `data` only. The pick list is rendered behind
 * `{entityHits.length > 0 && …}`, so every failure of `/api/tenant/{contacts,deals,companies}`
 * is indistinguishable from "nobody matched": the operator sees a search box with no
 * dropdown, is handed no reason and no retry, and the only `error` name in the file is the
 * local string the Generate mutation writes.
 *
 * Two things this slice has to keep true while fixing that: the Generate button must stay
 * reachable (a stale list is still a list to summarise), and a refused refresh must not
 * spend the rows TanStack kept — the rows are what the operator is looking at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import AISummarizePage from '@/app/tenant/ai/summarize/page';

const CONTACT_SEARCH = '/api/tenant/contacts?limit=8&search=';

const hitRows = {
  data: [
    { id: 'contact-0a1b', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@corp.test' },
    { id: 'contact-0c2d', firstName: 'Grace', lastName: 'Hopper', email: 'grace@corp.test' },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** A 404 with nothing kept is an ANSWER ("no such record"), not an outage. */
const notFound = (): QueryResult => ({
  data: undefined,
  error: Object.assign(new Error('Request failed (404)'), { status: 404 }),
  isLoading: false,
  refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';
const absence = () => /No contact records came back for this search/i.test(bodyText());

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('summarise typeahead: a refused read of the pick list says so (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the hits it read and marks them the last read', () => {
    registry.byUrl = { [CONTACT_SEARCH]: staleRead(hitRows) };
    wrapped(<AISummarizePage />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load the Contact search/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    expect(absence()).toBe(false);
  });

  it('leaves Generate reachable over a stale list, which is the whole point of the caveat', () => {
    registry.byUrl = { [CONTACT_SEARCH]: staleRead(hitRows) };
    wrapped(<AISummarizePage />);
    fireEvent.click(screen.getByText('Ada Lovelace'));
    const generate = screen.getByRole('button', { name: /generate summary/i });
    // A stale read must not arm the one action the operator still has.
    expect(generate.disabled).toBe(false);
  });

  it('reports the outage instead of an empty dropdown when nothing was read', () => {
    registry.byUrl = { [CONTACT_SEARCH]: failed('Request failed (503)') };
    wrapped(<AISummarizePage />);
    expect(alerts()).toMatch(/Failed to load the Contact search/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    // The absence sentence is retired: the search was never answered.
    expect(absence()).toBe(false);
  });

  it('prints the absence sentence, with no alert, when the search answered with none', () => {
    registry.byUrl = { [CONTACT_SEARCH]: ok({ data: [] }) };
    wrapped(<AISummarizePage />);
    expect(absence()).toBe(true);
    expect(alerts()).toBe('');
  });

  it('prints the caveat AND the absence sentence when a refused refresh sat on an empty answer', () => {
    registry.byUrl = { [CONTACT_SEARCH]: staleRead({ data: [] }) };
    wrapped(<AISummarizePage />);
    expect(absence()).toBe(true);
    expect(alerts()).toMatch(/last read/i);
  });

  it('treats a 404 as the answer it is, and a 404 over kept rows as a refused refresh', () => {
    registry.byUrl = { [CONTACT_SEARCH]: notFound() };
    wrapped(<AISummarizePage />);
    expect(alerts()).not.toMatch(/Failed to load the Contact search/i);
    expect(alerts()).not.toMatch(/last read/i);
    expect(absence()).toBe(true);
    cleanup();

    // …and the same status code arriving on top of the rows it had already read is the
    // refresh being refused, not the records vanishing.
    registry.byUrl = { [CONTACT_SEARCH]: { ...staleRead(hitRows), error: Object.assign(new Error('Request failed (404)'), { status: 404 }) } };
    wrapped(<AISummarizePage />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('re-runs the search read from the banner, and issues no write', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [CONTACT_SEARCH]: failed() };
    wrapped(<AISummarizePage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CONTACT_SEARCH].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says "no response from the server" for a messageless failure, and never `undefined`', () => {
    registry.byUrl = { [CONTACT_SEARCH]: failed('') };
    wrapped(<AISummarizePage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(bodyText()).not.toMatch(/undefined/);
  });

  it('stays silent for a search it read', () => {
    registry.byUrl = { [CONTACT_SEARCH]: ok(hitRows) };
    wrapped(<AISummarizePage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(absence()).toBe(false);
  });
});
