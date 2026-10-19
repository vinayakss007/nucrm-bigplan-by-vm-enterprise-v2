// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the four `app/superadmin/*` panels still on the ratchet list.
 *
 * These are the operator's own pages, and every one of them answers a refused read
 * with a number. Measured on this branch before the fix (`inspect()` from
 * `scripts/check-panel-error-state.mjs`, the repo's own screen):
 *
 *   - `billing/dunning`  — a money panel. `attempts = data?.data ?? []` left the four
 *     cards reading Pending Retries 0, Completed 0, Failed 0 and **Total Amount $0**
 *     (`formatCurrency(0)`), above "No dunning attempts found". The one screen that
 *     says whether failed payments are being chased reported "nothing to chase".
 *   - `modules`          — destructured **no `error` at all**, so the refusal had no
 *     channel whatsoever: Total Modules 0, Free 0, Starter 0, Pro 0 over "No modules
 *     configured — Modules will appear here once they are registered." That is a claim
 *     about what every plan ships with, on the page whose toggles set it.
 *   - `templates`        — Total Templates 0 / Active 0 / Draft 0 / Total Assignments 0
 *     over "No templates yet. Create your first one.", next to a live Create New
 *     button. Templates get assigned to tenants, so the false "none" invites a
 *     duplicate of one that exists.
 *   - `tickets`          — a green check icon and "No tickets found" — an all-clear
 *     that no tenant is waiting on support — plus Open 0 / In Progress 0 / Resolved 0
 *     / Critical 0 off `data?.counts ?? {}`.
 *
 * Three of the four bound `error` and routed it to a `useEffect` toast, which is the
 * shape the baseline calls "binds `error` and toasts it, then prints the sentence
 * anyway": it speaks for four seconds and the false claim stays for as long as the
 * page is open. So every panel here is pinned on both halves — the alert appears, and
 * no load-failure toast fires, on the first render *and* after a re-render.
 *
 * Per panel: failed read → `role="alert"` naming that read, its own `refetch` behind
 * "Try again", the sentence unreachable and the derived numbers showing `—`;
 * succeeded-and-empty → the sentence, no alert, real numbers; rows → the rows, no
 * alert. `modules` gets the opposite assertion too, because its empty branch has two
 * arms and the search arm is honest: a read that succeeded and matched nothing still
 * says "No modules match your search", not a fake outage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/superadmin',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import DunningPage from '@/app/superadmin/billing/dunning/page';
import ModulesPage from '@/app/superadmin/modules/page';
import TemplatesPage from '@/app/superadmin/templates/page';
import TicketsPage from '@/app/superadmin/tickets/page';

const NOW = '2026-10-01T00:00:00Z';
const DUNNING = '/api/superadmin/billing/dunning';
const MODULES = '/api/superadmin/modules';
const TEMPLATES = '/api/superadmin/templates';
// The status filter is part of the key: `tickets` defaults to `open` server-side.
const TICKETS = '/api/superadmin/tickets?status=open';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// ── fixtures: shaped like each endpoint's own list response ────────────────────
const dunningRows = {
  data: [
    {
      id: 'da1', subscriptionId: 'sub-north', attemptNumber: 2, status: 'pending',
      scheduledAt: NOW, executedAt: null, paymentAmount: 4500,
      errorMessage: 'card declined', retryCount: 1,
      tenant: { id: 'tn1', name: 'Northwind Grocers' },
    },
    {
      id: 'da2', subscriptionId: 'sub-lakes', attemptNumber: 1, status: 'completed',
      scheduledAt: NOW, executedAt: NOW, paymentAmount: 1200,
      errorMessage: null, retryCount: 0,
      tenant: { id: 'tn2', name: 'Lakeside Studio' },
    },
  ],
};
const moduleRows = {
  data: [{
    id: 'mod-deliverability', name: 'Email deliverability', icon: '📤',
    description: 'Bounce and complaint ingestion', category: 'messaging',
    features: ['Bounce webhooks', 'List hygiene'], total_installs: 7,
    // The endpoint's field is `pricing`; the page's seeding effect maps it to
    // `planAccess` and substitutes an all-disabled default when it is absent — so
    // handing it `planAccess` directly is the shape that silently zeroes the row.
    pricing: {
      free: { enabled: false }, starter: { enabled: true, price: 9 },
      pro: { enabled: true, price: 19 }, enterprise: { enabled: true, price: 49 },
    },
  }],
};
const templateRows = {
  data: [{
    id: 'tpl1', name: 'SaaS starter kit', description: 'Pipelines and fields for a product-led team',
    icon: '📦', status: 'active', is_builtin: false, tenant_count: 4,
    modules: ['crm', 'billing'], created_at: NOW,
  }],
};
const ticketPayload = {
  tickets: [{
    id: 'tk1', subject: 'Billing portal will not open', status: 'open', priority: 'critical',
    tenant_name: 'Northwind Grocers', user_name: 'Priya Kulkarni', user_email: 'priya@example.invalid',
    created_at: NOW,
  }],
  counts: { open: 1, in_progress: 0, resolved: 2, critical: 1 },
};

/** Every alert's text joined — a page can raise more than one failure. */
function alerts(): string {
  return screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
}

/**
 * A stat card's whole text. The card caption is a `p` on three of these pages and a
 * `span` on dunning (whose "Failed" caption would otherwise collide with the "Failed"
 * filter button), and the value is its sibling — so the lookup starts at the caption
 * and walks up to the card. Asserting through the card rather than a global
 * `getByText('0')` is what keeps these honest: the number is only wrong because of
 * WHICH read it is derived from.
 */
function card(label: string, opts: { container?: string; caption?: string } = {}): string {
  const el = screen.getByText(label, { selector: opts.caption ?? 'p' });
  return el.closest(opts.container ?? 'div')?.textContent ?? '';
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => render(tree(node));

type Panel = {
  key: string;
  Page: () => ReactNode;
  failUrl: string;
  cardOpts?: { container?: string; caption?: string };
  /** the read this slice refuses */
  withFailure: Record<string, QueryResult>;
  /** the "there are none" claim it used to print */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  empty: Record<string, QueryResult>;
  rows: Record<string, QueryResult>;
  rowText: string;
  /** labels whose card showed a derived 0, with the value the rows case proves */
  numbers: { label: string; onRows: string }[];
};

const PANELS: Panel[] = [
  {
    key: 'dunning',
    Page: DunningPage,
    failUrl: DUNNING,
    cardOpts: { container: '.admin-card', caption: 'span' },
    withFailure: { [DUNNING]: failed('Request failed (502)') },
    sentence: /No dunning attempts found/,
    phrase: /dunning/i,
    empty: { [DUNNING]: ok({ data: [] }) },
    rows: { [DUNNING]: ok(dunningRows) },
    rowText: 'Northwind Grocers',
    numbers: [
      { label: 'Pending Retries', onRows: '1' },
      { label: 'Completed', onRows: '1' },
      { label: 'Failed', onRows: '0' },
      { label: 'Total Amount', onRows: '$5,700' },
    ],
  },
  {
    key: 'modules',
    Page: ModulesPage,
    failUrl: MODULES,
    withFailure: { [MODULES]: failed() },
    sentence: /No modules configured/,
    phrase: /plan offerings|modules/i,
    empty: { [MODULES]: ok({ data: [] }) },
    rows: { [MODULES]: ok(moduleRows) },
    rowText: 'Email deliverability',
    numbers: [
      { label: 'Total Modules', onRows: '1' },
      { label: 'Free', onRows: '0' },
      { label: 'Starter', onRows: '1' },
      { label: 'Pro', onRows: '1' },
    ],
  },
  {
    key: 'templates',
    Page: TemplatesPage,
    failUrl: TEMPLATES,
    withFailure: { [TEMPLATES]: failed() },
    sentence: /No templates yet/,
    phrase: /templates/i,
    empty: { [TEMPLATES]: ok({ data: [] }) },
    rows: { [TEMPLATES]: ok(templateRows) },
    rowText: 'SaaS starter kit',
    numbers: [
      { label: 'Total Templates', onRows: '1' },
      { label: 'Active', onRows: '1' },
      { label: 'Draft', onRows: '0' },
      { label: 'Total Assignments', onRows: '4' },
    ],
  },
  {
    key: 'tickets',
    Page: TicketsPage,
    failUrl: TICKETS,
    withFailure: { [TICKETS]: failed() },
    sentence: /No tickets found/,
    phrase: /tickets/i,
    empty: { [TICKETS]: ok({ tickets: [], counts: { open: 0, in_progress: 0, resolved: 0, critical: 0 } }) },
    rows: { [TICKETS]: ok(ticketPayload) },
    rowText: 'Billing portal will not open',
    numbers: [
      { label: 'Open', onRows: '1' },
      { label: 'In Progress', onRows: '0' },
      { label: 'Resolved', onRows: '2' },
      { label: 'Critical', onRows: '1' },
    ],
  },
];

describe('a refused super-admin read is not reported as "there are none" (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  for (const p of PANELS) {
    describe(p.key, () => {
      it('names the failed read instead of claiming the platform has none', () => {
        registry.byUrl = { ...p.withFailure };
        expect(() => wrapped(<p.Page />)).not.toThrow();
        expect(alerts()).toMatch(p.phrase);
        expect(alerts()).toMatch(/failed|did not (load|answer)|could not be read/i);
        expect(screen.queryAllByText(p.sentence).length, `${p.key}: still states the absence`).toBe(0);
      });

      it('refuses to state a derived number for a read that never answered', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        for (const n of p.numbers) {
          const text = card(n.label, p.cardOpts);
          expect(text, `${n.label} on ${p.key}: no dash`).toContain('—');
          expect(text, `${n.label} on ${p.key}: still quotes the ${n.onRows} it never read`).not.toContain(n.onRows);
        }
      });

      it('keeps its honest sentence for a successful read that returned nothing', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(screen.getAllByText(p.sentence).length).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('states the numbers it actually read, with no failure state', () => {
        registry.byUrl = { ...p.rows };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toBe('');
        for (const n of p.numbers) {
          expect(card(n.label, p.cardOpts), `${n.label} on ${p.key}`).toContain(n.onRows);
        }
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('announces the failure once, in the banner — not from a toast that fades', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, 'the effect/toast channel is the one that left the sentence behind').not.toHaveBeenCalled();
        rerender(tree(<p.Page />));
        expect(toast.error, 'and it must not return on re-render either').not.toHaveBeenCalled();
      });
    });
  }
});

