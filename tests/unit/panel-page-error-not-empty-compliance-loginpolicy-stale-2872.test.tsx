// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/compliance/page.tsx` and
 * `app/tenant/settings/login-policy/page.tsx`: two Settings panels that bound
 * `data` from their reads and nothing else, so a failure was answered with a
 * fabrication rather than a sentence.
 *
 * What the two pages did at base (measured, not remembered):
 *
 *   `compliance` destructured `{ data, isLoading }` from all three reads
 *   (`['tenant','compliance','retention' | 'gdpr' | 'soc2']`). Each tab renders its
 *   table only under `x.length > 0`, so a read that never answered produced a tab
 *   with a create button and no list and no word about the failure — "no retention
 *   policies", "no GDPR requests" and "no SOC 2 reports" all stated by absence.
 *   `scripts/check-panel-error-state.mjs` cannot see that: its screen needs an
 *   "there are none" SENTENCE under an emptiness test, and this page has none, so
 *   `inspect()` reports it clean both before and after the split below. The refusal
 *   is the routine state, because all three writes end in
 *   `invalidate(['tenant','compliance',key])` on the exact key of the read feeding
 *   the tab the operator is standing in.
 *
 *   `login-policy` destructured `{ data, isLoading }` from
 *   `['tenant','admin','login-policy']` and `['tenant','me']`. With `policyData`
 *   absent the seeding effect never runs, `pol` stays at `DEFAULTS`, and the editor
 *   renders NuCRM's shipped password / 2FA / session / IP-allowlist / sign-up rules
 *   as the workspace's live policy — including the `IP allowlist (0)` heading, a
 *   number derived from that unset state. `isAdmin = meData?.is_admin ?? true` then
 *   opened that editor to a role the page never checked. The page's own PATCH does
 *   not invalidate, so its refused refresh arrives from the remount past the shared
 *   30s `staleTime` (leave Settings, come back) and the default `refetchOnReconnect`;
 *   no other page invalidates either key (measured: `grep` finds the login-policy
 *   key only in this file, and `['tenant','me']` is read by eleven panels, none of
 *   which invalidates it).
 *
 * The write gate is decided from the route (`app/api/tenant/admin/login-policy/route.ts`):
 * the page sends all five sections every save and the route merges section-wise
 * (`COALESCE(settings->'login_policy','{}') || ${safe}::jsonb`), so a section the body
 * carries overwrites what is stored. The route's `concurrencyGuard` only engages on a
 * body carrying `expectedUpdatedAt`, which this page has never sent — the server
 * cannot refuse the collision, so the collision has to be refused here. `compliance`
 * needs no gate: its three POSTs each append one row, the payload comes from the
 * button and not from the read, and the retention route 409s a duplicate entity type,
 * which is the server answering for the collision itself.
 *
 * Fixtures are RFC 2606 `.test` domains and RFC 5737 documentation space only.
 *
 * RED AT BASE — measured on this branch's base (`HEAD` = `df2701bc`, both page files
 * byte-identical to `origin/main`) with the two product files at base and this file as
 * committed: 27 of these 39 cases fail, 12 pass (vitest prints "27 failed | 12 passed
 * (39)"). The 12 that pass at base are the controls that must keep passing: the three
 * answered-empty / answered-not-an-admin controls, the two "says nothing about freshness
 * when the read answers" controls, the pin that compliance gates no appending write, the
 * pin that compliance derives no count to dash, and the four ratchets that were already
 * true of base (no read toast to retire, the guard's blindness to the whole class, the
 * 500-line ceiling, the overlap hygiene). One more deserves naming because it looks like
 * it should have been red: "keeps Save live over the last read and sends the whole map it
 * is holding" — base sent the identical five-section body, so the refusal is the new
 * thing there, not the payload. Everything else is red at base for the reason the class
 * exists: no banner was rendered for a read that never answered, and nothing was said
 * when a kept read's refresh was refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

import ComplianceSettingsPage from '@/app/tenant/settings/compliance/page';
import LoginPolicyPage from '@/app/tenant/settings/login-policy/page';
import toast from 'react-hot-toast';

const RET = '/api/tenant/compliance/retention';
const GDPR = '/api/tenant/compliance/gdpr';
const SOC2 = '/api/tenant/compliance/soc2';
const LOGIN_POLICY = '/api/tenant/admin/login-policy';
const ME = '/api/tenant/me';

const NOW = '2026-10-01T00:00:00Z';

const RETENTION = {
  data: [
    { id: 'rp-1', entityType: 'contacts', retentionDays: 365, action: 'archive', isActive: true },
    { id: 'rp-2', entityType: 'audit_logs', retentionDays: 90, action: 'delete', isActive: false },
  ],
};
const GDPR_REQUESTS = {
  data: {
    exports: [
      { id: 'g-1', type: 'gdpr_export', status: 'completed', requestedBy: 'u-1', completedAt: NOW, createdAt: NOW },
    ],
    deletions: [
      { id: 'g-2', type: 'gdpr_delete', status: 'processing', requestedBy: 'u-1', completedAt: null, createdAt: NOW },
    ],
  },
};
const SOC2_REPORTS = {
  data: [
    { id: 's-1', type: 'soc2_report', status: 'completed', requestedBy: 'u-1', completedAt: NOW, createdAt: NOW },
  ],
};

/** Distinct from the page's `DEFAULTS` in every section, so "the form is showing the
 *  read" and "the form is showing the defaults" are measurably different states. */
const POLICY = {
  login_policy: {
    password: {
      min_length: 14, require_uppercase: true, require_number: true, require_symbol: false,
      max_age_days: 90, prevent_reuse_count: 3,
    },
    two_factor: { enforcement: 'required', grace_period_days: 3 },
    session: { idle_timeout_minutes: 30, max_lifetime_hours: 12, max_concurrent: 2 },
    network: { ip_allowlist_enabled: true, ip_allowlist: ['203.0.113.0/24'] },
    login: { allow_self_signup: false, allowed_email_domains: ['acme.test'], blocked_email_domains: ['spam.test'] },
  },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could name: the read answered, the refresh was refused. */
const refusedRefresh = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Every replacement banner in this
 * class quotes the sentence it retires, so a bare `queryByText(/no policies/)`
 * would find the alert's own copy and report a retired claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const button = (name: RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = button(name);
  return el !== null && el.disabled === false;
};

let client: QueryClient;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};
const mountCompliance = (over: Record<string, QueryResult> = {}) => {
  registry.byUrl = { [RET]: ok(RETENTION), [GDPR]: ok(GDPR_REQUESTS), [SOC2]: ok(SOC2_REPORTS), ...over };
  return wrapped(<ComplianceSettingsPage />);
};
const mountPolicy = (over: Record<string, QueryResult> = {}) => {
  registry.byUrl = { [LOGIN_POLICY]: ok(POLICY), [ME]: ok({ is_admin: true }), ...over };
  return wrapped(<LoginPolicyPage />);
};
const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** Records what each write actually carries, so "the save pushes five whole
 *  sections" and "no `expectedUpdatedAt` is ever sent" are measured, not assumed. */
