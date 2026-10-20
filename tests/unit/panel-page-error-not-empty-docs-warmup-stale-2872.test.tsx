// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — fifth slice: `documents` and `settings/email/warmup`.
 *
 * The three earlier slices found panels that *deleted* their rows on a refused refresh, because
 * #2829's outage branch keyed off the bare error flag. These two fail in the opposite direction, and
 * it is the same bug: the page cannot tell "never read" from "refresh refused", so the state TanStack
 * actually leaves you in — `data` kept, `error` set — renders as if nothing happened.
 *
 *   - `documents` decides its file list by **length first**: `documents.length > 0 ?` comes before the
 *     error branch, so after an upload, a create-folder or a delete (all three invalidate this query)
 *     the last read is shown with no notice at all. For delete that is worse than silence — the file
 *     the operator just removed is still on the list, and the page's own green "Document deleted"
 *     strip agrees with it.
 *   - `warmup` renders its status from `config`, read off the same envelope. Pause/Resume invalidates
 *     the query, so when the refresh is refused the panel keeps asserting `Warmup Active` — the single
 *     fact this dashboard exists to report — with nothing saying it is the last read.
 *   - `warmup`'s header also renders "Setup Warmup" on `!config` while the body says the setup could
 *     not be read: an invitation to configure from scratch something that may be sitting there
 *     running. #2852 found exactly this trap on territories ("invited to rebuild it"); here it took a
 *     second read of the branch order to see it.
 *
 * Both pages also interpolate a raw `error.message` into their sentence, so a rejection that is not an
 * `Error` prints `undefined` where the sibling pages print `no response from the server`.
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
  usePathname: () => '/tenant',
}));

import DocumentsPage from '@/app/tenant/documents/page';
import WarmupDashboardPage from '@/app/tenant/settings/email/warmup/page';

/** Exactly as each page builds it — at the root `documents` still appends the `?`. */
const DOCS = '/api/tenant/documents?';
const WARMUP = '/api/tenant/email-warmup';

