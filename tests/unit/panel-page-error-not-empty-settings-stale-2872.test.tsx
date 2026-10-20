// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three `app/tenant/settings` dashboards that blank themselves.
 *
 * `csat`, `usage` and `portal` bind `error`, render `InlineErrorState`, and pass
 * `check-panel-error-state.mjs`: #2829 already closed the half where a failed read
 * claimed an absence. This slice is the other half — the read that DID answer, and
 * then failed to answer again — and TanStack Query keeps `data` through it.
 *
 * All three branched on the flag alone:
 *
 *     : error ? (<InlineErrorState …/>) : the dashboard
 *     if (configError) return (…banner…)
 *     Client Access ({clientsError ? '—' : clients.length})
 *
 * so the ordinary reload that gets refused — the remount refetch past the repo-wide
 * 30s `staleTime`, or the `invalidateQueries` that `portal`'s own save and add-client
 * mutations fire — took the whole panel away. `portal` is the worst of the three: its
 * config branch is an early `return`, so a refused reload after pressing Save replaced
 * the settings screen, the permissions and the client roster with one centred banner,
 * leaving no way to see what had actually been stored.
 *
 * `csat` shows why the split is keyed on the query result rather than on the flag:
 * `days` is part of the query key, so switching the window is a read that has never
 * answered for that key. That is `failed`, and #2829's outage banner is right. A
 * refused reload of the window already on screen is `stale`.
 *
 * Per page: `failed = Boolean(err) && !data` keeps the banner, `stale =
 * Boolean(err) && data` keeps the dashboard under a "last read" caveat, and every
 * derived number keys off `failed`. `usage`'s banner also interpolated
 * `usageError.message` with no fallback; it now uses the same `reason` string the rest
 * of the class standardised on.
 *
 * RED AT BASE — measured on `main` at `b92747b6` (this PR's base) with the three product files untouched and this
 * file as committed: 9 of these 20 cases fail. Five put a page in the stale state (both `portal`
 * reads, the `csat` and `usage` dashboards, and the roster count), one is the bare-undefined message,
 * and four are the source ratchets. The other 11 are the outage-and-empty controls from #2829 plus
 * the `days`-switch control; they pass at base and must keep passing, because replacing `error ?`
 * with `failed ?` is exactly the edit that breaks them.
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

import CSATDashboardPage from '@/app/tenant/settings/csat/page';
import PortalSettingsPage from '@/app/tenant/settings/portal/page';
import UsageDashboardPage from '@/app/tenant/settings/usage/page';

const NOW = '2026-10-01T00:00:00Z';
const CSAT30 = '/api/tenant/csat/stats?days=30';
const CSAT7 = '/api/tenant/csat/stats?days=7';
const USAGE = '/api/tenant/analytics/usage';
const PORTAL_CONFIG = '/api/tenant/portal/config';
const PORTAL_CLIENTS = '/api/tenant/portal/clients';

const csatStats = {
  data: {
    overall: { total: 50, responded: 30, responseRate: 60, avgScore: 3.6 },
    distribution: [
      { score: 5, count: 8 }, { score: 4, count: 4 }, { score: 3, count: 2 },
      { score: 2, count: 1 }, { score: 1, count: 1 },
    ],
    recent: [
      { id: 'cs-1', score: 5, comment: 'The portal login works now.', sentAt: NOW, respondedAt: NOW, ticketSubject: 'Invoice PDF will not open', agentName: 'Priya Raman' },
      { id: 'cs-2', score: null, comment: null, sentAt: NOW, respondedAt: null, ticketSubject: null, agentName: null },
    ],
  },
};
const usageData = {
  data: {
    thisMonth: { contacts: 12, deals: 5, tasks: 21, tickets: 8, companies: 2, emails: 140, dealValue: 48000 },
    lastMonth: { contacts: 9, deals: 4, tasks: 18 },
    totals: { contacts: 1234, deals: 57, tasks: 210, tickets: 88, companies: 31, dealValue: 250000 },
    recentActivity: [
      { id: 'ua-1', description: 'Nadia closed Harbor Fitness', eventType: 'deal_won', entityType: 'deal', createdAt: NOW },
      { id: 'ua-2', description: null, eventType: 'note', entityType: 'contact', createdAt: NOW },
    ],
  },
};
const portalConfig = {
  data: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: false, custom_message: 'Upload a statement and we reply within a day.' },
};
const portalClients = {
  data: [
    { id: 'pc-1', name: 'Coral Realty', email: 'ops@coral.invalid', is_active: true, last_login_at: NOW, created_at: NOW },
    { id: 'pc-2', name: 'Harbor Fitness', email: 'frontdesk@harbor.invalid', is_active: false, last_login_at: null, created_at: NOW },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Every replacement banner in this
 * class quotes the sentence it retires, so a bare `queryByText(/No CSAT data yet/)`
 * would find the alert's own copy and report the false claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/** The count in `portal`'s roster heading — "Client Access (2)" / "(—)". */
function clientAccessHeader(): string {
  return screen.getByText(/Client Access \(/).textContent ?? '';
}

describe('csat: a refused reload keeps the dashboard (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the three cards, the distribution and the feedback, and names the read', () => {
    const result = staleRead(csatStats);
    registry.byUrl = { [CSAT30]: result };
    wrapped(<CSATDashboardPage />);
    expect(screen.getByText('Average Score')).toBeTruthy();
    expect(screen.getByText('Total Surveys')).toBeTruthy();
    expect(screen.getByText('Invoice PDF will not open')).toBeTruthy();
    expect(alerts()).toContain('the scores below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load CSAT stats/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread window is still an outage, and never "No CSAT data yet"', () => {
    registry.byUrl = { [CSAT30]: failed('Request failed (500)') };
    wrapped(<CSATDashboardPage />);
    expect(screen.queryByText('Average Score')).toBeNull();
    expect(claimsOutsideAlerts(/No CSAT data yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load CSAT stats');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('switching the window is a fresh key, so a refusal there is an outage, not a stale read', () => {
    // `days` is part of the query key: the 7-day window has never answered, so the
    // page may not call the failure "the last read" — the last read it is showing is
    // of the 30-day window, which is gone with the key.
    registry.byUrl = { [CSAT30]: ok(csatStats), [CSAT7]: failed('Request failed (500)') };
    wrapped(<CSATDashboardPage />);
    expect(screen.getByText('Average Score')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });
    expect(screen.queryByText('Average Score')).toBeNull();
    expect(claimsOutsideAlerts(/No CSAT data yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load CSAT stats');
    expect(alerts()).not.toContain('the scores below are the last read');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [CSAT30]: ok(csatStats) };
    wrapped(<CSATDashboardPage />);
    expect(screen.getByText('Response Rate')).toBeTruthy();
    expect(screen.getByText(/30 of 50 surveys responded/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('usage: a refused reload keeps the figures (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the six cards and the activity feed, and labels them the last read', () => {
    const result = staleRead(usageData);
    registry.byUrl = { [USAGE]: result };
    wrapped(<UsageDashboardPage />);
    expect(screen.getByText('Contacts')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('Recent Activity')).toBeTruthy();
    expect(screen.getByText('Nadia closed Harbor Fitness')).toBeTruthy();
    expect(alerts()).toContain('the figures below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load your usage/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread dashboard is still an outage, and never "No usage data yet"', () => {
    registry.byUrl = { [USAGE]: failed('Request failed (500)') };
    wrapped(<UsageDashboardPage />);
    expect(screen.queryByText('Contacts')).toBeNull();
    expect(screen.queryByText('Recent Activity')).toBeNull();
    expect(claimsOutsideAlerts(/No usage data yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load your usage: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('the failure copy never leans on a bare undefined', () => {
    // The old banner interpolated `usageError.message` with no fallback. An error
    // object with no message used to read "Failed to load your usage: undefined".
    registry.byUrl = {
      [USAGE]: { data: undefined, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() },
    };
    wrapped(<UsageDashboardPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [USAGE]: ok(usageData) };
    wrapped(<UsageDashboardPage />);
    expect(screen.getByText('$250,000')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('portal: neither read may blank the other (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a refused config reload keeps the settings on screen', () => {
    const result = staleRead(portalConfig);
    registry.byUrl = { [PORTAL_CONFIG]: result, [PORTAL_CLIENTS]: ok(portalClients) };
    wrapped(<PortalSettingsPage />);
    expect(screen.getByText('Portal Status')).toBeTruthy();
    expect(screen.getByText('Client Permissions')).toBeTruthy();
    expect(screen.getByText('Coral Realty')).toBeTruthy();
    expect(alerts()).toContain('the portal settings below are the last read');
    expect(claimsOutsideAlerts(/Failed to load your portal settings/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[PORTAL_CLIENTS].refetch).not.toHaveBeenCalled();
  });

  it('an unread config is still an outage over the whole page, not a portal switched off', () => {
    registry.byUrl = { [PORTAL_CONFIG]: failed('Request failed (500)'), [PORTAL_CLIENTS]: ok(portalClients) };
    wrapped(<PortalSettingsPage />);
    expect(screen.queryByText('Portal Status')).toBeNull();
    expect(screen.queryByText('Client Permissions')).toBeNull();
    expect(claimsOutsideAlerts(/Client portal is live/)).toEqual([]);
    expect(alerts()).toContain('Failed to load your portal settings');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a refused clients reload keeps the roster and still counts it', () => {
    const result = staleRead(portalClients);
    registry.byUrl = { [PORTAL_CONFIG]: ok(portalConfig), [PORTAL_CLIENTS]: result };
    wrapped(<PortalSettingsPage />);
    expect(screen.getByText('Coral Realty')).toBeTruthy();
    expect(screen.getByText('Harbor Fitness')).toBeTruthy();
    expect(clientAccessHeader()).toContain('(2)');
    expect(alerts()).toContain('the roster below is the last read');
    expect(claimsOutsideAlerts(/No clients yet/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[PORTAL_CONFIG].refetch).not.toHaveBeenCalled();
  });

  it('an unread roster dashes its own count and never says "No clients yet"', () => {
    registry.byUrl = { [PORTAL_CONFIG]: ok(portalConfig), [PORTAL_CLIENTS]: failed('Request failed (500)') };
    wrapped(<PortalSettingsPage />);
    expect(clientAccessHeader()).toContain('(—)');
    expect(claimsOutsideAlerts(/No clients yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load portal clients');
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [PORTAL_CONFIG]: ok(portalConfig), [PORTAL_CLIENTS]: ok({ data: [] }) };
    wrapped(<PortalSettingsPage />);
    expect(screen.getByText('No clients yet')).toBeTruthy();
    expect(clientAccessHeader()).toContain('(0)');
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when both reads answer', () => {
    registry.byUrl = { [PORTAL_CONFIG]: ok(portalConfig), [PORTAL_CLIENTS]: ok(portalClients) };
    wrapped(<PortalSettingsPage />);
    expect(screen.getByText('Portal Status')).toBeTruthy();
    expect(screen.getByText('Coral Realty')).toBeTruthy();
    expect(clientAccessHeader()).toContain('(2)');
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/csat/page.tsx',
    'app/tenant/settings/usage/page.tsx',
    'app/tenant/settings/portal/page.tsx',
  ];

  it('splits the two states apart on all three pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the dashboard without saying it is the last read`).toMatch(/const \w*[Ss]tale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/[Ff]ailed\s*(?:\?|&&)|if \(\w*[Ff]ailed\)/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*(?:\w*[Ee]rror|error) \? \(/);
      expect(src, `${f} still returns the whole page on any error`).not.toMatch(/if \((?:\w*[Ee]rror|error)\) \{/);
    }
  });

  it('leaves no derived number keyed off the bare flag', () => {
    // `clientsError ? '—' : clients.length` dashes a roster the page is still
    // showing — correct-looking code, and invisible to a screen that only asks
    // whether a failure reaches the page at all.
    for (const f of FILES) {
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} still dashes on the bare flag`)
        .not.toMatch(/\w*[Ee]rror \? '—'/);
    }
    const src = readFileSync(join(ROOT, 'app/tenant/settings/portal/page.tsx'), 'utf8');
    expect(src).toMatch(/Client Access \(\{clientsFailed \? '—' : clients\.length\}\)/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866
    // each had to undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is visible to the guard`).not.toContain(f);
    }
  });

  it('would not have been caught by the guard if the stale banners were deleted', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\w*[Ss]tale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const \w*[Ss]tale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('would not have been caught by the guard with the flags rewound to the bare error', async () => {
    // The regression this file exists to catch: `failed` back to the bare flag keeps
    // the guard, the baseline, the #2829 import and every outage assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\b\w*[Ff]ailed(?=\s*\?|\s*&&|\s*\))/g, 'errorFlag')
        .replace(/const \w*[Ff]ailed = [^\n]*\n/g, '')
        .replace(/if \(\w*[Ff]ailed\) \{/g, 'if (errorFlag) {');
      expect(bare, `${f}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(bare, `${f}: the rewind never reached the gates`).toMatch(/errorFlag/);
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
