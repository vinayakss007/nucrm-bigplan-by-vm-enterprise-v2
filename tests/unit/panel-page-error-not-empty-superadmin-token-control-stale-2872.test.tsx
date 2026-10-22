// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copy or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/token-control/page.tsx` reads four things and had one
 * flag per read, so a refresh that was refused over the top of a list the page
 * still held was reported exactly like a read that never answered.
 *
 * #2841 gave this page its failure branches — an unread array prints `—`, never
 * `0`, and where the page would claim an empty list it names the request that
 * failed. That is the right shape for the *first* read. `useApiQuery` keeps the
 * previous `data` when a revalidation rejects, and all three flags this page
 * derives are `Boolean(query.error)`: the moment a read has succeeded once, the
 * flag can no longer tell "nothing was ever read" from "the refresh did not
 * answer, and the rows from the read that did are still on screen".
 *
 * The trigger is the Refresh button, which refetches all four reads at once. A
 * super admin clicks it, the gateway 504s on `/budgets`, and the tab they are
 * looking at says "Failed to load token budgets: Request failed (504). An empty
 * list would mean no service has a budget; this message means the request did
 * not succeed." — under the four budget cards that read returned, about a read
 * that succeeded. Top Spenders was worse in the other direction: its message sat
 * behind `topTenants.length === 0`, so a refused refresh *with* rows said nothing
 * at all, and the ledger the operator is reconciling against silently stopped
 * being current.
 *
 * MEASURED before the fix, this suite ran **10 failed | 14 passed (24)** against
 * `origin/main` at `8a9033d5` with the page untouched. Six are the kept-read state
 * simply not existing: four reads that printed the outage sentence over lists they
 * were still holding, the refusal that carried no message and printed `undefined`,
 * and the spenders refresh that went stale behind rows and said nothing at all —
 * the one case where the old wording was not merely wrong but absent. Four are the
 * source-shape cases, which fail because the split they pin is not there yet. The
 * outage branches, the two succeeded-and-empty sentences, the green all-clear, the
 * retries and the healthy read pass before and after on purpose: those are the
 * states #2841 and #2823 already got right, and a slice that regressed them is
 * exactly what they are there to catch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
const writes = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));
/** The page is a client component with no router use; the fetch stub exists so a
 *  stray write can be caught rather than reaching the network. */
vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
  writes.push(String(input));
  return Promise.resolve(new Response('{}', { status: 500 }));
});

import TokenControlPage from '@/app/superadmin/token-control/page';

const PAGE = 'app/superadmin/token-control/page.tsx';
const BUDGETS_URL = '/api/superadmin/token-control/budgets';
const SPENDERS_URL = '/api/superadmin/token-control/report/top-spenders';
const ALERTS_URL = '/api/superadmin/token-control/alerts?limit=20';
const KEYS_URL = '/api/superadmin/token-control/keys';

const budgetRow = {
  id: 'b1', service: 'openai', current_month_cents: 12_500, monthly_budget_cents: 100_000,
  hard_cap_enabled: false, alert_at_50pct: true, alert_at_80pct: true, alert_at_100pct: true,
};
const budgetRows = { budgets: [budgetRow] };
const tenantRows = {
  tenants: [{
    tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001', tenant_name: 'Analytical Co',
    openai_cents: 4_000, whatsapp_cents: 100, voice_cents: 0, total_cents: 4_100, pct_of_total: 61.5,
  }],
};
const alertRow = {
  id: 'a1', acknowledged: false, alert_type: 'budget_80_percent', target_type: 'platform',
  service: 'openai', message: '80% of budget used', created_at: '2026-03-04T10:00:00.000Z',
};
const keyRow = {
  id: 'k1', service: 'openai', key_prefix: 'sk-abc', is_primary: true, is_active: true,
  current_month_cents: 4_200, last_used_at: '2026-03-04T10:00:00.000Z',
};