const NOW = '2026-03-04T10:00:00.000Z';
const docRows = {
  data: {
    documents: [
      { id: 'd1', name: 'Q4-drill-report.pdf', mimeType: 'application/pdf', sizeBytes: 20480, uploadedBy: 'u1', createdAt: NOW, folderId: null },
      { id: 'd2', name: 'site-map.png', mimeType: 'image/png', sizeBytes: 1024, uploadedBy: 'u1', createdAt: NOW, folderId: null },
    ],
    folders: [{ id: 'f1', name: 'Surveys', parentId: null, createdAt: NOW }],
  },
};
const warmActive = {
  config: {
    id: 'w1', isActive: true, dailyLimitStart: 5, dailyLimitCurrent: 12, dailyLimitMax: 50,
    rampUpDays: 21, fromEmail: 'warm@example.test', fromName: 'Warmup', startedAt: NOW,
    lastWarmupAt: NOW, totalSent: 148, totalReplied: 22,
  },
  pool: [{ id: 'pp1', participantEmail: 'peer@example.test', participantName: 'Peer', status: 'active', lastSentAt: NOW, lastRepliedAt: null, sentCount: 7, replyCount: 1 }],
};
const warmUnconfigured = { config: null, pool: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could name before this slice. */
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

describe('documents: a refused refresh says so instead of agreeing with the list (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('names the listing the last read instead of showing it as current', () => {
    registry.byUrl = { [DOCS]: staleRead(docRows) };
    wrapped(<DocumentsPage />);
    expect(screen.getByText('Q4-drill-report.pdf')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh this folder');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence is gone: the folder is not unread, the refresh was.
    expect(alerts()).not.toContain('Failed to load this folder');
  });

  it('warns about the one case silence actually costs: a delete that did not come back', () => {
    // Upload, create-folder and delete all invalidate this query, so this is the ordinary state right
    // after the operator acted. Without the banner the page lists the removed file and its green
    // "Document deleted" strip agrees with the list.
    registry.byUrl = { [DOCS]: staleRead(docRows) };
    wrapped(<DocumentsPage />);
    expect(alerts()).toMatch(/A file you just deleted may still appear here/);
  });

  it('binds the last-read banner to the folder query, so Try again re-runs the read that failed', () => {
    const result = staleRead(docRows);
    registry.byUrl = { [DOCS]: result };
    wrapped(<DocumentsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the folders the last read named, and says they are the last read too', () => {
    registry.byUrl = { [DOCS]: staleRead(docRows) };
    wrapped(<DocumentsPage />);
    expect(screen.getByText('Surveys')).toBeTruthy();
    expect(alerts()).toContain('what is listed below is the last read');
  });

  it('a folder that never answered is an outage, and never "No documents yet"', () => {
    registry.byUrl = { [DOCS]: failed('Request failed (500)') };
    wrapped(<DocumentsPage />);
    expect(screen.queryByText('Q4-drill-report.pdf')).toBeNull();
    expect(screen.queryByText('No documents yet')).toBeNull();
    expect(alerts()).toContain('Failed to load this folder');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('says so when a folder genuinely has nothing in it', () => {
    registry.byUrl = { [DOCS]: ok({ data: { documents: [], folders: [] } }) };
    wrapped(<DocumentsPage />);
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a sentence, not the word undefined, when the rejection has no message', () => {
    registry.byUrl = { [DOCS]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    wrapped(<DocumentsPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('warmup: the status banner stops asserting a state the server refused to confirm (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the dashboard and labels the status as the last read', () => {
    const result = staleRead(warmActive);
    registry.byUrl = { [WARMUP]: result };
    wrapped(<WarmupDashboardPage />);
    // Pause/Resume invalidates WARMUP_QUERY, so this is the state right after the operator clicked it.
    expect(screen.getByText('Warmup Active')).toBeTruthy();
    expect(screen.getByText('Emails Sent')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh your warmup setup');
    expect(alerts()).toContain('the status below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('still counts the pool it holds under a stale read', () => {
    registry.byUrl = { [WARMUP]: staleRead(warmActive) };
    wrapped(<WarmupDashboardPage />);
    expect(screen.getByText(/Warmup Pool \(1 participants\)/)).toBeTruthy();
    expect(screen.getByText('peer@example.test')).toBeTruthy();
  });

  it('a setup that never answered is an outage, not "No warmup configured"', () => {
    registry.byUrl = { [WARMUP]: failed('Request failed (500)') };
    wrapped(<WarmupDashboardPage />);
    expect(screen.queryByText('No warmup configured')).toBeNull();
    expect(alerts()).toContain('Failed to load your warmup setup');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('does not offer to set warmup up from scratch while its setup is unread', () => {
    // The header button keyed off `!config` alone, so during an outage the body said "could not be
    // read" while the header invited the operator to configure a setup that may be running.
    registry.byUrl = { [WARMUP]: failed('Request failed (500)') };
    wrapped(<WarmupDashboardPage />);
    // Header CTA and the empty-state CTA both disappear: during an outage neither knows whether
    // there is a setup to configure.
    expect(screen.queryAllByRole('button', { name: /setup warmup/i })).toHaveLength(0);
  });

  it('keeps the setup button for a tenant the last read says is unconfigured', () => {
    registry.byUrl = { [WARMUP]: staleRead(warmUnconfigured) };
    wrapped(<WarmupDashboardPage />);
    expect(screen.getByText('No warmup configured')).toBeTruthy();
    // Header CTA + the empty state's own CTA — both legitimate, because the last read did say
    // "unconfigured"; only the refresh is in doubt, and the banner above says so.
    expect(screen.getAllByRole('button', { name: /setup warmup/i })).toHaveLength(2);
    expect(alerts()).toContain('Could not refresh your warmup setup');
  });

  it('says so when a successful read genuinely found no warmup configured', () => {
    registry.byUrl = { [WARMUP]: ok(warmUnconfigured) };
    wrapped(<WarmupDashboardPage />);
    expect(screen.getByText('No warmup configured')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /setup warmup/i })).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/documents/page.tsx', 'app/tenant/settings/email/warmup/page.tsx'];

  it('splits the two states apart on both pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/\bfailed \?/);
    }
  });

  it('does not let an unread read drive an action button', () => {
    // `warmup`'s header keyed on `!config` — with no data that is true, so the outage page offered to
    // "Setup Warmup" while saying the setup could not be read. The gate has to stay.
    const src = readFileSync(join(ROOT, 'app/tenant/settings/email/warmup/page.tsx'), 'utf8');
    expect(src).toMatch(/\{!config && !failed && \(/);
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each had to undo.
    expect(files.length).toBeLessThanOrEqual(20);
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
    // The guard asks whether the file binds an error and renders one failure affordance. Both pages
    // did that before this slice — which is why neither is on the baseline, and why the silence
    // direction of this bug needed a separate epic to be noticed at all.
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
    // `documents` puts `documents.length > 0` ahead of its error branch, so a page that *looks* fully
    // guarded reports the last read as current. Rewinding the outage test to the bare flag leaves the
    // guard, the file-size ratchet and every #2829 assertion green — this is what #2872 is for.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src.replace(/\bfailed \?/g, 'errorFlag ?').replace(/const failed = [^\n]*\n/g, '');
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
