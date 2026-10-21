// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2872 — `app/superadmin/adoption/page.tsx`: two reads, one judgement each.
 *
 * On base (`be35db54`) the page made a single call about both reads
 * (`adoptionQuery.isLoading || activityQuery.isLoading` skeletonized the screen
 * while either was in flight) and, once settled, `if (!data) return <outage>` for
 * the adoption read while the activity read never got judged at all: a failed
 * activity read fell through `activity?.critical ?? []` and printed "No recent
 * activity." — an absence sentence for a read that never ran — and a refused
 * refresh kept TanStack's `data`, so both regions stayed on screen saying nothing.
 *
 * Each read now has three states, judged per read:
 *   failed = Boolean(error) && !data — outage sentence, every derived figure withheld;
 *   stale  = Boolean(error) && Boolean(data) — rows kept, banner ABOVE them naming
 *            the specific loss, retry calling only that read's refetch;
 *   healthy — rows, or an honest empty sentence, with no banner.
 *
 * Fixtures are documentation-only (`*.test`, RFC 2606 names).
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

import AdoptionPage from '@/app/superadmin/adoption/page';

const ADOPTION = '/api/superadmin/adoption';
const ACTIVITY = '/api/superadmin/recent-activity?limit=20';

const adoption = {
  total_tenants: 40,
  adoption: { localization: 30, login_policy: 22, picklists: 15, user_defaults: 34 },
  drift: { weak_password_policy: 5, two_factor_off: 8, two_factor_required: 27, ip_allowlist_on: 3, self_signup_on: 2 },
  users: { total: 120, with_prefs: 90, out_of_office_now: 4 },
};

const auditRow = (id: string, action: string, entity: string, tenant: string) => ({
  id, action, entity_type: entity, created_at: new Date().toISOString(),
  new_data: { count: 3 }, tenant_id: `t-${id}`, tenant_name: tenant,
  user_id: 'u1', user_name: 'Alice Test', user_email: 'alice@test.example',
});

