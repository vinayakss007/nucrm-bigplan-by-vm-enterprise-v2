// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, super-admin slice — the four `app/superadmin/*` panels that answered a refused read
 * with a claim about the whole platform.
 *
 * The tenant slices had one mitigating fact: a tenant who cannot read their own invoices is
 * looking at their own screen. These four are the operator's screens, and they are where a
 * false "there are none" is load-bearing:
 *
 *   - `tickets` printed `Open 0 · In Progress 0 · Resolved 0 · Critical 0` with a green
 *     checkmark and "No tickets found" when `/api/superadmin/tickets` was unread. Support
 *     volume is the one number that decides whether anyone looks; the panel answered a 500
 *     with "nobody needs help".
 *   - `billing/dunning` printed `Pending Retries 0 · Completed 0 · Failed 0 · Total Amount $0`
 *     over an unread dunning queue — the operator's whole picture of who has stopped paying,
 *     and `$0` is the loudest possible "nothing owed".
 *   - `modules` never bound `error` at all, and its seeding `useEffect` only fires on
 *     `data?.data`, so a refused read left `modules` at `[]`: "No modules configured" plus a
 *     stats row of zeros. Worse, the page is an editable form — a roster of every plan switch
 *     rendered OFF is one `Save` away from writing an all-OFF offering policy over the real one.
 *   - `templates` printed `Total Templates 0 · Active 0 · Draft 0 · Total Assignments 0` and
 *     "No templates yet. Create your first one." — on the screen that decides what new tenants
 *     get provisioned from.
 *
 * Each of them bound `error` and routed it to a `useEffect` toast (or, in `modules`, not at
 * all), which is the second half of the accident #2829 is about: the toast speaks for four
 * seconds and the false sentence stays on the screen.
 *
 * The fix is an in-place `<InlineErrorState>` with the page's own `refetch` behind it, and the
 * derived numbers gated to `—` — not an early return, because the operator still needs the
 * header, the filters and `Create New` to work while one read is down. `modules` is the
 * exception: its body IS the form, so the banner replaces the matrix and no switch is left to
 * arm.
 *
 * The opposite half is asserted too, because the cheap version of this fix trades one lie for
 * another. All three of these panels filter what they already loaded (`tickets` search,
 * `dunning` status tabs, `modules` search), so a miss must stay a miss and not become a fake
 * outage — and all three invalidate their own query after a mutation (`tickets` on every status
 * change and reply, `templates` on create, `dunning` on retry), so a *refresh* can fail with the
 * earlier read still in hand. Answering that with the never-read banner would hide a queue that
 * is on screen and correct-but-possibly-stale; the pages distinguish the three states, and the
 * cases below pin each one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import DunningPage from '@/app/superadmin/billing/dunning/page';
import ModulesPage from '@/app/superadmin/modules/page';
import TemplatesPage from '@/app/superadmin/templates/page';
import TicketsPage from '@/app/superadmin/tickets/page';

const URLS = {
  dunning: '/api/superadmin/billing/dunning',
  modules: '/api/superadmin/modules',
  templates: '/api/superadmin/templates',
  // `tickets` is filtered server-side by status, and its default tab is `open`.
  tickets: '/api/superadmin/tickets?status=open',
} as const;

const NOW = new Date().toISOString();

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});

const ATTEMPTS = [{
  id: 'd1', subscriptionId: 'sub_2f', attemptNumber: 2, status: 'pending',
  scheduledAt: NOW, executedAt: null, paymentAmount: 40, errorMessage: null, retryCount: 1,
  tenant: { name: 'Northwind Ltd', id: 'tn1' },
}, {
  id: 'd2', subscriptionId: 'sub_9c', attemptNumber: 1, status: 'completed',
  scheduledAt: NOW, executedAt: NOW, paymentAmount: 10, errorMessage: null, retryCount: 0,
  tenant: { name: 'Cobalt Systems', id: 'tn2' },
}];

const MODULE = {
  id: 'sms', name: 'SMS Gateway', icon: '💬', description: 'Send SMS to contacts',
  category: 'messaging', features: ['Templates', 'Opt-out', 'Scheduler', 'Logs', 'Shortlinks'],
  total_installs: 4,
  pricing: {
    free: { enabled: false },
    starter: { enabled: true, price: 10 },
    pro: { enabled: true, price: 25 },
    enterprise: { enabled: true, price: 99 },
  },
};

