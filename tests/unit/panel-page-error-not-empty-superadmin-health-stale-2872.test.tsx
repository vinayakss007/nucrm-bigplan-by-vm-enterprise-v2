// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the super-admin platform-health trio: `tickets`, `errors`, `announcements`.
 *
 * All three already answer a read that **never happened** — #2829's slices gave each an outage
 * branch, and `app/superadmin/*` is where that work landed hardest. This slice answers the half
 * #2829 could not ask: what happens when a read that **answered before** fails **now**.
 *
 * TanStack keeps `data` when a refetch of a query that already succeeded fails, and all three
 * pages invalidate their own key after every mutation — `tickets` after a status change and a
 * reply, `errors` after resolve and resolve-all, `announcements` after publish, toggle and delete.
 * So the state arrives at the exact moment the operator is looking for the effect of what they
 * just did.
 *
 * Three shapes, all of which were broken here:
 *   - `tickets` and `errors` branch on the bare error flag, so a refused refresh **replaces the
 *     rows** the page is holding — the queue an agent is watching disappears;
 *   - the same bare flag drives the derived numbers: `tickets` prints `—` on all four count cards
 *     while the tickets are still on screen, and `errors` does the inverse — five cards read
 *     `s.fatal_unresolved ?? 0` with **no guard at all**, so a refused refresh reports a firm,
 *     confident zero for fatal errors the page did not count (#2829's original lie, surviving in
 *     the stale half nobody tested);
 *   - `errors` shows **Resolve All** regardless of the read. That is this epic's first honesty
 *     rule on the one control that destroys the evidence: it mass-marks resolved the queue the
 *     page cannot currently see. `announcements` keeps its rows and says nothing at all, and its
 *     own #2829 comment names the risk — a duplicate banner sent to every tenant.
 *
 * Left for the next slice, deliberately: `tickets` and `errors` filter their search client-side,
 * so a search miss still renders the same sentence as a genuinely empty queue. It is a different
 * lie (an over-specific absence, not an unread one) and #2829's census pins the current wording.
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

import TicketsPage from '@/app/superadmin/tickets/page';
import ErrorsPage from '@/app/superadmin/errors/page';
import AnnouncementsPage from '@/app/superadmin/announcements/page';

const TICKETS = '/api/superadmin/tickets?status=open';
const ERRORS = '/api/superadmin/errors?resolved=false';
const ANNOUNCEMENTS = '/api/superadmin/announcements';

