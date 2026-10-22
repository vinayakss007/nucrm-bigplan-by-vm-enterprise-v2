// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/tenant/ai`, the AI Hub landing page.
 *
 * Measured against `origin/main`'s copy of `app/tenant/ai/page.tsx` (scratch worktree,
 * `npx vitest run tests/unit/panel-page-error-not-empty-ai-hub-stale-2872.test.tsx`):
 *   BEFORE the fix: 7 tests, 6 red, 1 green (only the silent healthy read passed).
 *   AFTER  the fix: 7 tests, 0 red, 7 green.
 *
 * The page binds `data` and `isLoading` from `useApiQuery` and never binds `error` at
 * all, so a read of `/api/tenant/ai/status` that failed was indistinguishable from a
 * day with nothing to report: `status?.draft_count_today ?? 0` printed `0`,
 * `status?.tokens_today ?? 0` printed `0`, the provider pill fell back to
 * `Object.keys(_PRESETS).length` and announced "0 / 4 providers configured", and the
 * provider-status grid rendered empty because `(status?.providers ?? [])` is empty when
 * nothing was ever read. An AI gateway that is down therefore tells the operator that no
 * AI ran today and that no provider is configured — on the page whose job is to answer
 * exactly that question.
 *
 * #2869/#2871/#2872's other AI slices (`ai/draft`, `ai/lead-scoring`, `ai/at-risk`) split
 * the two states; the hub is the last page in that folder still folding them.
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

import AIHubPage from '@/app/tenant/ai/page';

const STATUS = '/api/tenant/ai/status';

/** `/api/tenant/ai/status` answers the `Status` object directly — no `{ data }` envelope. */
const readStatus = {
  providers: [
    { id: 'openai', enabled: true, status: 'ready' },
    { id: 'anthropic', enabled: false, status: 'missing_key' },
  ],
  enabled_count: 1,
  draft_count_today: 7,
  scoring_runs_today: 12,
  at_risk_count: 2,
  tokens_today: 4190,
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** What TanStack hands the page when a refresh of a read that already succeeded fails. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('AI Hub: a status read that never answered is not a quiet day (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the counters and calls them the last read when a refresh is refused', () => {
    registry.byUrl = { [STATUS]: staleRead(readStatus) };
    wrapped(<AIHubPage />);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The outage sentence is retired: the hub did read this, it just could not refresh it.
    expect(alerts()).not.toMatch(/Failed to load the AI Hub status/i);
    // Only the "Time saved" card is a standing em dash; the read ones are numbers.
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('reports the outage instead of zeroed cards when nothing was ever read', () => {
    registry.byUrl = { [STATUS]: failed('Request failed (503)') };
    wrapped(<AIHubPage />);
    expect(alerts()).toMatch(/Failed to load the AI Hub status/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    // The four derived counters plus the provider ratio print `—`, not `0`.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(bodyText()).not.toMatch(/0 \/ 4 provider/);
    expect(screen.queryAllByText('0')).toHaveLength(0);
  });

  it('says the provider grid is unanswered rather than unconfigured', () => {
    registry.byUrl = { [STATUS]: failed('Request failed (500)') };
    wrapped(<AIHubPage />);
    expect(bodyText()).toMatch(/Provider readiness was not read/i);
    expect(bodyText()).not.toMatch(/No providers configured/i);
  });

  it('re-runs the status read from the outage banner, and issues no write', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [STATUS]: failed() };
    wrapped(<AIHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[STATUS].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('re-runs the status read from the caveat without hiding the rows it kept', () => {
    registry.byUrl = { [STATUS]: staleRead(readStatus) };
    wrapped(<AIHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[STATUS].refetch).toHaveBeenCalled();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('prints a sentence, not `undefined`, for a messageless failure', () => {
    registry.byUrl = { [STATUS]: failed('') };
    wrapped(<AIHubPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(bodyText()).not.toMatch(/undefined/);
  });

  it('stays silent for a status it read', () => {
    registry.byUrl = { [STATUS]: ok(readStatus) };
    wrapped(<AIHubPage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('7')).toBeTruthy();
    expect(bodyText()).toMatch(/configured/);
  });
});