const TEMPLATE = {
  id: 'tpl1', name: 'Agency Suite', description: 'Fields, pipeline and automations for agencies',
  icon: '📦', status: 'active', is_builtin: false, tenant_count: 3,
  modules: ['leads', 'deals'], created_at: NOW,
};

const TICKETS = {
  tickets: [{
    id: 't1', subject: 'Domain transfer stuck', message: 'It has been three days.',
    status: 'open', priority: 'normal', tenant_name: 'Northwind Ltd',
    user_name: 'Ada', user_email: 'ada@northwind.test', admin_reply: null, created_at: NOW,
  }],
  counts: { open: 2, in_progress: 1, resolved: 4, critical: 1 },
};

const withFailure = (base: Record<string, QueryResult>, url: string): Record<string, QueryResult> => ({
  ...base,
  [url]: failed('Request failed (500) — RLS refused the read'),
});

/**
 * The other half of the state machine: these panels invalidate on their own mutations (every
 * ticket status change, every reply, every template created), so a refresh can fail while the
 * earlier read is still in hand. Answering that by swapping the queue for a banner would fix a
 * false absence with a false "there is nothing here to look at".
 */
const withRefreshFailure = (row: Record<string, QueryResult>, url: string): Record<string, QueryResult> => ({
  ...row,
  [url]: { ...row[url], error: new Error('Request failed (500) — the pool went away') },
});

const registryFor = (state: Record<string, QueryResult>) => {
  for (const key of Object.keys(registry.byUrl)) delete registry.byUrl[key];
  Object.assign(registry.byUrl, state);
};

const wrap = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

/**
 * The text of the card a label sits in — `depth` steps up from the label element.
 *
 * `dunning` needs the `selector`: its status tabs are literally labelled "Completed" and
 * "Failed", the same words two of its summary cards use, and the tabs survive a failed read
 * because they are the operator's controls, not its data.
 */
const card = (label: string, depth = 1, selector?: string) => {
  let el: HTMLElement | null = screen.getByText(label, selector ? { selector } : {}).parentElement;
  for (let step = 1; step < depth && el; step++) el = el.parentElement;
  return el?.textContent ?? '';
};

beforeEach(() => registryFor({}));

type Panel = {
  key: string;
  Page: () => ReactNode;
  failUrl: string;
  /** what the banner must say */
  phrase: string;
  /** the sentence the panel prints when the platform really has none */
  sentence: string;
  /** registry for a successful-but-empty render */
  empty: Record<string, QueryResult>;
  /** registry for a render with real rows */
  row: Record<string, QueryResult>;
  rowText: string;
  /** the derived numbers a failed read used to report as 0 / $0 */
  stats: { label: string; depth: number; real: string; selector?: string }[];
};

const PANELS: Panel[] = [
  {
    key: 'billing/dunning',
    Page: DunningPage,
    failUrl: URLS.dunning,
    phrase: 'Failed to load the failed-payment retries',
    sentence: 'No dunning attempts yet',
    empty: { [URLS.dunning]: ok({ data: [] }) },
    row: { [URLS.dunning]: ok({ data: ATTEMPTS }) },
    rowText: 'Northwind Ltd',
    stats: [
      { label: 'Pending Retries', depth: 2, real: '1', selector: 'span' },
      { label: 'Completed', depth: 2, real: '1', selector: 'span' },
      { label: 'Failed', depth: 2, real: '0', selector: 'span' },
      { label: 'Total Amount', depth: 2, real: '$50', selector: 'span' },
    ],
  },
  {
    key: 'modules',
    Page: ModulesPage,
    failUrl: URLS.modules,
    phrase: 'Failed to load the modules and their plan pricing',
    sentence: 'No modules configured',
    empty: { [URLS.modules]: ok({ data: [] }) },
    row: { [URLS.modules]: ok({ data: [MODULE] }) },
    rowText: 'SMS Gateway',
    stats: [
      { label: 'Total Modules', depth: 1, real: '1' },
      { label: 'Free', depth: 1, real: '0' },
      { label: 'Starter', depth: 1, real: '1' },
      { label: 'Pro', depth: 1, real: '1' },
    ],
  },
  {
    key: 'templates',
    Page: TemplatesPage,
    failUrl: URLS.templates,
    phrase: 'Failed to load the product templates',
    sentence: 'No templates yet',
    empty: { [URLS.templates]: ok({ data: [] }) },
    row: { [URLS.templates]: ok({ data: [TEMPLATE] }) },
    rowText: 'Agency Suite',
    stats: [
      { label: 'Total Templates', depth: 1, real: '1' },
      { label: 'Active', depth: 1, real: '1' },
      { label: 'Draft', depth: 1, real: '0' },
      { label: 'Total Assignments', depth: 1, real: '3' },
    ],
  },
  {
    key: 'tickets',
    Page: TicketsPage,
    failUrl: URLS.tickets,
    phrase: 'Failed to load the support tickets',
    sentence: 'No open tickets — the queue is clear',
    empty: { [URLS.tickets]: ok({ tickets: [], counts: {} }) },
    row: { [URLS.tickets]: ok(TICKETS) },
    rowText: 'Domain transfer stuck',
    stats: [
      { label: 'Open', depth: 1, real: '2' },
      { label: 'In Progress', depth: 1, real: '1' },
      { label: 'Resolved', depth: 1, real: '4' },
      { label: 'Critical', depth: 1, real: '1' },
    ],
  },
];

