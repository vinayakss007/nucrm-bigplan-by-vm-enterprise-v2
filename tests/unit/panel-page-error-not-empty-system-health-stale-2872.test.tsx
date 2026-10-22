// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `/health`, the system-health console.
 *
 * Measured against `origin/main`'s copy of `app/health/page.tsx` (scratch worktree,
 * `npx vitest run tests/unit/panel-page-error-not-empty-system-health-stale-2872.test.tsx`):
 *   BEFORE the fix: 6 tests, 4 red, 2 green (the probe that answered, and the Refresh button's
 *     refetch wiring — which is why the stale case has to be tested rather than assumed).
 *   AFTER  the fix: 6 tests, 0 red, 6 green.
 *
 * One read, `/api/health`, destructured for `data`, `isLoading`, `isFetching` and `refetch`
 * — and not for `error`. Every card then defaults through `health?.x.status || 'error'`, so a
 * read that never answered renders the *worst* possible answer: a red cross on the banner,
 * "System Unhealthy", and Database, Queue, Email and Authentication each marked failed. A
 * network blip between the browser and the API is reported as an outage of the system the
 * page exists to diagnose — the inverse of the false-empty this epic is about, and worse,
 * because it is an alarm that sends someone to the DB.
 *
 * The same defaults make a refused refresh silent, too: `data` is kept, so the operator
 * cannot tell a live reading from the last one, and the "Refresh" button — which they can
 * still press, and did — looks like it did nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ??
    { data: undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import HealthPage from '@/app/health/page';

const HEALTH = '/api/health';

const greenStatus = {
    status: 'healthy',
    database: { status: 'ok', tables: 42, message: 'connected' },
    queue: { status: 'ok', provider: 'redis://queue.test', message: 'draining' },
    email: { status: 'ok', provider: 'smtp.test', message: 'ready' },
    auth: { status: 'ok', users: 7, superAdmin: true },
    worker: { status: 'ok', running: true },
};
const degradedStatus = {
    ...greenStatus,
    status: 'degraded',
    worker: { status: 'error', running: false, message: 'no worker on this host' },
};

const ok = (data: unknown): QueryResult => ({
  data, error: null, isLoading: false, isFetching: false, refetch: vi.fn(),
});
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
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

describe('system health: an unread probe is not an unhealthy system (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('retires the "Unhealthy" verdict when the probe never answered', () => {
    registry.byUrl = { [HEALTH]: failed('Request failed (503)') };
    wrapped(<HealthPage />);
    expect(alerts()).toMatch(/Could not read system health/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(bodyText()).not.toMatch(/System Unhealthy/);
    // The four component cards are defaults, not readings — they are not shown at all.
    expect(bodyText()).not.toMatch(/Queue \/ Worker/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('re-runs the probe from the outage banner, and issues no write', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [HEALTH]: failed() };
    wrapped(<HealthPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[HEALTH].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the cards a refused refresh left on screen and calls them the last read', () => {
    registry.byUrl = { [HEALTH]: staleRead(degradedStatus) };
    wrapped(<HealthPage />);
    expect(screen.getByText(/42 tables/)).toBeTruthy();
    expect(bodyText()).toMatch(/System Degraded/);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Could not read system health/i);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the Refresh control working over a stale reading', () => {
    const write = vi.fn();
    vi.stubGlobal('fetch', write);
    registry.byUrl = { [HEALTH]: staleRead(greenStatus) };
    wrapped(<HealthPage />);
    const refresh = screen.getByRole('button', { name: /^refresh$/i });
    expect(refresh.disabled).toBe(false);
    fireEvent.click(refresh);
    expect(registry.byUrl[HEALTH].refetch).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says "no response from the server" for a messageless failure, and never `undefined`', () => {
    registry.byUrl = { [HEALTH]: failed('') };
    wrapped(<HealthPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(bodyText()).not.toMatch(/undefined/);
    expect(bodyText()).not.toMatch(/System Unhealthy/);
  });

  it('shows the reading, with no alert, when the probe answered', () => {
    registry.byUrl = { [HEALTH]: ok(greenStatus) };
    wrapped(<HealthPage />);
    expect(alerts()).toBe('');
    expect(bodyText()).toMatch(/System Healthy/);
    expect(screen.getByText(/7 users/)).toBeTruthy();
  });
});