const NOW = '2026-03-04T10:00:00.000Z';
const ticketRows = {
  tickets: [
    { id: 't1', subject: 'Invoice PDF will not download', status: 'open', priority: 'high', tenant_name: 'Kestrel Logistics', user_name: 'Ravi Sharma', created_at: NOW },
    { id: 't2', subject: 'WhatsApp webhook stopped firing', status: 'open', priority: 'critical', tenant_name: 'Vane Freight', user_name: 'Mira Beck', created_at: NOW },
  ],
  counts: { open: 2, in_progress: 1, resolved: 12, critical: 1 },
};
const errorRows = {
  summary: { fatal_unresolved: 3, error_unresolved: 7, warn_unresolved: 11, last_hour: 2, last_day: 26 },
  errors: [
    { id: 'e1', level: 'fatal', code: 'P1001', message: 'Connection terminated unexpectedly', created_at: NOW, resolved: false, tenant_name: 'Kestrel Logistics' },
    { id: 'e2', level: 'error', code: 'ESMTP', message: 'SMTP relay refused the message', created_at: NOW, resolved: false },
  ],
};
const announcementRows = {
  data: [
    { id: 'a1', title: 'Scheduled maintenance window', content: 'Invoices may be slow on Sunday.', type: 'update', target: 'all', is_active: true, ends_at: null },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state none of these three pages could reach before this slice. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** The number under a summary card's label. */
const card = (label: string) => {
  const head = screen.getByText(label);
  return head.parentElement?.textContent ?? '';
};

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

beforeEach(() => {
  registry.byUrl = {};
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('tickets: a refused refresh keeps the queue and keeps counting it (#2872)', () => {
  it('keeps the tickets on screen and calls them the last read, with the reason', () => {
    const result = staleRead(ticketRows);
    registry.byUrl = { [TICKETS]: result };
    wrapped(<TicketsPage />);
    expect(screen.getByText('Invoice PDF will not download')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the open tickets, so the list below is the last read: Request failed (504)');
    // Not "some data may be out of date": the ticket at stake is the one just actioned.
    expect(alerts()).toMatch(/ticket you just (replied to or moved)/i);
    expect(alerts()).not.toContain('Failed to load');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the four counts as numbers while the rows they belong to are on screen', () => {
    registry.byUrl = { [TICKETS]: staleRead(ticketRows) };
    wrapped(<TicketsPage />);
    expect(screen.queryByText('—')).toBeNull();
    expect(card('Critical')).toContain('1');
    expect(card('Resolved')).toContain('12');
  });

  it('a list that never answered is still an outage: the queue is unavailable, not empty', () => {
    registry.byUrl = { [TICKETS]: failed('Request failed (401)') };
    wrapped(<TicketsPage />);
    expect(screen.queryByText('Invoice PDF will not download')).toBeNull();
    expect(screen.queryByText(/No tickets found/)).toBeNull();
    expect(alerts()).toMatch(/tickets/i);
    expect(alerts()).toContain('Request failed (401)');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('says so when the read genuinely found none, and still counts what came back', () => {
    registry.byUrl = { [TICKETS]: ok({ tickets: [], counts: ticketRows.counts }) };
    wrapped(<TicketsPage />);
    expect(screen.getByText(/No tickets found/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card('Resolved')).toContain('12');
  });
});

describe('errors: the summary cards stop reporting zero for a queue that was not read (#2872)', () => {
  it('refuses to print five confident 0s for a read that never happened', () => {
    registry.byUrl = { [ERRORS]: failed('Request failed (500)') };
    wrapped(<ErrorsPage />);
    expect(alerts()).toContain('Failed to load the unresolved errors');
    expect(alerts()).toContain('Request failed (500)');
    // Fatal / Error / Warn / Last hour / Last 24h.
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/system is clean/)).toBeNull();
  });

  it('hides Resolve All when the queue could not be read (#2872 rule 1)', () => {
    registry.byUrl = { [ERRORS]: failed('Request failed (500)') };
    wrapped(<ErrorsPage />);
    // Mass-resolving is the one action that cannot be undone, and the page cannot see what it
    // would be marking resolved.
    expect(screen.queryByRole('button', { name: /resolve all/i })).toBeNull();
  });

  it('keeps the errors and their counts when a refresh fails, and says what is missing', () => {
    const result = staleRead(errorRows);
    registry.byUrl = { [ERRORS]: result };
    wrapped(<ErrorsPage />);
    expect(screen.getByText('Connection terminated unexpectedly')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the unresolved errors, so the list below is the last read: Request failed (504)');
    expect(alerts()).toMatch(/new errors .*not on screen/i);
    expect(screen.queryByText('—')).toBeNull();
    expect(card('Fatal')).toContain('3');
    // The action is still honest here: the queue is on screen, so what the operator resolves is
    // what they can see.
    expect(screen.getByRole('button', { name: /resolve all/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps "system is clean" for the read that came back with nothing', () => {
    registry.byUrl = { [ERRORS]: ok({ summary: errorRows.summary, errors: [] }) };
    wrapped(<ErrorsPage />);
    expect(screen.getByText(/system is clean/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card('Fatal')).toContain('3');
  });
});

describe('announcements: a refused refresh says so over the record it is showing (#2872)', () => {
  it('keeps the banners on screen and names the duplicate the operator is exposed to', () => {
    const result = staleRead(announcementRows);
    registry.byUrl = { [ANNOUNCEMENTS]: result };
    wrapped(<AnnouncementsPage />);
    expect(screen.getByText('Scheduled maintenance window')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the announcements, so what is below is the last read: Request failed (504)');
    expect(alerts()).toMatch(/duplicate/i);
    expect(alerts()).not.toContain('Could not load the announcements');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the outage sentence #2829 put there, for a read that never answered', () => {
    registry.byUrl = { [ANNOUNCEMENTS]: failed('Request failed (500)') };
    wrapped(<AnnouncementsPage />);
    expect(alerts()).toContain('Could not load the announcements');
    expect(screen.queryByText(/No announcements yet/)).toBeNull();
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('says "none" only when the record genuinely is empty', () => {
    registry.byUrl = { [ANNOUNCEMENTS]: ok({ data: [] }) };
    wrapped(<AnnouncementsPage />);
    expect(screen.getByText(/No announcements yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/superadmin/tickets/page.tsx',
    'app/superadmin/errors/page.tsx',
    'app/superadmin/announcements/page.tsx',
  ];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+(?:\.\w+)?\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} renders the miss and the absence as the same sentence`).toMatch(/\{stale && \(/);
    }
  });

  it('drives the derived numbers off the outage, not off any error', () => {
    // `error ? '—' : n` and `s.fatal ?? 0` are the two shapes that lie in opposite directions:
    // the first calls a live queue unread, the second calls an unread queue empty.
    const tickets = readFileSync(join(ROOT, 'app/superadmin/tickets/page.tsx'), 'utf8');
    expect(tickets, 'tickets still dashes its counts on a stale read').not.toMatch(/error\s*\?\s*'—'/);
    expect(tickets).toMatch(/failed\s*\?\s*'—'/);
    const errors = readFileSync(join(ROOT, 'app/superadmin/errors/page.tsx'), 'utf8');
    expect(errors, 'the summary cards print a 0 the read never established')
      .toMatch(/failed\s*\?\s*'—'\s*:\s*\(?\s?s\.\w+/);
    expect(errors, 'Resolve All is still offered over a queue the page cannot see')
      .toMatch(/!failed && \(\s*\n\s*<button[^>]*resolveAll|Resolve All/);
    expect(errors).toMatch(/resolved==='false' && !failed/);
  });

  it('keeps #2829\'s guard green, with nothing left stale and the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // #2893 emptied the list; a new offender is therefore a hard failure, and this slice adds no
    // entry of its own.
    expect(files, 'a page belongs on the baseline only if a reviewed PR says why').toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*stale && \([\s\S]*?\n\s*\)\}\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`)
        .not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
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
