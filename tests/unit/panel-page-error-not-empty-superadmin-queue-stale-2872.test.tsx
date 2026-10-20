// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three super-admin queue panels #2829 fixed for the *outage* half only:
 * `app/superadmin/templates`, `app/superadmin/billing/dunning`, `app/superadmin/modules`.
 *
 * All three bind `error`, all three render `InlineErrorState`, all three dash their counters on a
 * failure — and all three key every one of those decisions off the **bare flag**, which cannot tell
 * "the read never answered" from "the read answered before and the refresh just now failed".
 * TanStack keeps `data` in the second case, and `templates` (`:60`) and `dunning` (`:61`) invalidate
 * their own key after every mutation, so the second case is exactly what an operator hits while
 * watching for the effect of what they just did.
 *
 * What that costs each of them, measured on `a81a9d27` before this suite was written:
 *
 *   - `templates` deletes the catalogue it is holding and dashes four counts (Total Templates,
 *     Active, Draft, Total Assignments) that the previous read established;
 *   - `dunning` deletes the attempt rows and dashes `Pending Retries` / `Completed` / `Failed` /
 *     `Total Amount` — a money panel reporting that it cannot say how much is owed, mid-triage;
 *   - `modules` does something stranger: its empty/outage arm is a separate JSX expression from
 *     `{filtered.map(...)}`, so on a refused refresh the matrix **stays on screen** while a banner
 *     above it announces that loading the plan offerings failed, and its four cards dash anyway.
 *     That row is the mislabelled case: the panel claims an outage it did not have.
 *
 * Out of scope, named rather than absorbed: `templates` and `modules` filter their search
 * client-side (a search miss says the same sentence as an empty queue — a different lie, and
 * #2829's census pins that wording), and `modules`' bulk save (`:120`) leaves its optimistic
 * toggles in place when the server refuses them, which is a failed *write* lying about state, not a
 * failed read.
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

import TemplatesPage from '@/app/superadmin/templates/page';
import DunningPage from '@/app/superadmin/billing/dunning/page';
import ModulesPage from '@/app/superadmin/modules/page';

const TEMPLATES = '/api/superadmin/templates';
const DUNNING = '/api/superadmin/billing/dunning';
const MODULES = '/api/superadmin/modules';

const NOW = '2026-03-04T10:00:00.000Z';
const templateRows = {
  data: [
    { id: 'tpl-1', name: 'SaaS starter kit', description: 'Core objects plus pipeline', icon: 'Package', status: 'active', is_builtin: true, tenant_count: 4, modules: ['crm', 'billing'], created_at: NOW },
    { id: 'tpl-2', name: 'Fleet telemetry', description: null, icon: 'Cpu', status: 'draft', is_builtin: false, tenant_count: 1, modules: ['crm'], created_at: NOW },
  ],
};
const dunningRows = {
  data: [
    { id: 'd1', subscriptionId: 'sub-8812', attemptNumber: 2, status: 'pending', scheduledAt: NOW, executedAt: null, paymentAmount: 3400, errorMessage: null, retryCount: 1, tenant: { id: 't1', name: 'Kestrel Logistics' } },
    { id: 'd2', subscriptionId: 'sub-7741', attemptNumber: 1, status: 'completed', scheduledAt: NOW, executedAt: NOW, paymentAmount: 2300, errorMessage: 'card declined', retryCount: 0, tenant: { id: 't2', name: 'Vane Freight' } },
  ],
};
const moduleRows = {
  data: [
    { id: 'deliverability', name: 'Email deliverability', category: 'messaging', icon: '📧', description: '', features: [], total_installs: 3, pricing: { free: { enabled: false }, starter: { enabled: true, price: 20 }, pro: { enabled: true, price: 60 }, enterprise: { enabled: true, price: 120 } } },
    { id: 'warehouse-sync', name: 'Warehouse sync', category: 'integration', icon: '🔌', description: '', features: [], total_installs: 7, pricing: { free: { enabled: true }, starter: { enabled: true }, pro: { enabled: false }, enterprise: { enabled: false } } },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const outage = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state none of these three pages could reach before this slice. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** The number under a summary card's label; `up` steps over an icon row, not a card. */
const card = (label: string, up = 1) => {
  let el: Element | null = screen.getByText(label).parentElement;
  for (let i = 1; i < up; i++) el = el?.parentElement ?? null;
  return el?.textContent ?? '';
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

describe('templates: a refused refresh keeps the catalogue and keeps counting it (#2872)', () => {
  it('keeps the template cards on screen and calls them the last read, with the reason', () => {
    const result = staleRead(templateRows);
    registry.byUrl = { [TEMPLATES]: result };
    wrapped(<TemplatesPage />);
    expect(screen.getByText('SaaS starter kit')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the templates, so what is below is the last read: Request failed (504)');
    // Not "some data may be out of date": the thing at stake is the one just created.
    expect(alerts()).toMatch(/template you just created/i);
    expect(alerts()).not.toContain('Failed to load');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the four counts as numbers while the templates they belong to are on screen', () => {
    registry.byUrl = { [TEMPLATES]: staleRead(templateRows) };
    wrapped(<TemplatesPage />);
    expect(screen.queryByText('—')).toBeNull();
    expect(card('Total Templates')).toContain('2');
    expect(card('Total Assignments')).toContain('5');
  });

  it('a list that never answered is still an outage: the catalogue is unavailable, not empty', () => {
    registry.byUrl = { [TEMPLATES]: outage('Request failed (401)') };
    wrapped(<TemplatesPage />);
    expect(screen.queryByText('SaaS starter kit')).toBeNull();
    expect(screen.queryByText(/No templates yet/)).toBeNull();
    expect(alerts()).toMatch(/templates/i);
    expect(alerts()).toContain('Request failed (401)');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('says so when the read genuinely found none, and still counts what came back', () => {
    registry.byUrl = { [TEMPLATES]: ok({ data: [] }) };
    wrapped(<TemplatesPage />);
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card('Total Templates')).toContain('0');
  });
});

describe('dunning: the money panel stops calling an unread queue zero money (#2872)', () => {
  it('keeps the attempts, their statuses and the money through a refused refresh', () => {
    const result = staleRead(dunningRows);
    registry.byUrl = { [DUNNING]: result };
    wrapped(<DunningPage />);
    expect(screen.getByText('Kestrel Logistics')).toBeTruthy();
    expect(screen.getByText('card declined')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the dunning attempts, so the table below is the last read: Request failed (504)');
    expect(alerts()).toMatch(/retry you just ran/i);
    // The figure the panel exists to show, still a figure.
    expect(card('Total Amount', 2)).toContain('5,700');
    expect(card('Pending Retries', 2)).toContain('1');
    expect(screen.queryByText('—')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not hide the row retry from an operator whose read only went stale', () => {
    // #2872 rule 1 is about a read that never happened. Here the attempt is on screen with the
    // status it was read at, the route re-reads the subscription server-side and enforces the
    // retry cap (`app/api/tenant/billing/dunning/retry/route.ts`), so disabling Retry would trade
    // a stated risk for an unstated one.
    registry.byUrl = { [DUNNING]: staleRead(dunningRows) };
    wrapped(<DunningPage />);
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeTruthy();
  });

  it('still dashes all four cards and refuses a money claim for a read that never happened', () => {
    registry.byUrl = { [DUNNING]: outage('Request failed (502)') };
    wrapped(<DunningPage />);
    expect(alerts()).toMatch(/dunning/i);
    expect(alerts()).toContain('Request failed (502)');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/\$0/)).toBeNull();
    expect(screen.queryByText(/No dunning attempts found/)).toBeNull();
    expect(screen.queryByText(/last read/)).toBeNull();
  });

  it('keeps "none found" for the read that came back with nothing', () => {
    registry.byUrl = { [DUNNING]: ok({ data: [] }) };
    wrapped(<DunningPage />);
    expect(screen.getByText(/No dunning attempts found/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('modules: a refused refresh is not announced as an outage over live rows (#2872)', () => {
  it('keeps the matrix, keeps the counts, and says the matrix is the last read', () => {
    const result = staleRead(moduleRows);
    registry.byUrl = { [MODULES]: result };
    wrapped(<ModulesPage />);
    expect(screen.getByText('Email deliverability')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the plan offerings, so the matrix below is the last read: Request failed (504)');
    expect(alerts()).toMatch(/registered or repriced/i);
    expect(card('Total Modules')).toContain('2');
    expect(card('Starter')).toContain('2');
    expect(screen.queryByText('—')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not claim the plan offerings failed to load while they are on screen', () => {
    // The pre-existing shape: the outage arm is a separate expression from `filtered.map`, so a
    // refused refresh printed "Failed to load the plan offerings" above a full matrix.
    registry.byUrl = { [MODULES]: staleRead(moduleRows) };
    wrapped(<ModulesPage />);
    expect(alerts()).not.toContain('Failed to load the plan offerings');
  });

  it('keeps the outage banner for a matrix that never answered', () => {
    registry.byUrl = { [MODULES]: outage('Request failed (500)') };
    wrapped(<ModulesPage />);
    expect(screen.queryByText('Email deliverability')).toBeNull();
    expect(alerts()).toContain('Failed to load the plan offerings');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/No modules configured/)).toBeNull();
  });

  it('still reports a search miss as a search when nothing went wrong', () => {
    registry.byUrl = { [MODULES]: ok(moduleRows) };
    wrapped(<ModulesPage />);
    fireEvent.change(screen.getByPlaceholderText('Search modules...'), { target: { value: 'deliverabilityyy' } });
    expect(screen.getByText('No modules match your search')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/superadmin/templates/page.tsx',
    'app/superadmin/billing/dunning/page.tsx',
    'app/superadmin/modules/page.tsx',
  ];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+(?:\.\w+)?\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} renders the miss and the absence as the same sentence`).toMatch(/\{stale && \(/);
      // The bare flag must not survive as the thing the branches test.
      expect(src, `${f} still branches on the bare error flag`).not.toMatch(/\berror\s*\?\s*\(/);
    }
  });

  it('drives the derived numbers off the outage, not off any error', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} dashes what it just read`).not.toMatch(/error\s*\?\s*'—'/);
      expect(src, `${f} keeps a number for a queue it never read`).toMatch(/failed\s*\?\s*'—'/);
    }
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