let writeBodies: Record<string, unknown>[] = [];
function stubWrites(payload: unknown = { ok: true }) {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    writeBodies.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  registry.byUrl = {};
  writeBodies = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('compliance · retention tab: a refused refresh keeps the rows (#2872)', () => {
  it('keeps both policies on screen under a last-read caveat that speaks only for this read', () => {
    const result = refusedRefresh(RETENTION);
    mountCompliance({ [RET]: result });
    expect(screen.getByText('contacts')).toBeTruthy();
    expect(screen.getByText('365 days')).toBeTruthy();
    expect(screen.getByText('audit_logs')).toBeTruthy();
    expect(alerts()).toContain('the retention policies below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The other two tabs' reads answered; their panels say nothing about freshness.
    expect(alerts()).not.toContain('Could not load');
    expect(screen.queryByText('New Retention Policy')).toBeTruthy();
  });

  it('re-runs the retention read and no sibling', () => {
    const result = refusedRefresh(RETENTION);
    mountCompliance({ [RET]: result });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[GDPR].refetch).not.toHaveBeenCalled();
    expect(registry.byUrl[SOC2].refetch).not.toHaveBeenCalled();
  });

  it('a policy the create just wrote is named as what the refusal hides', () => {
    mountCompliance({ [RET]: refusedRefresh(RETENTION) });
    expect(alerts()).toContain('The policy you just created is not in this list');
  });

  it('a refusal over an empty last read is a caveat, never an outage', () => {
    // The read DID answer "there are none"; only the refresh was refused. This is the
    // one state where the absence is the server's own answer, so the caveat stands and
    // #2829's outage sentence must not.
    mountCompliance({ [RET]: refusedRefresh({ data: [] }) });
    expect(alerts()).toContain('last read');
    expect(alerts()).not.toContain('Could not load the retention policies');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('prints a reason, never undefined, when the refusal carries no message', () => {
    mountCompliance({ [RET]: refusedRefresh(RETENTION, '') });
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a read that never answered is an outage, and the missing list stops being an answer', () => {
    mountCompliance({ [RET]: unread('Request failed (500)') });
    expect(alerts()).toContain('Could not load the retention policies: Request failed (500)');
    expect(alerts()).not.toContain('last read');
    // No row, no status badge — the tab may not present a policy state it never read.
    expect(screen.queryByText('contacts')).toBeNull();
    expect(claimsOutsideAlerts(/^Active$/)).toEqual([]);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('a messageless outage still quotes a reason', () => {
    mountCompliance({ [RET]: { data: undefined, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() } });
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the read answers', () => {
    mountCompliance();
    expect(screen.getByText('365 days')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a read that answers "there are none" still says so with no alert', () => {
    mountCompliance({ [RET]: ok({ data: [] }) });
    expect(screen.getByText('New Retention Policy')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('compliance · the operator’s own write is the trigger (#2872)', () => {
  it('creates, invalidates that key, gets refused, and keeps the rows it created', async () => {
    mountCompliance();
    fireEvent.click(screen.getByRole('button', { name: /create policy/i }));
    await waitFor(() => expect(screen.getByText('Retention policy created.')).toBeTruthy());
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tenant', 'compliance', 'retention'] });
    expect(writeBodies[0]).toMatchObject({ entityType: 'contacts', retentionDays: 365, action: 'archive' });

    // The reload that invalidate schedules is the one that comes back refused.
    registry.byUrl = { ...registry.byUrl, [RET]: refusedRefresh(RETENTION) };
    wrapped(<ComplianceSettingsPage />);
    expect(screen.getByText('contacts')).toBeTruthy();
    expect(alerts()).toContain('the retention policies below are the last read');
    expect(alerts()).not.toContain('Could not load the retention policies');
  });

  it('leaves the create form live over the last read, because this write appends', () => {
    // No whole-array replace anywhere on this page: the route 409s a duplicate
    // entity type, so a save cannot clobber what the read did not show — gating it
    // would only make the panel unable to do the thing the operator came for.
    mountCompliance({ [RET]: refusedRefresh(RETENTION) });
    expect(offered(/create policy/i)).toBe(true);
    openTab('GDPR');
    expect(offered(/request data export/i)).toBe(true);
    expect(offered(/request data deletion/i)).toBe(true);
    openTab('SOC 2');
    expect(offered(/generate soc 2 report/i)).toBe(true);
  });

  it('keeps a refused refresh off the tab the operator is not standing in', () => {
    // The three reads are bound together but rendered per tab: a refusal on the
    // GDPR read must not speak over the retention rows, and must appear the moment
    // that tab is opened.
    mountCompliance({ [GDPR]: refusedRefresh(GDPR_REQUESTS) });
    expect(alerts()).toBe('');
    openTab('GDPR');
    expect(alerts()).toContain('the GDPR requests below are the last read');
    expect(screen.getByText('gdpr_export')).toBeTruthy();
    expect(alerts()).toContain('still shows as running here');
  });

  it('the GDPR log that never answered is an outage, not an empty audit trail', () => {
    mountCompliance({ [GDPR]: unread('Request failed (500)') });
    openTab('GDPR');
    expect(claimsOutsideAlerts(/Past Requests/)).toEqual([]);
    expect(alerts()).toContain('Could not load the GDPR request log: Request failed (500)');
    expect(alerts()).not.toContain('last read');
  });

  it('a GDPR read that answers "there are none" says so with no alert', () => {
    mountCompliance({ [GDPR]: ok({ data: { exports: [], deletions: [] } }) });
    openTab('GDPR');
    expect(claimsOutsideAlerts(/Past Requests/)).toEqual([]);
    expect(alerts()).toBe('');
  });

  it('the SOC 2 history that never answered is an outage, and its rows stay gone', () => {
    mountCompliance({ [SOC2]: unread('Request failed (500)') });
    openTab('SOC 2');
    expect(claimsOutsideAlerts(/Generated Reports/)).toEqual([]);
    expect(alerts()).toContain('Could not load the SOC 2 report history');
  });

  it('a refused SOC 2 refresh keeps the reports and names the reaping it hides', () => {
    mountCompliance({ [SOC2]: refusedRefresh(SOC2_REPORTS) });
    openTab('SOC 2');
    expect(screen.getByText('SOC 2 Compliance Report')).toBeTruthy();
    expect(alerts()).toContain('the reports below are the last read');
    expect(alerts()).toContain('reap as failed');
    expect(screen.getByRole('button', { name: /generate soc 2 report/i })).toBeTruthy();
  });

  it('the SOC 2 and GDPR outages retry their own read, never the retention one', () => {
    const soc2 = refusedRefresh(SOC2_REPORTS);
    mountCompliance({ [SOC2]: soc2 });
    openTab('SOC 2');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(soc2.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[RET].refetch).not.toHaveBeenCalled();
  });

  it('dashes no count it never derives', () => {
    // The tab labels are the only derived-looking numbers near this bug class, and
    // they are static copy: this page computes no totals, so there is nothing to
    // dash and `failed` must not be spent inventing one.
    mountCompliance({ [RET]: unread(), [GDPR]: unread(), [SOC2]: unread() });
    for (const label of ['Data Retention', 'GDPR', 'SOC 2']) {
      expect(screen.getByRole('button', { name: label }).textContent).toBe(label);
    }
    expect(readFileSync(join(process.cwd(), 'app/tenant/settings/compliance/page.tsx'), 'utf8'))
      .not.toMatch(/\? '—' :/);
  });
});

describe('login-policy: an unread read may not present the defaults as the policy (#2872)', () => {
  it('a refused refresh keeps the live values and pays for the next save in the caveat', () => {
    const result = refusedRefresh(POLICY);
    mountPolicy({ [LOGIN_POLICY]: result });
    expect(screen.getByDisplayValue('14')).toBeTruthy();
    expect(screen.getByDisplayValue('90')).toBeTruthy();
    expect(screen.getByText('acme.test')).toBeTruthy();
    expect(screen.getByText('203.0.113.0/24')).toBeTruthy();
    expect(alerts()).toContain('the policy below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('Saving now writes these five sections');
    expect(alerts()).not.toContain('built-in defaults');
    expect(result.refetch).not.toHaveBeenCalled();
  });

  it('re-runs the policy read alone, and leaves the role check untouched', () => {
    const result = refusedRefresh(POLICY);
    mountPolicy({ [LOGIN_POLICY]: result });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[ME].refetch).not.toHaveBeenCalled();
  });

  it('keeps Save live over the last read and sends the whole map it is holding', async () => {
    // The payload is the last read plus the operator's keystrokes, which is why this
    // state must NOT block the write — and the measured body is the proof of it.
    mountPolicy({ [LOGIN_POLICY]: refusedRefresh(POLICY) });
    fireEvent.change(screen.getByDisplayValue('14'), { target: { value: '16' } });
    expect(offered(/save policy/i)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(writeBodies).toHaveLength(1));
    expect(writeBodies[0]).toEqual({
      login_policy: {
        ...POLICY.login_policy,
        password: { ...POLICY.login_policy.password, min_length: 16 },
      },
    });
    expect(JSON.stringify(writeBodies[0])).not.toContain('expectedUpdatedAt');
  });

  it('a kept row is still actionable over the last read', () => {
    mountPolicy({ [LOGIN_POLICY]: refusedRefresh(POLICY) });
    const chip = screen.getByText('203.0.113.0/24');
    const remove = chip.parentElement?.querySelector('button') as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(screen.queryByText('203.0.113.0/24')).toBeNull();
    expect(alerts()).toContain('the policy below is the last read');
  });

  it('an unread policy is an outage that says what the next save would have cost', () => {
    mountPolicy({ [LOGIN_POLICY]: unread('Request failed (500)') });
    expect(alerts()).toContain('Could not load this workspace\'s security policy: Request failed (500)');
    expect(alerts()).toContain('built-in defaults');
    expect(alerts()).not.toContain('last read');
    expect(screen.queryByText('Password policy')).toBeTruthy();
  });

  it('the Save control over an unread read is refused, and nothing reaches the server (epic rule #1)', () => {
    // `pol` is DEFAULTS here, so the PATCH would write the shipped password, 2FA,
    // session, IP-allowlist and sign-up rules over the live policy — and the route
    // has no precondition to answer back (app/api/tenant/admin/login-policy/route.ts
    // guards only a body carrying `expectedUpdatedAt`, which this page never sends).
    // Honest limitation, measured: this assertion cannot distinguish the new gate from
    // base, because `dirty` is already false whenever the read never answered — the
    // DOM looks the same either way. The ratchet below pins the explicit gate; what
    // this state changed for the operator is the banner, which now says why Save is
    // dead instead of leaving a silent dead control over a form of defaults.
    mountPolicy({ [LOGIN_POLICY]: unread() });
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '8' } });
    expect(offered(/save policy/i), 'Save is clickable over a policy the page never read').toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(alerts()).toContain('the Save control is disabled');
  });

  it('dashes the allowlist tally the read never fed, and keeps a real zero', () => {
    const header = () => screen.getByText(/IP allowlist \(/).textContent ?? '';
    mountPolicy({ [LOGIN_POLICY]: unread() });
    expect(header()).toContain('(—)');
    cleanup();
    mountPolicy({ [LOGIN_POLICY]: refusedRefresh(POLICY) });
    expect(header()).toContain('(1)');
    cleanup();
    mountPolicy({
      [LOGIN_POLICY]: ok({
        login_policy: {
          ...POLICY.login_policy,
          network: { ip_allowlist_enabled: false, ip_allowlist: [] },
        },
      }),
    });
    expect(header()).toContain('(0)');
    expect(alerts()).toBe('');
  });

  it('prints a reason, never undefined, when the refusal carries no message', () => {
    mountPolicy({ [LOGIN_POLICY]: refusedRefresh(POLICY, '') });
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('an unread role check is an outage, and the editor never opens on a guess', () => {
    mountPolicy({ [ME]: unread('Request failed (500)') });
    expect(claimsOutsideAlerts(/Password policy/)).toEqual([]);
    expect(alerts()).toContain('Could not confirm your role, so this page cannot show the security-policy editor: Request failed (500)');
    expect(offered(/save policy/i)).toBe(false);
  });

  it('the role outage retries the role read alone', () => {
    const me = unread();
    mountPolicy({ [ME]: me });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(me.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[LOGIN_POLICY].refetch).not.toHaveBeenCalled();
  });

  it('a refused role refresh keeps the gate it had and says so', () => {
    mountPolicy({ [ME]: refusedRefresh({ is_admin: true }) });
    expect(screen.getByText('Password policy')).toBeTruthy();
    expect(alerts()).toContain('the admin gate on this editor is the last read');
    expect(alerts()).not.toContain('Could not confirm your role');
  });

  it('a role check that answers "not an admin" says so with no alert', () => {
    mountPolicy({ [ME]: ok({ is_admin: false }) });
    expect(screen.getByText('Admins only')).toBeTruthy();
    expect(claimsOutsideAlerts(/Password policy/)).toEqual([]);
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when both reads answer', () => {
    mountPolicy();
    expect(screen.getByText('Two-factor authentication')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('required');
    expect(screen.getByText('spam.test')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const COMPLIANCE = 'app/tenant/settings/compliance/page.tsx';
  const LOGIN = 'app/tenant/settings/login-policy/page.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('binds the split to every read on both pages', () => {
    const c = src(COMPLIANCE);
    for (const [err, data] of [['retError', 'retData'], ['gdprError', 'gdprData'], ['soc2Error', 'soc2Data']]) {
      expect(c, `${err} never separates the outage from a refused refresh`)
        .toMatch(new RegExp(`const \\w+Failed = Boolean\\(${err}\\) && !${data};`));
      expect(c, `${err} keeps rows without calling them the last read`)
        .toMatch(new RegExp(`const \\w+Stale = Boolean\\(${err}\\) && Boolean\\(${data}\\);`));
      expect(c, `${err} prints a reason that can be undefined`)
        .toMatch(new RegExp(`${err}\\?\\.message \\|\\| 'no response from the server'`));
    }
    const l = src(LOGIN);
    for (const [err, data] of [['policyError', 'policyData'], ['meError', 'meData']]) {
      expect(l, `${err} never separates the outage from a refused refresh`)
        .toMatch(new RegExp(`const ${err.replace('Error', '')}Failed = Boolean\\(${err}\\) && !${data};`));
      expect(l, `${err} keeps the policy without calling it the last read`)
        .toMatch(new RegExp(`const ${err.replace('Error', '')}Stale = Boolean\\(${err}\\) && Boolean\\(${data}\\);`));
      expect(l, `${err} prints a reason that can be undefined`)
        .toMatch(new RegExp(`${err}\\?\\.message \\|\\| 'no response from the server'`));
    }
  });

  it('renders no branch off the bare flag, and binds every banner to its own refetch', () => {
    for (const f of [COMPLIANCE, LOGIN]) {
      const s = src(f);
      expect(s, `${f} still gates something on the bare error flag`).not.toMatch(/\{\w*[Ee]rror && /);
      expect(s, `${f} still early-returns the page on the bare error flag`).not.toMatch(/if \(\w*[Ee]rror\) return/);
      expect(s, `${f} never reads the failure off its query hooks`).toMatch(/error: \w+Error/);
    }
    const c = src(COMPLIANCE);
    expect(c).toMatch(/onRetry=\{\(\) => void refetchRetention\(\)\}/);
    expect(c).toMatch(/onRetry=\{\(\) => void refetchGdpr\(\)\}/);
    expect(c).toMatch(/onRetry=\{\(\) => void refetchSoc2\(\)\}/);
    const l = src(LOGIN);
    expect(l).toMatch(/onRetry=\{\(\) => void refetchPolicy\(\)\}/);
    expect(l).toMatch(/onRetry=\{\(\) => void refetchMe\(\)\}/);
  });

  it('leaves no read state to be carried by a toast or a message slot', () => {
    // Neither page had a read toast to retire — the failure had NO channel, which is
    // why both looked healthy. This pins that the split did not add one either: the
    // banner is the only channel for a read state, and `message`/`toast` stay writes.
    for (const f of [COMPLIANCE, LOGIN]) {
      const s = src(f);
      expect(s, `${f} toasts a read failure`).not.toMatch(/^\s*if \(\w*[Ee]rror\) toast\.error/m);
      expect(s, `${f} routes a read failure through a useEffect`).not.toMatch(/useEffect\([^)]*\{[^}]*\w+Error[^}]*toast/s);
      expect(s, `${f} renders a read failure into the write-message slot`)
        .not.toMatch(/setMessage\([^)]*\w+(?:Error|Reason)/);
    }
    expect(src(LOGIN)).toMatch(/onError: \(e: Error\) => toast\.error\(e\.message \|\| 'Failed to save'\)/);
  });

  it('keeps the whole-map replace gated and the appending writes free', () => {
    const l = src(LOGIN);
    expect(l, 'the save handler still runs over a read that never answered').toMatch(/if \(policyFailed\) return;/);
    expect(l, 'the Save control is still clickable over a read that never answered')
      .toMatch(/disabled=\{saving \|\| !dirty \|\| policyFailed\}/);
    expect(l, 'the PATCH body grew a precondition the route would have to honour')
      .toMatch(/body: JSON\.stringify\(\{ login_policy: pol \}\)/);
    expect(l, 'the last-read caveat no longer prices the next save')
      .toMatch(/\{policyStale && \(\n[\s\S]*?the policy below is the last read: \$\{policyReason\}[\s\S]*?Saving now writes these five sections/);
    const c = src(COMPLIANCE);
    expect(c, 'an appending write was gated on a read state').not.toMatch(/disabled=\{saving \|\| \w+Failed\}/);
  });

  it('reports both pages clean to the panel-error-state guard, and stays blind to this class', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of [COMPLIANCE, LOGIN]) {
      const s = src(f);
      expect(inspect(f, s).offends, `${f} is now visible to the guard`).toBe(false);

      // …with the stale caveats deleted…
      const noStale = s
        .replace(/\n\s*\{\w*Stale && \(\n[\s\S]*?\n\s*\)\}(?=\n)/g, '\n')
        .replace(/const \w*Stale = [^\n]*\n/g, '');
      expect(noStale, `${f}: the caveat block changed shape, update this check`).not.toBe(s);
      expect(noStale, `${f}: the rewind left a stale banner standing, so blindness proves nothing`)
        .not.toMatch(/\w+Stale && \(/);
      expect(noStale).not.toMatch(/const \w+Stale = /);
      expect(inspect(f, noStale).offends, `${f} would be caught with the caveat gone`).toBe(false);

      // …and with the outage arms rewound onto the bare flag.
      const bare = s
        .replace(/\b\w*Failed(?=\s*(?:&&|\?|\|\||\)|\}))/g, 'errorFlag')
        .replace(/const \w*Failed = [^\n]*\n/g, '');
      expect(bare, `${f}: the outage arm changed spelling, update this check`).not.toBe(s);
      expect(bare).toMatch(/errorFlag/);
      expect(bare, `${f}: the rewind left a failed arm standing, so blindness proves nothing`)
        .not.toMatch(/\w+Failed && \(|if \(\w+Failed\)|const \w+Failed = /);
      expect(inspect(f, bare).offends, `${f} would be caught with the flags rewound`).toBe(false);
    }

    // The strongest form of the blindness: the guard looked at these exact sources at
    // base, with no split at all, and reported nothing.
    for (const f of [COMPLIANCE, LOGIN]) {
      const shown = spawnSync('git', ['show', `origin/main:${f}`], { cwd: ROOT, encoding: 'utf8' });
      expect(shown.status, shown.stderr).toBe(0);
      expect(shown.stdout).not.toMatch(/Boolean\(\w+Error\) && !\w+Data/);
      expect(inspect(f, shown.stdout).offends, `${f} offended at base — this slice is not the class`).toBe(false);
    }
  });

  it('keeps #2829’s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality. #2829's last slice emptied this file; every page
    // in this epic is expected to leave it empty.
    expect(files.length).toBeLessThanOrEqual(0);
    for (const f of [COMPLIANCE, LOGIN]) {
      expect(files, `${f} should never be baselined`).not.toContain(f);
    }
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [COMPLIANCE, LOGIN]) {
      const lines = src(f).split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves no other suite speaking about a last read for these pages', () => {
    // Overlap hygiene: #2829 never mounted either page (neither had an absence
    // sentence for its screen to find), and the one pre-existing test that reads this
    // source is about the entity dropdown. None of them may start claiming freshness.
    const listed = spawnSync('grep', ['-rEl', 'settings/compliance/page|settings/login-policy/page', 'tests'], {
      cwd: ROOT, encoding: 'utf8',
    });
    expect(listed.status, listed.stderr).toBe(0);
    const hits = listed.stdout.split('\n').filter(Boolean);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const f of hits) {
      if (f.endsWith('panel-page-error-not-empty-compliance-loginpolicy-stale-2872.test.tsx')) continue;
      expect(readFileSync(join(ROOT, f), 'utf8'), `${f} started talking about a last read`).not.toMatch(/last read|refused refresh|stale =/);
    }
    expect(readFileSync(join(ROOT, 'tests/unit/retention-policy-entity-type.test.ts'), 'utf8'))
      .toMatch(/ACCEPTED_ENTITY_TYPES/);
  });
});