describe.each(PANELS)('$key — a refused read is a failure, not an absence', ({ Page, failUrl, phrase, sentence, empty, row, rowText }) => {
  it('names the failure instead of stating an absence', () => {
    registryFor(withFailure(empty, failUrl));
    wrap(<Page />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(phrase);
    expect(alert.textContent).toContain('Request failed (500)');
    expect(document.body.textContent).not.toContain(sentence);
  });

  it('puts the page’s own refetch behind the retry', () => {
    const state = withFailure(empty, failUrl);
    registryFor(state);
    wrap(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(state[failUrl].refetch).toHaveBeenCalled();
  });

  it('still prints the sentence when the read succeeded and came back empty', () => {
    registryFor(empty);
    wrap(<Page />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(sentence);
  });

  it('prints the rows, not the banner, when the read came back', () => {
    registryFor(row);
    wrap(<Page />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(rowText);
    expect(document.body.textContent).not.toContain(sentence);
  });

  it('keeps the rows a failed refresh could not replace, and says which of the two it is', () => {
    registryFor(withRefreshFailure(row, failUrl));
    wrap(<Page />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('last read');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(document.body.textContent).toContain(rowText);
    expect(document.body.textContent).not.toContain(sentence);
  });
});

describe('the numbers a failed read used to compute', () => {
  it.each(PANELS)('$key: every derived card goes unread rather than to zero', ({ Page, failUrl, empty, stats }) => {
    registryFor(withFailure(empty, failUrl));
    wrap(<Page />);
    for (const s of stats) {
      const text = card(s.label, s.depth, s.selector);
      expect(text, `${s.label} claimed a number it never read`).toContain('—');
      // `0` rather than `\b0\b`: the value sits against the label with no space between, so
      // "Pending Retries0" has no word boundary to find and a boundary-anchored screen on the
      // whole page passes the very bug it is meant to catch.
      expect(text, `${s.label} reported a zero it never read`).not.toMatch(/0/);
    }
  });

  it.each(PANELS)('$key: a real read prints the real numbers', ({ Page, row, stats }) => {
    registryFor(row);
    wrap(<Page />);
    for (const s of stats) {
      expect(card(s.label, s.depth, s.selector), `${s.label}`).toContain(s.real);
    }
  });

  it.each(PANELS)('$key: a failed refresh keeps the last read’s numbers rather than blanking them', ({ Page, failUrl, row, stats }) => {
    registryFor(withRefreshFailure(row, failUrl));
    wrap(<Page />);
    for (const s of stats) {
      const text = card(s.label, s.depth, s.selector);
      expect(text, `${s.label} went unread while its last read was still on screen`).toContain(s.real);
    }
  });
});

/**
 * `modules` is an editable form. Before the fix the failed read left every plan switch
 * rendered OFF, so the panel's own Save button was one click from writing an all-OFF offering
 * policy over the real one — the same "seeded defaults" accident as the settings slice, on the
 * page that decides what every tenant gets.
 */
describe('modules: the form is gone, not pre-armed', () => {
  it('renders no plan toggles and no Save when the read failed', () => {
    registryFor(withFailure({ [URLS.modules]: ok({ data: [MODULE] }) }, URLS.modules));
    wrap(<ModulesPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load the modules');
    expect(screen.queryAllByRole('button', { name: /^(On|Off)$/ })).toHaveLength(0);
    expect(screen.queryByText(/Save \d+ Changes/)).toBeNull();
    expect(document.body.textContent).not.toContain('No modules configured');
  });

  it('renders the toggles a real read implies', () => {
    registryFor({ [URLS.modules]: ok({ data: [MODULE] }) });
    wrap(<ModulesPage />);
    // 4 plans × 1 module, and the three enabled ones carry their price input
    expect(screen.getAllByRole('button', { name: /^(On|Off)$/ })).toHaveLength(4);
    expect(screen.getByDisplayValue('25')).toBeTruthy();
  });

  it('leaves the form and its unsaved edits alone when only the refresh failed', () => {
    registryFor(withRefreshFailure({ [URLS.modules]: ok({ data: [MODULE] }) }, URLS.modules));
    wrap(<ModulesPage />);
    expect(screen.getByRole('alert').textContent).toContain('last read');
    expect(screen.getAllByRole('button', { name: /^(On|Off)$/ })).toHaveLength(4);
    expect(document.body.textContent).not.toContain('No modules configured');
  });
});

/**
 * The half an in-place banner gets wrong if you only make the failure case pass: all three of
 * these panels filter rows they already have in hand, so a miss has to stay a miss.
 */
describe('the client-side filters that must not become an outage', () => {
  it('dunning: a status tab with no matching attempts says so, and no alert appears', () => {
    registryFor({ [URLS.dunning]: ok({ data: ATTEMPTS }) });
    wrap(<DunningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No failed dunning attempts');
    expect(document.body.textContent).toContain('2 attempts in other statuses');
  });

  it('tickets: a search that matches nothing stays a search miss', () => {
    registryFor({ [URLS.tickets]: ok(TICKETS) });
    wrap(<TicketsPage />);
    fireEvent.change(screen.getByPlaceholderText('Search tickets...'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No tickets match “zzz”');
    fireEvent.click(screen.getByRole('button', { name: /Clear search/i }));
    expect(document.body.textContent).toContain('Domain transfer stuck');
  });

  it('modules: a search that matches nothing stays a search miss', () => {
    registryFor({ [URLS.modules]: ok({ data: [MODULE] }) });
    wrap(<ModulesPage />);
    fireEvent.change(screen.getByPlaceholderText('Search modules...'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No modules match your search');
    expect(document.body.textContent).not.toContain('No modules configured');
  });
});

describe('the guard still ratchets, and this slice decays honestly', () => {
  const ROOT = process.cwd();
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const SCRIPT = 'scripts/check-panel-error-state.mjs';

  const doc = () => JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    files: Record<string, string>;
  };

  it('is green, and none of the four super-admin panels still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    const files = doc().files;
    expect(files['app/superadmin/billing/dunning/page.tsx']).toBeUndefined();
    expect(files['app/superadmin/modules/page.tsx']).toBeUndefined();
    expect(files['app/superadmin/templates/page.tsx']).toBeUndefined();
    expect(files['app/superadmin/tickets/page.tsx']).toBeUndefined();
  });

  it('keeps pages nobody is fixing in the list, so an empty sweep cannot read as success', () => {
    // A ceiling, never an equality: #2851 is in review with five more of these gone, and an
    // exact count goes false the moment another slice honestly fixes a panel.
    const files = doc().files;
    expect(Object.keys(files).length).toBeLessThanOrEqual(20);
    expect(files['app/tenant/kb/categories/page.tsx']).toBeTruthy();
    expect(files['app/tenant/forms/page.tsx']).toBeTruthy();
    expect(files['app/tenant/reports/custom/page.tsx']).toBeTruthy();
    for (const [file, note] of Object.entries(files)) {
      expect(note, `${file} is allowlisted with no reason attached`).toContain('#2829');
    }
  });

  it('does not push a fixed page over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