const OUTAGE = 'Failed to load';
const CAVEAT = 'is the last read';
const ALL_CLEAR = 'No alerts — everything is within budget';

/** A read that answered. */
const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered — nothing was ever on screen. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state one flag cannot express: an earlier read answered, this refresh did not. */
const refusedRefresh = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The same refusal with no message — `new Error()` is a real transport outcome. */
const messageless = (data: unknown): QueryResult => ({
  data, error: new Error(''), isLoading: false, refetch: vi.fn(),
});

/** Every read healthy except the one under test. */
function mount(withRead: Partial<Record<string, QueryResult>> = {}) {
  registry.byUrl = {
    [BUDGETS_URL]: ok(budgetRows),
    [SPENDERS_URL]: ok(tenantRows),
    [ALERTS_URL]: ok({ alerts: [alertRow] }),
    [KEYS_URL]: ok({ keys: [keyRow] }),
    ...withRead,
  };
  render(<TokenControlPage />);
}

const alerts = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

afterEach(() => {
  cleanup();
  writes.length = 0;
});

describe('token control — a refused refresh over a kept read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; });

  it('keeps the budget cards and calls the refusal a last read, not a failed load', () => {
    mount({ [BUDGETS_URL]: refusedRefresh(budgetRows) });
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(alerts()).toContain(CAVEAT);
    expect(alerts()).not.toContain(OUTAGE);
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('quotes the reason for the refused refresh', () => {
    mount({ [BUDGETS_URL]: refusedRefresh(budgetRows, 'Request failed (504)') });
    expect(alerts()).toContain('Request failed (504)');
  });

  it('prints the outage sentence only when nothing was ever read', () => {
    mount({ [BUDGETS_URL]: failed() });
    expect(alerts()).toContain('Failed to load token budgets');
    expect(alerts()).not.toContain(CAVEAT);
  });

  it('leaves the summary cards on em-dashes either way, because it cannot vouch for a number', () => {
    mount({ [BUDGETS_URL]: refusedRefresh(budgetRows) });
    const card = screen.getByText('Total Spent').closest('.bg-gradient-to-br') as HTMLElement;
    expect(card.textContent).toContain('—');
    expect(card.textContent).not.toContain('₹125');
  });

  it('says the top spenders went stale while still showing the ledger', () => {
    mount({ [SPENDERS_URL]: refusedRefresh(tenantRows) });
    tab(/Top Spenders/);
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the top spenders');
    expect(alerts()).not.toContain('Failed to load top spenders');
  });

  it('shows the spenders outage once, and never as an absence', () => {
    mount({ [SPENDERS_URL]: failed() });
    tab(/Top Spenders/);
    expect(alerts()).toContain('Failed to load top spenders');
    expect(screen.queryByText('No spending data yet')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the succeeded-and-empty read as an absence with no alert at all', () => {
    mount({ [SPENDERS_URL]: ok({ tenants: [] }) });
    tab(/Top Spenders/);
    expect(screen.getByText('No spending data yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refused refresh over a last read that was empty as both statements', () => {
    mount({ [SPENDERS_URL]: refusedRefresh({ tenants: [] }) });
    tab(/Top Spenders/);
    expect(alerts()).toContain(CAVEAT);
    expect(screen.getByText('No spending data yet')).toBeTruthy();
  });

  it('marks the key table stale without hiding the keys it kept', () => {
    mount({ [KEYS_URL]: refusedRefresh({ keys: [keyRow] }) });
    tab(/API Keys/);
    expect(screen.getByText('sk-abc')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the API keys');
    expect(alerts()).not.toContain('Failed to load API keys');
  });

  it('marks the alerts list stale instead of reprinting the load failure', () => {
    mount({ [ALERTS_URL]: refusedRefresh({ alerts: [alertRow] }) });
    tab(/Alerts/);
    expect(screen.getByText(/80% of budget used/)).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the usage alerts');
    expect(alerts()).not.toContain('Failed to load usage alerts');
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
  });

  it('still refuses to print the green all-clear when the alerts read never answered', () => {
    mount({ [ALERTS_URL]: failed() });
    tab(/Alerts/);
    expect(alerts()).toContain('Failed to load usage alerts');
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
  });

  it('prints the all-clear for a succeeded read that came back empty', () => {
    mount({ [ALERTS_URL]: ok({ alerts: [] }) });
    tab(/Alerts/);
    expect(screen.getByText(ALL_CLEAR)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries the read that went stale, and only that one', () => {
    const refetch = vi.fn();
    mount({ [BUDGETS_URL]: { ...refusedRefresh(budgetRows), refetch } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[SPENDERS_URL]!.refetch).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('leaves the manual Refresh button working through a stale read', () => {
    const refetch = vi.fn();
    mount({ [ALERTS_URL]: { ...refusedRefresh({ alerts: [alertRow] }), refetch } });
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
  });

  it('names a refusal that carried no message instead of printing undefined', () => {
    mount({ [BUDGETS_URL]: messageless(budgetRows) });
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('stays silent on four healthy reads', () => {
    mount();
    tab(/API Keys/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('token control — the split stays in the source (#2872)', () => {
  const src = () => readFileSync(PAGE, 'utf8');

  it('derives the kept-read state inside the shared banner', () => {
    expect(src()).toContain('const stale = Boolean(error) && Boolean(data);');
  });

  it('carries the fallback reason the folded string never had', () => {
    expect(src()).toContain("const reason = error?.message || 'no response from the server';");
  });

  it('feeds every one of the four reads its own data into that banner', () => {
    for (const name of ['budgetsQuery', 'spendersQuery', 'alertsQuery', 'keysQuery']) {
      expect(src(), `${name} is not passed to the banner`).toContain(`data={${name}.data}`);
    }
  });

  it('gates the two absence sentences on the read having answered', () => {
    expect(src()).toContain('{topTenants.length === 0 && !spendersUnanswered && (');
    expect(src()).toContain('{alerts.length === 0 && !alertsUnanswered && (');
  });

  it('does not gate anything new off the kept-read state', () => {
    // Reachability: a stale read leaves the page operable, so no affordance may
    // start depending on it.
    const disabled = [...src().matchAll(/disabled=\{[^}]*\}/g)].map((m) => m[0]);
    for (const d of disabled) expect(d).not.toMatch(/stale|Unread|Unanswered/);
  });

  it('passes the panel-error-state screen and can be rewound by it', async () => {
    const { inspect } = await import('../../scripts/check-panel-error-state.mjs');
    expect(inspect(PAGE, src()).offends).toBe(false);
    // The rewind: the spenders absence keyed off `error` alone, which is the
    // shape this suite exists to remove — with it gone, the outage banner and
    // the absence sentence print together and the kept read is called a failure.
    const rewind = src().replace(
      '{topTenants.length === 0 && !spendersUnanswered && (',
      '{topTenants.length === 0 && (\n            spendersUnread ? (<',
    );
    expect(rewind).not.toContain('!spendersUnanswered');
  });

  it('stays inside the file-size ceiling without a baseline entry', () => {
    const baseline = JSON.parse(readFileSync('scripts/file-size-baseline.json', 'utf8')) as Record<string, number>;
    expect(src().split('\n').length).toBeLessThanOrEqual(500);
    expect(baseline[PAGE]).toBeUndefined();
  });

  it('leaves the repo guards green', () => {
    for (const script of ['check-file-size.mjs', 'check-panel-error-state.mjs', 'check-catch-empty.mjs']) {
      const r = spawnSync('node', [join('scripts', script)], { encoding: 'utf8' });
      expect(r.status, `${script} exited ${r.status}: ${r.stderr}`).toBe(0);
    }
  });
});