describe('the two arms of the modules empty state (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const searchFor = (term: string) =>
    fireEvent.change(screen.getByPlaceholderText('Search modules...'), { target: { value: term } });

  it('keeps a search that matches nothing as a search, not a fake outage', () => {
    // The filter is client-side, so this branch is telling the truth about a read
    // that succeeded — routing every empty arm to the banner would trade one lie
    // for another.
    registry.byUrl = { [MODULES]: ok(moduleRows) };
    wrapped(<ModulesPage />);
    searchFor('deliverabilityyy');
    expect(screen.getByText('No modules match your search')).toBeTruthy();
    expect(screen.queryByText(/No modules configured/)).toBeNull();
    expect(alerts()).toBe('');
  });

  it('still reports the outage when the operator is searching an unread matrix', () => {
    registry.byUrl = { [MODULES]: failed() };
    wrapped(<ModulesPage />);
    searchFor('deliverability');
    expect(alerts()).toMatch(/plan offerings|modules/i);
    expect(screen.queryByText(/No modules match your search/)).toBeNull();
    expect(screen.queryByText(/No modules configured/)).toBeNull();
  });

  it('renders the plan toggles for a read that answered', () => {
    registry.byUrl = { [MODULES]: ok(moduleRows) };
    wrapped(<ModulesPage />);
    expect(screen.getByText('Email deliverability')).toBeTruthy();
    // free is disabled in the fixture, the three paid plans are not.
    expect(screen.getAllByText('Off').length).toBe(1);
    expect(screen.getAllByText('On').length).toBe(3);
    expect(alerts()).toBe('');
  });

  it('renders no plan grid for a read that did not', () => {
    registry.byUrl = { [MODULES]: failed() };
    wrapped(<ModulesPage />);
    expect(screen.queryByText('Email deliverability')).toBeNull();
    expect(screen.queryByText(/No modules configured/)).toBeNull();
    expect(alerts()).toMatch(/failed/i);
  });
});

