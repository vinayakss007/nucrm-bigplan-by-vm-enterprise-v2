// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/sla/page.tsx` and `app/tenant/esignature/page.tsx`.
 *
 * Both pages were the toast-only shape: `if (error) toast.error(...)` in the render
 * body over a list that said nothing about the failure. TanStack Query keeps `data`
 * when a refetch of a read that already succeeded fails, and on both pages the
 * operator's own write is what produces that revalidation:
 *
 * - `settings/sla` — create, edit, toggle and remove all call `reload()`, which
 *   invalidates `['tenant', 'sla']`, the exact key of this view. Once the four-second
 *   toast faded, the page answered the refused refresh with "No SLA policies" — or,
 *   if rows had loaded earlier, kept the table with no sign the refresh was refused.
 * - `tenant/esignature` — creating a signing request invalidates the
 *   `['tenant', 'esignature']` prefix, which matches the current view's key
 *   `['tenant', 'esignature', { filter }]`. The rows carry the damage: an envelope
 *   the signer has since viewed, signed or declined kept showing its old status, and
 *   a just-created request was answered for with "No signing requests".
 *
 * The filter is part of the esignature query key, so a view that never answered is
 * `failed` — an outage card — and never a "last read" of some other tab; that page
 * gets a case for exactly that hop.
 *
 * Neither page has an aggregate derived figure: the SLA breach badge and the
 * signer count are read off the rows themselves, so they only render over rows in
 * hand; the kept-read cases pin that those figures survive, and the outage cases
 * pin that no table — and no absence sentence — renders at all.
 *
 * No suite outside this one mounts either page (`grep` for the page paths in
 * `tests/` finds nothing), so the overlap-hygiene ratchet below asserts that no
 * existing panel suite starts importing them.
 *
 * RED AT BASE. On `origin/main` with the two product files untouched and this file as
 * committed: 16 of the 23 cases fail — every kept-read and outage case on both pages
 * (7 SLA, 6 esignature) and the 3 ratchet cases that read the source for the split and
 * for the gone render-body toast. The other 7 — genuine-empty and clean-success controls
 * on both pages, and the guard/baseline/size pins the fixed files must keep green — pass
 * at base and must keep passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
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

import toast from 'react-hot-toast';
import EsignaturePage from '@/app/tenant/esignature/page';
import SlaPage from '@/app/tenant/settings/sla/page';

const SLA = '/api/tenant/sla';
// The page builds `/api/tenant/esignature?${params}` — the `all` view keeps the
// bare `?`, and each status view carries its own key and URL.
const ES_ALL = '/api/tenant/esignature?';
const ES_SENT = '/api/tenant/esignature?status=sent';

const NOW = '2026-04-15T09:00:00.000Z';
const slaRows = {
  data: [
    { id: 'sla-1', name: 'Critical response', priority: 'critical', responseTimeMinutes: 60, resolutionTimeMinutes: 240, escalationRules: [], isActive: true, createdAt: NOW, breachCount: 3 },
    { id: 'sla-2', name: 'Low queue review', priority: 'low', responseTimeMinutes: 480, resolutionTimeMinutes: 1440, escalationRules: [], isActive: false, createdAt: NOW, breachCount: 0 },
  ],
};
const esRows = {
  data: [
    { id: 'es-1', documentId: 'doc-41', provider: 'internal', status: 'sent', signers: [{ name: 'Ada Operator', email: 'ada@acme.test' }], metadata: {}, createdAt: NOW },
    { id: 'es-2', documentId: 'doc-42', provider: 'docusign', status: 'signed', signers: [{ name: 'Ada Operator', email: 'ada@acme.test' }, { name: 'Sam Buyer', email: 'sam@acme.test' }], metadata: {}, createdAt: NOW },
  ],
};
const esSentRows = { data: [esRows.data[0]] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  vi.clearAllMocks();
  return render(tree(node));
};