const activity = {
  bulk_ops: [auditRow('b1', 'Bulk_Transfer', 'contact', 'Northwind.test')],
  settings_changes: [auditRow('s1', 'Settings_LoginPolicy_Update', 'tenant', 'Kestrel.test')],
  critical: [auditRow('c1', 'Role_Change', 'user', 'Wayne.test')],
};
const noActivity = { bulk_ops: [], settings_changes: [], critical: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (504)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state the base could not reach: the read answered, then the refresh was refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const bodyText = () => document.body.textContent ?? '';
/** The adoption figures the stale banner describes (the Stat grid labels them). */
const adoptionShown = () => screen.queryByText('Active tenants') !== null;
const feedsShown = () => screen.queryByText('Critical activity') !== null;
/** DOM order: a stale banner must precede the region it describes. */
const comesBefore = (a: HTMLElement, b: HTMLElement) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('adoption read — a refused refresh keeps the figures and names the loss (#2872)', () => {
  it('banners above the kept figures, with the interpolated reason', () => {
    registry.byUrl = { [ADOPTION]: staleRead(adoption), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(adoptionShown()).toBe(true);
    expect(alerts()).toContain('Could not refresh the adoption metrics, so the adoption bars, drift counts and user figures below are the last read: Request failed (504)');
    const banner = screen.getByRole('alert');
    expect(comesBefore(banner, screen.getByText('Active tenants').parentElement!.parentElement!)).toBe(true);
  });

  it('names the concrete losses, not a staleness hedge', () => {
    registry.byUrl = { [ADOPTION]: staleRead(adoption), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(alerts()).toMatch(/configured or cleared a settings tree since this was fetched sits on the wrong side of a bar/i);
    expect(alerts()).toMatch(/two-factor, password length, IP allowlist or self-signup/i);
    expect(alerts()).toMatch(/every percentage here is from before the refresh failed/i);
    expect(alerts()).not.toMatch(/may be out of date|may not be reflected|some data/i);
  });

  it('never describes a kept read as a load that never happened', () => {
    registry.byUrl = { [ADOPTION]: staleRead(adoption), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(alerts()).not.toMatch(/Failed to load adoption/i);
    expect(adoptionShown()).toBe(true);
  });

  it('retries only the adoption read', () => {
    const q = staleRead(adoption);
    const aq = ok(activity);
    registry.byUrl = { [ADOPTION]: q, [ACTIVITY]: aq };
    mount(<AdoptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(q.refetch).toHaveBeenCalledTimes(1);
    expect(aq.refetch).not.toHaveBeenCalled();
  });
});

describe('adoption read — a never-answered read gets the outage, and no numbers', () => {
  it('prints the outage sentence with the reason, and withholds every derived figure', () => {
    registry.byUrl = { [ADOPTION]: failedRead(), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(alerts()).toContain('Failed to load adoption metrics: Request failed (504). No tenant settings have been counted — the adoption bars, drift signals and user totals are unanswered, not zero, and this is not a platform where nothing is configured.');
    expect(adoptionShown()).toBe(false);
    expect(screen.queryByText('Settings tree adoption')).toBeNull();
    expect(screen.queryByText('Security drift signals')).toBeNull();
    // Rule #6: nothing dashed becomes a zero — no percentage claims, no counts.
    expect(bodyText()).not.toMatch(/\b\d+\/40\b/);
    expect(bodyText()).not.toContain('75%');
  });

  it('keeps the other read answering while this one is down', () => {
    registry.byUrl = { [ADOPTION]: failedRead(), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(feedsShown()).toBe(true);
    expect(screen.getByText('Role_Change')).toBeTruthy();
  });

  it('retries only the adoption read', () => {
    const q = failedRead();
    registry.byUrl = { [ADOPTION]: q, [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('states a reason even when the failure carried none', () => {
    registry.byUrl = { [ADOPTION]: failedRead(''), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(alerts()).toContain('no response from the server');
    expect(bodyText()).not.toMatch(/undefined|null/);
  });
});

describe('activity read — a refused refresh keeps the feeds and banners above them', () => {
  it('shows the kept rows under a banner naming the events the loss is made of', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: staleRead(activity) };
    mount(<AdoptionPage />);
    expect(feedsShown()).toBe(true);
    expect(screen.getByText('Settings_LoginPolicy_Update')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh recent activity, so the activity feeds below are the last read: Request failed (504). A bulk operation, settings change or security event since this was fetched — a login-policy change, a tenant suspend or restore, a role change — is not shown here');
    expect(comesBefore(screen.getByRole('alert'), screen.getByText('Critical activity'))).toBe(true);
  });

  it('does not describe kept feeds as never read, nor hide them', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: staleRead(activity) };
    mount(<AdoptionPage />);
    expect(alerts()).not.toMatch(/Failed to load recent activity/i);
    expect(screen.queryByText('No recent activity.')).toBeNull();
  });

  it('retries only the activity read', () => {
    const aq = staleRead(activity);
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: aq };
    mount(<AdoptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(aq.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[ADOPTION].refetch).not.toHaveBeenCalled();
  });
});

describe('activity read — a never-answered read must not print "No recent activity."', () => {
  it('replaces the fall-through absence sentence with the outage and the reason', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: failedRead() };
    mount(<AdoptionPage />);
    expect(alerts()).toContain('Failed to load recent activity: Request failed (504). No audit events were read — the feeds are unanswered, not empty, and this is not a platform that stayed quiet.');
    expect(screen.queryByText('No recent activity.')).toBeNull();
    expect(feedsShown()).toBe(false);
  });

  it('retries only the activity read', () => {
    const aq = failedRead();
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: aq };
    mount(<AdoptionPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(aq.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[ADOPTION].refetch).not.toHaveBeenCalled();
  });

  it('a refused refresh of an empty feed shows the emptiness it read, plus the caveat', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: staleRead(noActivity) };
    mount(<AdoptionPage />);
    expect(screen.getAllByText('No recent activity.').length).toBe(3);
    expect(alerts()).toMatch(/Could not refresh recent activity/i);
    expect(alerts()).toContain('Request failed (504)');
  });
});

describe('the two reads fail and go stale independently of each other', () => {
  it('one outage plus one stale: two banners, each over its own region', () => {
    registry.byUrl = { [ADOPTION]: failedRead(), [ACTIVITY]: staleRead(activity) };
    mount(<AdoptionPage />);
    const banners = screen.queryAllByRole('alert');
    expect(banners).toHaveLength(2);
    expect(banners[0]!.textContent).toMatch(/Failed to load adoption metrics/);
    expect(banners[1]!.textContent).toMatch(/Could not refresh recent activity/);
    expect(adoptionShown()).toBe(false);
    expect(feedsShown()).toBe(true);
  });

  it('one loading does not skeletonize the other', () => {
    registry.byUrl = {
      [ADOPTION]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [ACTIVITY]: ok(activity),
    };
    mount(<AdoptionPage />);
    expect(screen.getByText(/Loading adoption metrics/i)).toBeTruthy();
    expect(feedsShown()).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    registry.byUrl = {
      [ADOPTION]: ok(adoption),
      [ACTIVITY]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
    };
    mount(<AdoptionPage />);
    expect(screen.getByText(/Loading recent activity/i)).toBeTruthy();
    expect(adoptionShown()).toBe(true);
    expect(screen.getByText('Settings tree adoption')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('healthy reads raise nothing, a genuinely empty feed says so honestly', () => {
  it('both reads answer: figures, feeds, no banner', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: ok(activity) };
    mount(<AdoptionPage />);
    expect(adoptionShown()).toBe(true);
    expect(feedsShown()).toBe(true);
    expect(alerts()).toBe('');
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('the activity read answered "quiet platform": the empty sentence is allowed', () => {
    registry.byUrl = { [ADOPTION]: ok(adoption), [ACTIVITY]: ok(noActivity) };
    mount(<AdoptionPage />);
    expect(screen.getAllByText('No recent activity.').length).toBe(3);
    expect(alerts()).toBe('');
  });

  it('no refusal without a sentence: message-less failures never leak undefined', () => {
    registry.byUrl = { [ADOPTION]: staleRead(adoption, ''), [ACTIVITY]: failedRead('') };
    mount(<AdoptionPage />);
    expect(alerts()).toContain('no response from the server');
    expect(bodyText()).not.toMatch(/undefined/);
    expect(bodyText()).not.toMatch(/\bnull\b/);
  });

  it('the page-wide refresh button stays available as the way out', () => {
    registry.byUrl = { [ADOPTION]: failedRead(), [ACTIVITY]: failedRead() };
    mount(<AdoptionPage />);
    const refresh = screen.getByRole('button', { name: /refresh/i });
    expect(refetchDisabled(refresh)).toBe(false);
    fireEvent.click(refresh);
    expect(registry.byUrl[ADOPTION].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[ACTIVITY].refetch).toHaveBeenCalledTimes(1);
  });
});

const refetchDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

describe('the ratchet this slice closes (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/adoption/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');
  /** Whitespace-insensitive, so a reformatted old branch still trips it. */
  const tight = (s: string) => s.replace(/\s+/g, '');

  it('splits both reads into the three states and per-read loading', () => {
    const s = src();
    expect(s).toMatch(/const adoptionFailed = Boolean\(adoptionQuery\.error\) && !data;/);
    expect(s).toMatch(/const adoptionStale = Boolean\(adoptionQuery\.error\) && Boolean\(data\);/);
    expect(s).toMatch(/const activityFailed = Boolean\(activityQuery\.error\) && !activity;/);
    expect(s).toMatch(/const activityStale = Boolean\(activityQuery\.error\) && Boolean\(activity\);/);
    expect(s).toMatch(/adoptionQuery\.error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/activityQuery\.error\?\.message \|\| 'no response from the server'/);
    // Rule #4: the base's `isLoading || isLoading` screen-wide skeleton is gone.
    expect(tight(s), 'a page-wide skeleton is back').not.toContain('adoptionQuery.isLoading||activityQuery.isLoading');
    // Base's early `if (!data) return <outage>` replacement of the whole screen is gone.
    expect(tight(s), 'the early return is back').not.toContain('if(!data)return');
    expect(s, 'banners must be conditional, not returns').toMatch(/\{!adoptionLoading && adoptionStale && \(/);
    expect(s).toMatch(/\{!activityLoading && activityStale && \(/);
  });

  it('each banner retries only its own read; no document reload anywhere', () => {
    const s = src();
    expect(tight(s), 'the adoption banners refetch the activity read too').not.toContain('onRetry={()=>voidadoptionQuery.refetch();activityQuery.refetch()');
    expect(s).toMatch(/\{!adoptionLoading && adoptionFailed && \(\s*<InlineErrorState[\s\S]*?onRetry=\{\(\) => void adoptionQuery\.refetch\(\)\}/);
    expect(s).toMatch(/\{!activityLoading && activityFailed && \([\s\S]*?onRetry=\{\(\) => void activityQuery\.refetch\(\)\}/);
    expect(s).not.toMatch(/location\.reload|window\.location/);
  });

  it('keeps the outage arms guarding the fall-throughs that used to lie', () => {
    const s = src();
    // "No recent activity." renders only from an answered feed (gated on `activity`),
    // never from `activity?.critical ?? []` over a read that failed.
    expect(s).toMatch(/\{!activityLoading && activity && \(/);
    expect(tight(s), 'the feeds render without the answered-read gate again').not.toContain('{activity?.critical??[]}');
    // Rule #6: figures render only once the adoption read answered.
    expect(s).toMatch(/\{!adoptionLoading && data && \(/);
  });

  it('keeps server vocabulary and staleness hedges out of the printed copy (#2872 rules #2, #3)', () => {
    const s = src();
    const operatorCopy = s.split('\n').filter((line) => /message=\{?[`"]/.test(line)).join('\n');
    expect(operatorCopy).toMatch(/\$\{adoptionReason\}/);
    expect(operatorCopy).toMatch(/\$\{activityReason\}/);
    expect(operatorCopy, 'a source path reached the operator').not.toMatch(/app\/api|\.tsx?:\d|route\.ts/);
    expect(operatorCopy, 'server vocabulary reached the operator').not.toMatch(/\bendpoint\b|\broute\b|status code|\b404\b|\b500\b|\b504\b/);
    expect(operatorCopy, 'a banned staleness hedge is back').not.toMatch(/may be out of date|may not be reflected|some data/i);
  });

  it('is invisible to the sweep, before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`) as {
      inspect: (file: string, src: string) => { offends: boolean };
    };
    const s = src();
    expect(inspect(FILE, s).offends, `${FILE} is back on the guard's list`).toBe(false);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{!adoptionLoading && adoptionStale && \([\s\S]*?\n\s*\)\}\n/g, '\n'],
      [/\{!activityLoading && activityFailed && \([\s\S]*?\n\s*\)\}\n/g, '\n'],
      [/\{!activityLoading && activity && \(/, '{activity && ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      const rewound = s.replace(pattern, replacement);
      expect(rewound, `the shape this slice depends on moved: ${pattern}`).not.toBe(s);
      expect(inspect(FILE, rewound).offends).toBe(false);
    }
  });

  it('keeps the sweep green and the line ceiling', () => {
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const size = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(size.status, size.stdout + size.stderr).toBe(0);
  });
});