describe('the dunning money panel keeps its own shape (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('does not report $0 owed when the attempts read failed', () => {
    // `formatCurrency(0)` is '$0', so the card read like a measurement of the
    // money nobody is chasing, next to "No dunning attempts found".
    registry.byUrl = { [DUNNING]: failed('Request failed (502)') };
    wrapped(<DunningPage />);
    const money = card('Total Amount', { container: '.admin-card', caption: 'span' });
    expect(money).not.toContain('$0');
    expect(money).toContain('—');
  });

  it('keeps the status filters usable while the failure is on screen', () => {
    registry.byUrl = { [DUNNING]: failed() };
    wrapped(<DunningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(alerts()).toMatch(/dunning/i);
    expect(screen.queryByText(/No dunning attempts found/)).toBeNull();
  });

  it('shows a retry action for a pending attempt it actually read', () => {
    registry.byUrl = { [DUNNING]: ok(dunningRows) };
    wrapped(<DunningPage />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.getByText('card declined')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the tickets panel stops giving the all-clear it never earned (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('replaces the green-tick "no tickets" block with the failure it read', () => {
    registry.byUrl = { [TICKETS]: failed('Request failed (401)') };
    wrapped(<TicketsPage />);
    expect(alerts()).toMatch(/tickets/i);
    expect(screen.queryByText(/No tickets found/)).toBeNull();
  });

  it('says "No tickets found" for a filter that genuinely has none', () => {
    registry.byUrl = { [TICKETS]: ok({ tickets: [], counts: ticketPayload.counts }) };
    wrapped(<TicketsPage />);
    expect(screen.getByText(/No tickets found/)).toBeTruthy();
    expect(alerts()).toBe('');
    // Counts came back, so they are the tenant's real numbers even with no rows.
    expect(card('Resolved')).toContain('2');
  });

  it('searches its own list without inventing an outage', () => {
    registry.byUrl = { [TICKETS]: ok(ticketPayload) };
    wrapped(<TicketsPage />);
    fireEvent.change(screen.getByPlaceholderText('Search tickets...'), { target: { value: 'no such subject' } });
    expect(screen.getByText(/No tickets found/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet decayed by exactly these four (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/superadmin/billing/dunning/page.tsx',
    'app/superadmin/modules/page.tsx',
    'app/superadmin/templates/page.tsx',
    'app/superadmin/tickets/page.tsx',
  ];
  const baseline = () =>
    JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
      files: Record<string, string>;
    };

  it('is still green, and still counts what the baseline actually holds', () => {
    // #2858: this used to compare the guard's message and the baseline's length
    // against the exact number read off the file the day the slice was written. The
    // ratchet is a shrink-only queue, so every later slice that honestly fixes a
    // panel deletes an entry and turns *this* suite red on that slice's PR, with
    // nothing wrong. Measure the file instead; the ceiling is what carries the
    // promise (the same shape #2852's suite uses).
    const keys = Object.keys(baseline().files);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain(`OK — ${keys.length} panel(s)`);
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale').not.toContain('no longer offends');
  });

  it('no longer carries any of the four', () => {
    const files = baseline().files;
    expect(
      Object.keys(files).length,
      '#2829 stood at 24 when this slice was cut; it may only go down from there',
    ).toBeLessThanOrEqual(24);
    for (const f of FILES) {
      expect(files, `${f} stayed on the list after being fixed`).not.toHaveProperty(f);
    }
  });

  it('memorises no panel count anywhere in this file (#2858)', () => {
    // The two red-on-a-sibling-slice assertions above are gone, and nothing may
    // quietly re-plant one: the suite runs on a page's PR, not on the day it was
    // written, so a literal here is a landmine for whoever fixes the next panel.
    const src = readFileSync(
      join(ROOT, 'tests/unit/panel-page-error-not-empty-superadmin-2829.test.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/OK — \d+ panel/);
    expect(src).not.toMatch(/toHaveLength\(2\d\)/);
  });

  it('and the screen now sees what it saw before: each page reads its failure and shows it', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still offends the screen`).toBe(false);
      // The removal is honest: the page binds the failure AND renders for it.
      expect(src, `${f} does not bind error`).toMatch(/\berror\b/);
      expect(src, `${f} binds error and never renders it — the hole the proxy cannot close`).toMatch(/InlineErrorState/);
    }
  });

  it('leaves no load-failure toast behind on these four pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure`).not.toMatch(/if \((?:error|\w*[Ee]rror)\)\s*toast\.error/);
    }
  });

  it('keeps every file it touches inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