describe('settings/sla: a refused reload after a write keeps the policies (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [SLA]: staleRead(slaRows) }; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('keeps both policies, their breach badges and their controls, and says last read', () => {
    wrapped(<SlaPage />);
    expect(screen.getByText('Critical response')).toBeTruthy();
    expect(screen.getByText('Low queue review')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The absence sentence would answer a refused refresh with "there are none",
    // and the outage copy would answer it with an outage that did not happen.
    expect(screen.queryByText('No SLA policies')).toBeNull();
    expect(alerts()).not.toMatch(/Failed to load SLA policies/);
    // A kept read the operator cannot act on is not kept: create/edit/toggle/remove
    // all invalidate this read, so removal in particular must stay reachable.
    const row = screen.getByText('Critical response').closest('tr');
    expect(row, 'the kept row lost its table row').not.toBeNull();
    expect(row!.querySelectorAll('button').length).toBe(3);
    // The durable channel is the banner; no toast carries the page state any more.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('re-runs the policies read from the caveat', () => {
    wrapped(<SlaPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SLA].refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the outage for a read that never answered, and never the absence sentence', () => {
    registry.byUrl = { [SLA]: failed('Request failed (503)') };
    wrapped(<SlaPage />);
    expect(alerts()).toMatch(/Failed to load SLA policies: Request failed \(503\)/);
    expect(screen.queryByText('No SLA policies')).toBeNull();
    expect(screen.queryByText('Critical response')).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [SLA]: failed('') };
    wrapped(<SlaPage />);
    expect(alerts()).toMatch(/Failed to load SLA policies: no response from the server/);
  });

  it('names the server in the caveat when a kept read is refused without a message', () => {
    registry.byUrl = { [SLA]: staleRead(slaRows, '') };
    wrapped(<SlaPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Critical response')).toBeTruthy();
  });

  it('says none exist, with no alert, when that is what came back', () => {
    registry.byUrl = { [SLA]: ok({ data: [] }) };
    wrapped(<SlaPage />);
    expect(screen.getByText('No SLA policies')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { [SLA]: staleRead({ data: [] }) };
    wrapped(<SlaPage />);
    expect(screen.getByText('No SLA policies')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('shows rows with no alert when the read answers', () => {
    registry.byUrl = { [SLA]: ok(slaRows) };
    wrapped(<SlaPage />);
    expect(screen.getByText('Critical response')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('walks the toggle path: good read, refused reload, good read again', () => {
    registry.byUrl = { [SLA]: ok(slaRows) };
    const view = wrapped(<SlaPage />);
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [SLA]: staleRead(slaRows) };
    view.rerender(tree(<SlaPage />));
    expect(screen.getByText('Critical response')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);

    registry.byUrl = { [SLA]: ok(slaRows) };
    view.rerender(tree(<SlaPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('tenant/esignature: a refused reload after a create keeps the requests (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ES_ALL]: staleRead(esRows) }; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('keeps both envelopes and their statuses, and says the statuses are old', () => {
    wrapped(<EsignaturePage />);
    expect(screen.getByText('doc-41')).toBeTruthy();
    expect(screen.getByText('doc-42')).toBeTruthy();
    expect(screen.getAllByText('sent').length).toBe(1);
    expect(screen.getAllByText('signed').length).toBe(1);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/old status/);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(screen.queryByText('No signing requests')).toBeNull();
    expect(alerts()).not.toMatch(/Failed to load signing requests/);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('re-runs the requests read from the caveat, and only that read', () => {
    registry.byUrl = { [ES_ALL]: staleRead(esRows), [ES_SENT]: ok(esSentRows) };
    wrapped(<EsignaturePage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ES_ALL].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[ES_SENT].refetch).not.toHaveBeenCalled();
  });

  it('shows the outage for a read that never answered, and never the absence sentence', () => {
    registry.byUrl = { [ES_ALL]: failed('Request failed (503)') };
    wrapped(<EsignaturePage />);
    expect(alerts()).toMatch(/Failed to load signing requests: Request failed \(503\)/);
    expect(screen.queryByText('No signing requests')).toBeNull();
    expect(screen.queryByText('doc-41')).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [ES_ALL]: failed('') };
    wrapped(<EsignaturePage />);
    expect(alerts()).toMatch(/Failed to load signing requests: no response from the server/);
  });

  it('says none exist, with no alert, when that is what came back', () => {
    registry.byUrl = { [ES_ALL]: ok({ data: [] }) };
    wrapped(<EsignaturePage />);
    expect(screen.getByText('No signing requests')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { [ES_ALL]: staleRead({ data: [] }) };
    wrapped(<EsignaturePage />);
    expect(screen.getByText('No signing requests')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('shows rows with no alert when the read answers', () => {
    registry.byUrl = { [ES_ALL]: ok(esRows) };
    wrapped(<EsignaturePage />);
    expect(screen.getByText('doc-42')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('an unviewed filter tab is an outage, not a last read of the tab it replaced', () => {
    // The filter is part of the query key, so the `sent` view has never answered;
    // a refusal there must not be dressed up as the `all` view's kept rows.
    registry.byUrl = { [ES_ALL]: ok(esRows), [ES_SENT]: failed('Request failed (503)') };
    wrapped(<EsignaturePage />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sent' }));
    expect(alerts()).toMatch(/Failed to load signing requests: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('doc-42')).toBeNull();
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const SLA_FILE = 'app/tenant/settings/sla/page.tsx';
  const ES_FILE = 'app/tenant/esignature/page.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the two states on both pages instead of branching on one flag', () => {
    for (const f of [SLA_FILE, ES_FILE]) {
      const s = src(f);
      expect(s, `${f} never learned the difference`).toMatch(/Boolean\(error\) && !data/);
      expect(s, `${f} has no kept-read branch`).toMatch(/Boolean\(error\) && Boolean\(data\)/);
      expect(s, `${f} prints a raw error that can be undefined`)
        .toMatch(/error\?\.message \|\| 'no response from the server'/);
      expect(s, `${f} lost its caveat`).toMatch(/\{stale && \(/);
      expect(s, `${f} still branches the list on the bare flag`).not.toMatch(/\)\s*:\s*error \? \(/);
    }
  });

  it('took the page state away from the fading toast', () => {
    for (const f of [SLA_FILE, ES_FILE]) {
      expect(src(f), `${f} still carries a page state on a four-second toast`)
        .not.toMatch(/^\s*if \(error\) toast\.error/m);
    }
  });

  it('reports both pages clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewind = /const failed = Boolean\(error\) && !data;\s*\n\s*const stale = Boolean\(error\) && Boolean\(data\);/;
    for (const f of [SLA_FILE, ES_FILE]) {
      const s = src(f);
      expect(s, `${f}: the shape this slice depends on moved`).toMatch(rewind);
      expect(inspect(f, s).offends, `${f} was already on the guard's list`).toBe(false);
      expect(
        inspect(f, s.replace(rewind, 'const failed = Boolean(error);\n  const stale = false;')).offends,
        `${f}: the guard would catch this rewind after all`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, not a count — #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    for (const f of [SLA_FILE, ES_FILE]) expect(files, `${f} went on the list`).not.toContain(f);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [SLA_FILE, ES_FILE]) {
      expect(src(f).split('\n').length, `${f} is past the ceiling`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('is the only suite that mounts these two pages', () => {
    // Overlap hygiene: an existing #2829/#2872 suite must not start speaking about
    // a kept read for these pages — there is none, and this keeps it that way.
    const others = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx') && !f.includes('sla-signature-stale-2872'));
    for (const f of others) {
      const s = readFileSync(join(ROOT, 'tests/unit', f), 'utf8');
      expect(s, `${f} also mounts one of these pages; reconcile the two suites`)
        .not.toMatch(/settings\/sla\/page|tenant\/esignature\/page/);
    }
  });
});
