// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/tenants/[id]/settings/page.tsx`: the settings-audit page that
 * invented a tenant when its one read never answered, and said nothing when a refresh of
 * an answered read was refused.
 *
 * One read — `['superadmin','tenant-settings',tenantId]` →
 * `/api/superadmin/tenant-settings?tenant_id=<id>`, `{enabled: !!tenantId, retry: false}` —
 * and at base the page turned its failure into a record:
 *
 *     const loading = settingsQuery.isLoading;
 *     const data: TenantSettingsData | null = settingsQuery.data
 *       ?? (settingsQuery.isError
 *         ? { tenant: { name: '', slug: '', plan_id: '', status: '', active_members: 0, current_users: 0, current_contacts: 0, current_deals: 0 }, settings: {}, error: true }
 *         : null);
 *
 * A request that never got through was replaced by a synthesised tenant with a blank name,
 * a blank slug, a blank plan, a blank status and FOUR ZERO QUOTAS — members, users,
 * contacts and deals — which is the fabricated shape the class is about. The `error: true`
 * sentinel meant the fabrication at least fell into `if (!data || data.error)`, so the
 * outage printed the bare sentence `Could not load tenant settings`: no reason, no retry,
 * and no statement of what was unanswered. That sentinel was the page talking to itself —
 * the GET answers with `{ tenant, settings }` and every failure path leaves through a
 * non-2xx body (`apiFetcher` throws, so `useQuery` parks an error), so `data.error` could
 * never be true on a payload that arrived.
 *
 * The half base never handled at all is the other one. A failed REFETCH keeps `data` and
 * sets the error, so `settingsQuery.data` won, the whole configuration rendered — the
 * timezone, the `require_2fa` enforcement, the ip_allowlist flag and its CIDR count, the
 * session limits, the member and quota figures, the picklist census — and nothing on the
 * screen said it had not been re-checked. Worse, the seeding effect handed exactly that snapshot to
 * `editedSettings`, and the only write on the page PATCHes it back as the whole `settings`
 * map: the handler re-reads the row only to merge (route.ts:101-105,117-125), and its
 * optimistic guard is INERT for this caller because the body carries no `expectedUpdatedAt`
 * (route.ts:109 → lib/api/concurrency.ts:103 returns null when absent). So a Save over a
 * last read reverts any sub-tree another platform admin changed since — and, since the GET
 * answers `localization: null` when the tenant has no override (route.ts:75-78) and the
 * merge DELETES a sub-tree sent as null (route.ts:120-121), it deletes an override they
 * added since outright. That is what the stale banner says, and it is why the editor is
 * gated on `failed` (there is no snapshot to write back) but stays enabled on `stale`
 * (saving is the operator's call, and the cost is named above the fields it applies to).
 *
 * `failed = Boolean(error) && !data` now owns the region the fabricated tenant sat in —
 * header, the four quota figures, every section and the Edit control are all past that
 * return, so the `?? 0` tallies (`holidays?.length ?? 0`, `ip_allowlist?.length ?? 0`,
 * `(list?.length ?? 0)`, `+{list.length - 12} more`) cannot render for a read that never
 * answered, and the outage copy says what is unanswered and that this is not a tenant with
 * no overrides. `stale = Boolean(error) && Boolean(data)` keeps the configuration with the
 * caveat ABOVE it and re-runs this read. One read, so the spinner waits on that read alone.
 *
 * RED AT BASE — measured on `ffef1659` (this branch's base) with
 * `app/superadmin/tenants/[id]/settings/page.tsx` rewound to what main carries and this
 * file as committed: **17 failed | 4 passed (21)**. Nine of the seventeen put the read in a
 * state the class is about: the null quota base printed as a zero, the refused refresh that
 * kept the configuration silently, what that refusal costs, the save fired off the kept
 * snapshot, the outage that at base still printed its reason-less sentence with the
 * fabricated tenant's header and Edit control reachable, the Edit control across all three
 * states, both messageless refusals (which printed `undefined`), and the good → refused →
 * good walk. The other eight are the source ratchets — the three-state split, the fabricated
 * tenant's retirement, the dash keyed off a null counter rather than a zero, the
 * banner-before-content ordering, the two house templates, the retry that names this read,
 * and the guard's blindness to the class before and after the split is rewound. The
 * seventeenth is not this slice's: `stays inside the line ceiling the page is allowed` spawns
 * `scripts/check-file-size.mjs`, and #2986 left three grandfathered components past their
 * baseline on main, so that pin is red at base, red at head and red in the 67 other suites
 * that run the guard — #3009 returns it to green (measured: 21 passed on top of it). The 4
 * that pass at base are the behaviour this slice must not regress: the healthy read that says
 * nothing about freshness, the first-load spinner, #2829's guard + baseline, and the
 * overlap-hygiene pin that leaves this page to exactly one suite.
 *
 * Fixtures are documentation-only (RFC 2606 names, TEST-NET CIDRs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
// The page still toasts — but only from its mutation callbacks. Mocking the channel is how
// this suite proves a READ failure cannot be routed there: every failure assertion below
// reads `role="alert"`, and the outage cases assert the whole content subtree is gone.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// A route-id page: the tenant in the URL is what the one read asks about.
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'acme-hq' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/superadmin/tenants/acme-hq/settings',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import TenantSettingsAuditPage from '@/app/superadmin/tenants/[id]/settings/page';

const SETTINGS = '/api/superadmin/tenant-settings?tenant_id=acme-hq';

const answered = {
  tenant: {
    id: 'acme-hq', name: 'Acme Freight', slug: 'acme-freight', status: 'active',
    plan_id: 'enterprise', current_users: 12, current_contacts: 340, current_deals: 21,
    active_members: 7, created_at: '2026-01-05T00:00:00Z',
  },
  settings: {
    localization: {
      timezone: 'Asia/Kolkata', currency: 'USD', fiscal_year_start_month: 4,
      week_start: 'mon', number_format: 'us', weekend_days: ['sat'],
      business_hours: { enabled: true, start_time: '09:30', end_time: '18:00', working_days: ['mon', 'tue'] },
      holidays: [{ name: 'Founders Day' }, { name: 'Winter Break' }],
    },
    login_policy: {
      password: { min_length: 12, max_age_days: 0, prevent_reuse_count: 3, require_uppercase: true, require_number: true, require_symbol: false },
      two_factor: { enforcement: 'required', grace_period_days: 7 },
      session: { idle_timeout_minutes: 30, max_lifetime_hours: 12, max_concurrent: 2 },
      network: { ip_allowlist_enabled: true, ip_allowlist: ['203.0.113.0/24', '198.51.100.7/32'] },
      login: { allow_self_signup: false, allowed_email_domains: ['acme.test'], blocked_email_domains: [] },
    },
    picklists: {
      lead_sources: [{ value: 'website', label: 'Website' }, { value: 'referral', label: 'Referral' }],
      industries: [{ value: 'logistics', label: 'Logistics' }],
    },
    other_keys: ['billing_notes'],
  },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** Nothing in hand — the read never answered. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh was refused and the payload came back with it. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** First load of the one read — nothing has been answered yet. */
const pending = (): QueryResult => ({ data: undefined, error: null, isLoading: true, refetch: vi.fn() });

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Both banners quote the sentences they
 * retire in prose, so a bare `queryByText(...)` could report a false claim as still
 * standing by finding the caveat's own words.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

/** The figure a `<Stat>` card prints under its label. */
function statValue(label: string): string {
  const card = screen.getByText(label).parentElement as HTMLElement;
  return (card.textContent ?? '').replace(label, '').trim();
}

const tree = (node: ReactNode) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
  >
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('tenant settings audit: one read, two opposite failures (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('an answered read shows the tenant, its figures and its configuration, and says nothing about freshness', () => {
    registry.byUrl = { [SETTINGS]: ok(answered) };
    wrapped(<TenantSettingsAuditPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('acme-freight')).toBeTruthy();
    expect(screen.getByText('enterprise')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
    expect(statValue('Members')).toBe('7');
    expect(statValue('Users')).toBe('12');
    expect(statValue('Contacts')).toBe('340');
    expect(statValue('Deals')).toBe('21');
    expect(screen.getByText('Asia/Kolkata')).toBeTruthy();
    expect(screen.getByText('2 configured')).toBeTruthy();
    expect(screen.getByText('required')).toBeTruthy();
    expect(screen.getByText('2 CIDR')).toBeTruthy();
    expect(screen.getByText('acme.test')).toBeTruthy();
    expect(screen.getByText('billing_notes')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a quota the read left null is a dash, and a quota the read answered 0 is still 0', () => {
    // The base `<p>{value ?? 0}</p>` dressed an absent counter up as a count of nothing;
    // a real zero the server reported must not be punished for the fix.
    registry.byUrl = {
      [SETTINGS]: ok({ ...answered, tenant: { ...answered.tenant, current_contacts: null, current_deals: 0 } }),
    };
    wrapped(<TenantSettingsAuditPage />);
    expect(statValue('Contacts')).toBe('—');
    expect(statValue('Deals')).toBe('0');
  });

  it('a refused refresh keeps the whole configuration on screen and calls it the last read', () => {
    const read = staleRead(answered);
    registry.byUrl = { [SETTINGS]: read };
    wrapped(<TenantSettingsAuditPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('Asia/Kolkata')).toBeTruthy();
    expect(screen.getByText('2 CIDR')).toBeTruthy();
    expect(screen.getByText('required')).toBeTruthy();
    expect(statValue('Members')).toBe('7');
    expect(alerts()).toContain('last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would claim the read never answered; the fabricated tenant's
    // blanks must not come back either.
    expect(claimsOutsideAlerts(/Failed to load this tenant's settings/)).toEqual([]);
    expect(screen.queryByText('Could not load tenant settings')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the refusal says what saving over the last read costs, in the operator\'s terms', () => {
    registry.byUrl = { [SETTINGS]: staleRead(answered) };
    wrapped(<TenantSettingsAuditPage />);
    const said = alerts();
    // Which figure is not a count, and whose change the write reverts.
    expect(said).toContain('A member added since is not in that count');
    expect(said).toContain('a login policy someone tightened since is not shown');
    expect(said).toContain('Save writes this snapshot back over the whole localization, login-policy, picklist and user-defaults block');
    expect(said).toContain('reverting what another platform admin changed since this was fetched');
    expect(said).toContain('deleting an override they added since outright');
    // #3: the reason is quoted, not a server internal the page invented.
    expect(said).toContain(': Request failed (504).');
    expect(said).not.toMatch(/\b(endpoint|route|status code)\b/i);
  });

  it('the kept read is still editable, and the save it fires sends the last read back', async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return { ok: true, status: 200, json: async () => ({ ok: true, message: 'Settings updated' }) };
    }));
    registry.byUrl = { [SETTINGS]: staleRead(answered) };
    wrapped(<TenantSettingsAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /edit settings/i }));
    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls).toHaveLength(1), { interval: 10 });
    const [url, init] = calls[0];
    expect(url).toBe('/api/superadmin/tenant-settings');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as { tenant_id: string; settings: unknown };
    expect(body.tenant_id).toBe('acme-hq');
    expect(body.settings).toEqual(answered.settings);
    // The caveat survives the click — it is a statement about the data, not a dialog.
    expect(alerts()).toContain('last read');
  });

  it('an outage owns the region: no header, no Edit, no settings, and no fabricated zeros', () => {
    registry.byUrl = { [SETTINGS]: failed('Request failed (500)') };
    wrapped(<TenantSettingsAuditPage />);
    // Everything the false record was made of.
    expect(screen.queryByText(/Settings audit/)).toBeNull();
    expect(screen.queryByText('Acme Freight')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.queryByText('Contacts')).toBeNull();
    expect(screen.queryByText('Localization')).toBeNull();
    expect(screen.queryByText('Picklists')).toBeNull();
    expect(screen.queryByRole('button', { name: /edit settings/i })).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(claimsOutsideAlerts(/Could not load tenant settings/)).toEqual([]);
    // What the outage says instead: the reason, and what is unanswered.
    expect(alerts()).toContain('Failed to load this tenant\'s settings: Request failed (500)');
    expect(alerts()).toContain('not the same as a tenant with no overrides');
    expect(alerts()).not.toContain('last read');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SETTINGS].refetch).toHaveBeenCalledTimes(1);
  });

  it('the Edit control tracks the three states: offered, kept, gone', () => {
    registry.byUrl = { [SETTINGS]: ok(answered) };
    wrapped(<TenantSettingsAuditPage />);
    expect((screen.getByRole('button', { name: /edit settings/i }) as HTMLButtonElement).disabled).toBe(false);

    registry.byUrl = { [SETTINGS]: staleRead(answered) };
    wrapped(<TenantSettingsAuditPage />);
    expect(screen.getByRole('button', { name: /edit settings/i })).toBeTruthy();

    registry.byUrl = { [SETTINGS]: failed('Request failed (500)') };
    wrapped(<TenantSettingsAuditPage />);
    expect(screen.queryByRole('button', { name: /edit settings/i })).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [SETTINGS]: staleRead(answered, '') };
    wrapped(<TenantSettingsAuditPage />);
    expect(alerts()).toContain('last read: no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(alerts()).not.toContain('null');
    expect(screen.getByText('Acme Freight')).toBeTruthy();
  });

  it('an outage with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [SETTINGS]: failed('') };
    wrapped(<TenantSettingsAuditPage />);
    expect(alerts()).toContain('Failed to load this tenant\'s settings: no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.queryByText(/Settings audit/)).toBeNull();
  });

  it('the first load of the one read is a spinner, with no banner and no invented tenant', () => {
    registry.byUrl = { [SETTINGS]: pending() };
    wrapped(<TenantSettingsAuditPage />);
    expect(document.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Settings audit/)).toBeNull();
    expect(screen.queryByRole('button', { name: /edit settings/i })).toBeNull();
    expect(alerts()).toBe('');
  });

  it('walks the walk: an answered read, a refused refresh, and an answered read again', async () => {
    registry.byUrl = { [SETTINGS]: ok(answered) };
    const view = wrapped(<TenantSettingsAuditPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });

    registry.byUrl = { [SETTINGS]: staleRead(answered) };
    view.rerender(tree(<TenantSettingsAuditPage />));
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(alerts()).toContain('last read');

    registry.byUrl = { [SETTINGS]: ok({ ...answered, tenant: { ...answered.tenant, active_members: 8 } }) };
    view.rerender(tree(<TenantSettingsAuditPage />));
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });
    expect(statValue('Members')).toBe('8');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/superadmin/tenants/[id]/settings/page.tsx';
  const src = () => readFileSync(join(ROOT, PAGE), 'utf8');

  it('splits the one read into the three states it has', () => {
    const s = src();
    expect(s).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(s).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(s, 'the outage arm was not made to own the region').toMatch(/\bif \(failed \|\| !data\) return \(/);
    expect(s, 'the kept read still carries no saying-it-is-the-last-read banner').toMatch(/\{stale && \(/);
    expect(s, 'the spinner now waits on more than this read').not.toMatch(/isLoading\s*\|\|/);
  });

  it('retires the fabricated tenant entirely', () => {
    const s = src();
    // Anchored to line starts / assignment shapes, so the WHY comment describing the base
    // in prose cannot trip these — only the code shape can.
    expect(s, 'the page still reads the failure off the bound object').not.toMatch(/settingsQuery\.isError/);
    expect(s, 'the synthesis of a tenant from a flag came back')
      .not.toMatch(/^\s*\?\?\s*\(settingsQuery\.isError/m);
    expect(s, 'a blank tenant literal is still standing')
      .not.toMatch(/\{ name: '', slug: ''/);
    expect(s, 'the invented quota zeros are still being handed to Stat')
      .not.toMatch(/active_members: 0, current_users: 0/);
    expect(s, 'the sentinel that let the fabrication in is still branched on').not.toMatch(/data\.error/);
    expect(s, 'the reason-less, retry-less sentence is still the outage').not.toMatch(/Could not load tenant settings/);
  });

  it('dashes a figure the read left null instead of calling it zero', () => {
    const s = src();
    expect(s, 'a counter the payload left null is printed as a count of nothing').not.toMatch(/value \?\? 0/);
    expect(s).toMatch(/\{value \?\? '—'\}/);
    // A null that comes from the read, not from a flag: no figure keyed off the bare error.
    expect(s, 'the page punishes a kept read with a dash').not.toMatch(/\w*[Ee]rror \? '—'/);
  });

  it('puts the caveat above the content it caveats, and the outage in front of all of it', () => {
    const s = src();
    const banner = s.indexOf('{stale && (');
    const header = s.indexOf('<h1');
    const outage = s.indexOf('if (failed || !data) return (');
    expect(banner).toBeGreaterThan(-1);
    expect(outage).toBeGreaterThan(-1);
    expect(outage, 'the outage arm sits below the content it must replace').toBeLessThan(header);
    expect(banner, 'the stale banner renders after the settings it calls the last read').toBeLessThan(header);
  });

  it('speaks in exactly the two house templates, both quoting the reason, neither naming the server', () => {
    const templates = src().match(/message=\{`[^`]*`\}/g) ?? [];
    expect(templates, 'this page has a different number of banners than the slice made').toHaveLength(2);
    for (const t of templates) {
      expect(t).toContain('${reason}');
      expect(t, `a banner quotes a status code it typed itself: ${t}`).not.toMatch(/\(\d{3}\)/);
      expect(t, `a banner names server internals: ${t}`).not.toMatch(/\b(endpoint|route|status code)\b/i);
      expect(t, `a banner quotes a source path: ${t}`).not.toMatch(/[\w-]+\/[\w.-]+\.tsx?\b/);
      expect(t, `a banner is vague about what moved: ${t}`).not.toMatch(/may be out of date|may not be reflected|some data/);
    }
    expect(templates.some((t) => /Failed to load/.test(t)), 'no outage template').toBe(true);
    expect(templates.some((t) => /Could not refresh/.test(t)), 'no stale template').toBe(true);
  });

  it('retries by re-running this read, never by reloading the page or re-cutting the cache', () => {
    const s = src();
    expect(s, 'a banner no longer re-runs the read it failed').toMatch(/onRetry=\{refetch\}/);
    expect(s, 'an onRetry reached for the whole page').not.toMatch(/location\.reload/);
    expect(s, 'a banner is invalidating queries instead of refetching its own read')
      .not.toMatch(/onRetry=\{[^}]*invalidateQueries/);
    // The retry count is exactly the two banners — the mutation's onSuccess invalidate is
    // the write's own business and stays.
    expect(s.match(/onRetry=/g)).toHaveLength(2);
    expect(s).toMatch(/queryClient\.invalidateQueries\(\{ queryKey: \['superadmin', 'tenant-settings', tenantId\] \}\)/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files, `${PAGE} should never have been baselined`).not.toContain(PAGE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/, '\n'],
      [/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);\n/, 'const failed = Boolean(error);\n'],
    ];
    const s = src();
    expect(inspect(PAGE, s).offends, `${PAGE} was already on the guard's list`).toBe(false);
    for (const [pattern, replacement] of rewinds) {
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(
        inspect(PAGE, s.replace(pattern, replacement)).offends,
        `${PAGE} would be visible to the guard once the split is taken back out: ${replacement}`,
      ).toBe(false);
    }
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${PAGE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves this page to exactly one suite', () => {
    const own = 'panel-page-error-not-empty-superadmin-tenantsettings-stale-2872.test.tsx';
    const dir = join(ROOT, 'tests/unit');
    const mounters = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => /tenants\/\[id\]\/settings\/page/.test(readFileSync(join(dir, f), 'utf8')));
    expect(mounters, 'two suites mounting one page is how copy diverges').toEqual([own]);
    expect(readFileSync(join(dir, own), 'utf8')).toMatch(/last read/);
  });
});
