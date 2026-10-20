// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three `settings/webhooks` pages, first slice of the follow-on epic.
 *
 * #2829's slices each asked one question: does a page answer a **refused read** with a
 * "there are none" sentence? Every page in this slice already passed that test. The
 * question they all still fail is the second half, which #2869 (PR #2870) and #2868
 * (PR #2871) hit on the way and which #2872 measures across `app/`: a read that answered
 * **before** and fails **now**. TanStack keeps `data` when a refetch of a query that
 * already succeeded fails, so a page branching on the error flag alone spends the
 * ordinary post-save state replacing the rows on screen with an outage banner — and the
 * rows are the thing the save was supposed to change.
 *
 * `lib/query/client.tsx:51-52` sets `refetchOnWindowFocus: false` and `retry: 2`. This is
 * not background revalidation flickering: the state arrives only after two retries have
 * failed, which is exactly when the operator has just pressed something.
 *
 *   - `webhooks/page.tsx` — create, edit, the `is_active` toggle, delete and test all
 *     call `invalidate()`. Toggling an endpoint and then being told the roster cannot be
 *     loaded is the worst available answer, and a signing secret shown once was gone with
 *     the rows.
 *   - `dlq/page.tsx` — inverted by accident: the banner only rendered inside
 *     `entries.length === 0`, so a failed refresh kept the rows and said nothing. Retry an
 *     entry and the row sits there looking untouched; the operator cannot tell a refused
 *     refresh from a retry that did nothing, so they press it again.
 *   - `logs/page.tsx` — a delivered retry invalidates the key, so the table went blank on
 *     the delivery the retry was supposed to prove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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

import WebhooksPage from '@/app/tenant/settings/webhooks/page';
import DlqPage from '@/app/tenant/settings/webhooks/dlq/page';
import LogsPage from '@/app/tenant/settings/webhooks/logs/page';

const ROSTER = '/api/tenant/webhooks';
const DLQ = '/api/tenant/webhooks/dlq?page=1&limit=20';
const LOGS = '/api/tenant/webhooks/logs?page=1&limit=20';

const NOW = '2026-03-04T10:00:00.000Z';
const rosterRows = {
  data: [
    { id: 'w1', name: 'Zapier lead feed', url: 'https://hooks.example/zapier', events: ['lead.created'], is_active: true, failed_count: 0, createdAt: NOW },
    { id: 'w2', name: 'Billing sink', url: 'https://hooks.example/billing', events: ['invoice.paid'], is_active: false, failed_count: 3, createdAt: NOW },
  ],
};
const dlqRows = {
  data: [{ id: 'd1', jobType: 'webhook:deliver', queueName: 'webhooks', status: 'failed', errorMessage: 'HTTP 502 from sink', failedAt: NOW, payload: '{"event":"lead.created"}' }],
  total: 1,
};
const logRows = {
  data: [
    { id: 'l1', eventType: 'lead.created', url: 'https://hooks.example/zapier', status: 'failed', responseCode: 502, durationMs: 412, createdAt: NOW },
    { id: 'l2', eventType: 'invoice.paid', url: 'https://hooks.example/billing', status: 'delivered', responseCode: 200, durationMs: 88, createdAt: NOW },
  ],
  total: 2,
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state none of these pages could reach before this slice. */
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

describe('webhook roster: a failed refresh keeps the endpoints the operator is managing (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the rows and calls them the last read', () => {
    registry.byUrl = { [ROSTER]: staleRead(rosterRows) };
    wrapped(<WebhooksPage />);
    expect(screen.getByText('Zapier lead feed')).toBeTruthy();
    expect(screen.getByText('Billing sink')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // Not the outage sentence: the roster is on screen, it just stopped updating.
    expect(alerts()).not.toMatch(/Failed to load your webhooks/i);
    expect(screen.queryByText('No webhooks')).toBeNull();
  });

  it('leaves the toggle reachable, which is the action that caused the state', () => {
    registry.byUrl = { [ROSTER]: staleRead(rosterRows) };
    wrapped(<WebhooksPage />);
    // Both endpoints still have their controls; the row that is disabled reads disabled.
    expect(screen.getAllByRole('button', { name: /disable|enable/i }).length).toBeGreaterThan(0);
  });

  it('reports the outage instead of a roster when nothing was ever read', () => {
    registry.byUrl = { [ROSTER]: failed('Request failed (503)') };
    wrapped(<WebhooksPage />);
    expect(alerts()).toMatch(/Failed to load your webhooks/i);
    expect(alerts()).toMatch(/Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.queryByText('Zapier lead feed')).toBeNull();
    expect(screen.queryByText('No webhooks')).toBeNull();
  });

  it('says "No webhooks" with no alert when the read answered with none', () => {
    registry.byUrl = { [ROSTER]: ok({ data: [] }) };
    wrapped(<WebhooksPage />);
    expect(screen.getByText('No webhooks')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('shows nothing alarming for a roster it read', () => {
    registry.byUrl = { [ROSTER]: ok(rosterRows) };
    wrapped(<WebhooksPage />);
    expect(alerts()).toBe('');
    expect(screen.getByText('Zapier lead feed')).toBeTruthy();
  });

  it('re-runs the roster read from the stale banner', () => {
    registry.byUrl = { [ROSTER]: staleRead(rosterRows) };
    wrapped(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ROSTER].refetch).toHaveBeenCalled();
  });
});

describe('dead letter queue: a failed refresh says so over the backlog instead of sitting silent (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the entries and says the retry you just ran may already have taken', () => {
    registry.byUrl = { [DLQ]: staleRead(dlqRows) };
    wrapped(<DlqPage />);
    expect(screen.getByText('webhook:deliver')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    // The gap this slice closes: the rows survived, so the page claimed nothing was wrong.
    expect(alerts()).toMatch(/retry you just ran/i);
    expect(screen.queryByText('No dead letter entries')).toBeNull();
  });

  it('still offers the retry controls on the rows it kept', () => {
    registry.byUrl = { [DLQ]: staleRead(dlqRows) };
    wrapped(<DlqPage />);
    expect(screen.getByRole('button', { name: /retry all pending/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^retry$/i }).length).toBeGreaterThan(0);
  });

  it('reports the outage in the sentence #2829 established when nothing was read', () => {
    registry.byUrl = { [DLQ]: failed('Request failed (500)') };
    wrapped(<DlqPage />);
    expect(alerts()).toMatch(/Could not load the dead letter queue/);
    expect(alerts()).toMatch(/not an empty queue/i);
    expect(alerts()).toMatch(/Request failed \(500\)/);
    expect(screen.queryByText('No dead letter entries')).toBeNull();
  });

  it('calls a last-read empty queue empty, rather than a failed request', () => {
    // The old branch put the outage sentence here whenever the list was empty, which a
    // refused refresh over an empty last read satisfies — so an operator who had just
    // cleared the queue was told the request failed.
    registry.byUrl = { [DLQ]: staleRead({ data: [], total: 0 }) };
    wrapped(<DlqPage />);
    expect(screen.getByText('No dead letter entries')).toBeTruthy();
    expect(alerts()).not.toMatch(/not an empty queue/i);
    expect(alerts()).toMatch(/last read/i);
  });

  it('says the queue is empty, with one alert-free screen, when it read that', () => {
    registry.byUrl = { [DLQ]: ok({ data: [], total: 0 }) };
    wrapped(<DlqPage />);
    expect(screen.getByText('No dead letter entries')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('delivery logs: a delivered retry does not wipe the delivery it proves (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the log rows and marks them the last read', () => {
    registry.byUrl = { [LOGS]: staleRead(logRows) };
    wrapped(<LogsPage />);
    expect(screen.getAllByText('lead.created').length).toBeGreaterThan(0);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/Failed to load the delivery logs/i);
    expect(screen.queryByText('No delivery logs')).toBeNull();
  });

  it('reports the outage over an empty screen when the first read refused', () => {
    registry.byUrl = { [LOGS]: failed('Request failed (502)') };
    wrapped(<LogsPage />);
    expect(alerts()).toMatch(/Failed to load the delivery logs/i);
    expect(alerts()).toMatch(/Request failed \(502\)/);
    expect(screen.queryByText('No delivery logs')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('says no logs have arrived, with no alert, when that is what it read', () => {
    registry.byUrl = { [LOGS]: ok({ data: [], total: 0 }) };
    wrapped(<LogsPage />);
    expect(screen.getByText('No delivery logs')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('re-runs the log read, and not the roster read a sibling page shares the key with', () => {
    registry.byUrl = { [LOGS]: failed(), [ROSTER]: staleRead(rosterRows) };
    wrapped(<LogsPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /delivery logs/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[LOGS].refetch).toHaveBeenCalled();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/webhooks/page.tsx',
    'app/tenant/settings/webhooks/dlq/page.tsx',
    'app/tenant/settings/webhooks/logs/page.tsx',
  ];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w*[Ee]rror\) && !/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/&& Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} routes a read failure through a toast`).not.toMatch(/if \(\w*[Ee]rror\)\s*toast\.error/);
    }
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866
    // each had to undo.
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks whether the file binds an error and renders one failure affordance.
    // All three pages did that before this slice — which is why they were never on the
    // baseline, and why `stale` needs a suite of its own rather than another #2829 slice.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const withoutStale = readFileSync(join(ROOT, f), 'utf8')
        .replace(/\{\s*stale && \([\s\S]*?\)\s*\}\n/g, '')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block moved shape, update this check`)
        .not.toBe(readFileSync(join(ROOT, f), 'utf8'));
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
    }
  });

  it('holds the roster page at the size ceiling it is sitting on', () => {
    // `webhooks/page.tsx` is now exactly at MAX_LINES. The next slice that needs a line
    // here has to split the component first — the way #2829 handles `pipelines`, which is
    // blocked at 502/502. Asserting the ceiling keeps that from being a surprise.
    const lines = readFileSync(join(ROOT, 'app/tenant/settings/webhooks/page.tsx'), 'utf8').split('\n').length - 1;
    expect(lines).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
