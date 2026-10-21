// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/user-defaults/page.tsx` and `app/tenant/settings/admin/page.tsx`:
 * the two Organization-settings panels that had exactly one story to tell about their reads, and it
 * was the wrong one for whichever state they were not built for.
 *
 * `user-defaults` bound **neither** `error` nor `refetch`:
 *
 *     const { data: defaultsData, isLoading: defaultsLoading } = useApiQuery(['tenant','admin','user-defaults'], …);
 *     const { data: meData, … } = useApiQuery(['tenant','me'], …);
 *
 * so an unread read rendered the whole editor anyway. The editable copy seeds off the payload once
 * (`original === null`), so with nothing answered `defaults` stays `{}` and the page showed a wall of
 * "— Unset (use platform default) —" fields under "0 defaults currently set." — the tenant's real
 * workspace defaults reported as none, on the page whose header carries a destructive
 * "Clear all defaults". That button is `disabled` only while the local map is empty, so the first
 * field the operator touched re-armed it, and the DELETE behind it drops `settings->'user_defaults'`
 * wholesale: the write they reach from an unread page is the one that removes what they never saw.
 * (The PATCH cannot do that — the route merges `COALESCE(… ->'user_defaults','{}') || <safe>` key by
 * key and answers 400 for an empty map — so the outage hides the form instead of dashing a number,
 * and `stale` keeps both writes live.)
 *
 * `admin` bound both errors but branched on the bare flag, `if (orgError || membersError)`, and threw
 * the entire panel away for it. TanStack keeps `data` when a refresh of a read that already succeeded
 * is refused, so the routine state after the admin walks back from `/tenant/settings/team` past
 * `staleTime` — or after the browser reconnects, since `refetchOnReconnect` is on by default and
 * NOTHING invalidates `['tenant','workspace']` or `['tenant','members']` (the Team page writes with
 * plain fetch) — was a full set of real rows in scope and an outage card in their place: plan, seats,
 * usage and roster all reported as unloadable, with a retry that refetched both reads whichever one
 * refused.
 *
 * Per page: `failed = Boolean(error) && !data` is the outage (the card quotes the reason and its
 * "Try again" runs that read's own `refetch`), `stale = Boolean(error) && Boolean(data)` keeps what
 * is on screen under a "…are the last read…" caveat naming the colleague added or removed, the plan
 * change, or the stored default a refused refresh is hiding. Nothing is dashed on either page: an
 * unread read takes the whole panel out (the ruling #2829's settings slice made for these forms), and
 * a kept read must keep printing its real numbers — `12 / 1000` contacts and `2 / 5` seats are
 * answers, and "0 defaults currently set." under the stale caveat is the last read, not a lie.
 *
 * RED AT BASE — measured with both page files rewound via
 * `git checkout origin/main -- app/tenant/settings/user-defaults/page.tsx app/tenant/settings/admin/page.tsx`
 * and this file as committed: **17 failed / 8 passed (25)**. Twelve of the seventeen put a read in a
 * state one of the pages cannot tell today: five kept-rows-under-a-refusal cases (two on the defaults
 * panel, one of them the write walk over a last read, three on the organization panel), two messageless
 * refusals, three never-answered outages whose retry at base refetched both reads or refetched nothing,
 * and the empty-last-read pair. The other five are source ratchets — the two split bindings, the
 * toast-channel pin (the defaults read has no channel at all at base), the trigger pin, and the
 * guard-blindness case, whose rewind patterns match nothing until the stale caveats exist. The 8 that
 * pass at base are the controls this slice must not regress: each page's answered-empty sentence, each
 * page's healthy read saying nothing about freshness, the dash ban (neither page grew one), guard +
 * baseline, the line ceiling and the overlap-hygiene pin.
 *
 * Fixtures are documentation-only (RFC 2606 `.test` names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
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
// `user-defaults` still toasts — but only inside its mutation handlers. Mocking the module is how
// this suite proves a READ failure never reaches that channel: no assertion below can be satisfied by
// a toast, and the outage cases assert the load copy reached the panel's own subtree instead.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import UserDefaultsPage from '@/app/tenant/settings/user-defaults/page';
import AdminPage from '@/app/tenant/settings/admin/page';

const URLS = {
  userDefaults: '/api/tenant/admin/user-defaults',
  me: '/api/tenant/me',
  workspace: '/api/tenant/workspace',
  members: '/api/tenant/members',
} as const;

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** A refusal that carried no words at all — `error.message` is the empty string. */
const mute = (data?: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn(),
});

const STORED_DEFAULTS = { theme: 'dark', accent_color: 'emerald', default_page_size: 25 };
const MEMBERS = {
  data: [
    { id: 'm1', fullName: 'Ada Lovelace', email: 'ada@acme.test', roleSlug: 'admin' },
    { id: 'm2', fullName: 'Ravi Operater', email: 'ravi@acme.test', roleSlug: 'sales_rep' },
  ],
};
const ORG = {
  tenant: { name: 'Acme Studio', status: 'active', trial_ends_at: null },
  plan: { name: 'Growth', price_monthly: 49, price_yearly: 490, max_users: 5, max_contacts: 1000, max_deals: 500, max_automations: 20 },
  usage: { current_contacts: 12, current_deals: 3 },
};

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. The outage copy quotes the sentence it retires, so a
 * bare `queryByText(/defaults currently set/)` would find the banner's own words and report the false
 * claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

/** Climb from a card's own label to the card, so a figure can be read off the block it belongs to. */
function cardUnder(label: string, cardClass: string): string {
  const el = screen.getByText(label);
  const card = el.closest(`.${cardClass}`) as HTMLElement | null;
  return card?.textContent ?? '';
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

const udState = (defaults: QueryResult, me: QueryResult = ok({ is_admin: true })) =>
  ({ [URLS.userDefaults]: defaults, [URLS.me]: me });

describe('user-defaults: the panel that rendered an unread map as "everything unset" (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused refresh keeps the stored values and calls them the last read', () => {
    const read = staleRead({ user_defaults: STORED_DEFAULTS });
    const gate = ok({ is_admin: true });
    registry.byUrl = udState(read, gate);
    wrapped(<UserDefaultsPage />);
    // nothing invalidates this key — the refusal is the remount past staleTime, and the payload it
    // hands back is what the operator is looking at.
    expect(screen.getByDisplayValue('Dark')).toBeTruthy();
    expect(screen.getByDisplayValue('25')).toBeTruthy();
    expect(document.body.textContent).toContain('3 defaults currently set');
    expect(alerts()).toContain('the defaults below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).toContain('clearing now removes every stored default');
    expect(claimsOutsideAlerts(/Failed to load workspace user defaults/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(gate.refetch).not.toHaveBeenCalled();
  });

  it('a kept field is still editable and both writes stay reachable over a last read', async () => {
    const calls: [string, { method?: string }][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push([url, init ?? {}]);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    registry.byUrl = udState(staleRead({ user_defaults: STORED_DEFAULTS }));
    wrapped(<UserDefaultsPage />);
    // The operator's own edits are the payload, so a refusal does not get to veto the PATCH; and the
    // PATCH merges key by key server-side, so an unseen default cannot be erased by it.
    fireEvent.change(screen.getByDisplayValue('Dark'), { target: { value: 'light' } });
    fireEvent.click(screen.getByRole('button', { name: /save defaults/i }));
    await waitFor(() => expect(calls.some(([, i]) => i.method === 'PATCH')).toBe(true), { interval: 10 });
    expect(calls[0][0]).toContain(URLS.userDefaults);
    // The destructive whole-map write is the one an unread page cannot show; over a last read it stays
    // the operator's decision, which is why the caveat says out loud what pressing it costs.
    fireEvent.click(screen.getByRole('button', { name: /clear all defaults/i }));
    await waitFor(() => expect(calls.some(([, i]) => i.method === 'DELETE')).toBe(true), { interval: 10 });
    expect(alerts()).toContain('the defaults below are the last read');
  });

  it('a read that never answered is an outage, and the form that would lie about it is not rendered', () => {
    const read = failed('Request failed (500)');
    const gate = ok({ is_admin: true });
    registry.byUrl = udState(read, gate);
    wrapped(<UserDefaultsPage />);
    expect(alerts()).toContain('Failed to load workspace user defaults: Request failed (500)');
    expect(alerts()).not.toContain('last read');
    expect(claimsOutsideAlerts(/defaults currently set/)).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // Clear-all is the data-loss path: it arms off the local map, so an unread page must not show it
    // at all rather than wait for the operator to touch a field and re-arm it.
    expect(screen.queryByRole('button', { name: /clear all defaults/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save defaults/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(gate.refetch).not.toHaveBeenCalled();
  });

  it('says the workspace has none when the read answered "there are none", with no alert', () => {
    registry.byUrl = udState(ok({ user_defaults: {} }));
    wrapped(<UserDefaultsPage />);
    expect(document.body.textContent).toContain('0 defaults currently set');
    expect(alerts()).toBe('');
    expect(screen.getByRole('button', { name: /clear all defaults/i }).hasAttribute('disabled')).toBe(true);
  });

  it('the clear that was refused: an empty last read still says none, and says that is all it saw', () => {
    // The routine state here: the map read empty, someone else set a default since, the remount's
    // refresh refused, and TanStack returned the empty payload. The tally is now labelled a last read
    // instead of being a permanent all-clear.
    registry.byUrl = udState(staleRead({ user_defaults: {} }));
    wrapped(<UserDefaultsPage />);
    expect(document.body.textContent).toContain('0 defaults currently set');
    expect(alerts()).toContain('the defaults below are the last read');
    expect(claimsOutsideAlerts(/Failed to load workspace user defaults/)).toEqual([]);
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = udState(mute());
    wrapped(<UserDefaultsPage />);
    expect(alerts()).toContain('Failed to load workspace user defaults: no response from the server');
    expect(alerts()).not.toContain('undefined');

    cleanup();
    registry.byUrl = udState(mute({ user_defaults: STORED_DEFAULTS }));
    wrapped(<UserDefaultsPage />);
    expect(alerts()).toContain('the defaults below are the last read: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = udState(ok({ user_defaults: STORED_DEFAULTS }));
    wrapped(<UserDefaultsPage />);
    expect(screen.getByDisplayValue('Dark')).toBeTruthy();
    expect(document.body.textContent).toContain('3 defaults currently set');
    expect(alerts()).toBe('');
  });
});

describe('admin: the panel that hid its kept rows behind an outage card (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused workspace refresh keeps the cards and calls them the last read', () => {
    const read = staleRead(ORG);
    const roster = ok(MEMBERS);
    registry.byUrl = { [URLS.workspace]: read, [URLS.members]: roster };
    wrapped(<AdminPage />);
    expect(screen.getByText('Acme Studio')).toBeTruthy();
    expect(screen.getByText('Growth')).toBeTruthy();
    // real numbers from a read that answered — they must not be dashed for its sibling's refusal.
    expect(cardUnder('Contacts', 'p-4')).toContain('12');
    expect(cardUnder('Contacts', 'p-4')).not.toContain('—');
    expect(screen.getByText('ada@acme.test')).toBeTruthy();
    expect(alerts()).toContain('the organization, plan and usage below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load your organization/)).toEqual([]);
    expect(alerts()).not.toMatch(/team members|roster and the seats/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(roster.refetch).not.toHaveBeenCalled();
  });

  it('a refused roster refresh keeps the colleagues and names what the refusal hides', () => {
    const org = ok(ORG);
    const read = staleRead(MEMBERS);
    registry.byUrl = { [URLS.workspace]: org, [URLS.members]: read };
    wrapped(<AdminPage />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ravi@acme.test')).toBeTruthy();
    expect(cardUnder('Team', 'p-5')).toContain('2');
    expect(cardUnder('Team', 'p-5')).toContain('/ 5');
    expect(alerts()).toContain('the roster and the seats used below are the last read');
    expect(alerts()).toContain('A colleague invited or removed since then is not reflected here');
    expect(claimsOutsideAlerts(/Failed to load your team members/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(org.refetch).not.toHaveBeenCalled();
  });

  it('both refreshes refused: two caveats, each retrying only its own read', () => {
    const org = staleRead(ORG);
    const roster = staleRead(MEMBERS);
    registry.byUrl = { [URLS.workspace]: org, [URLS.members]: roster };
    wrapped(<AdminPage />);
    const [first, second] = screen.getAllByRole('alert');
    expect(first.textContent).toContain('the organization, plan and usage below are the last read');
    expect(second.textContent).toContain('the roster and the seats used below are the last read');
    fireEvent.click(within(first).getByRole('button', { name: /try again/i }));
    expect(org.refetch).toHaveBeenCalledTimes(1);
    expect(roster.refetch).not.toHaveBeenCalled();
    fireEvent.click(within(second).getByRole('button', { name: /try again/i }));
    expect(roster.refetch).toHaveBeenCalledTimes(1);
    expect(org.refetch).toHaveBeenCalledTimes(1);
  });

  it('a workspace that never answered is an outage, and the plan is not called Free', () => {
    const read = failed('Request failed (500)');
    const roster = ok(MEMBERS);
    registry.byUrl = { [URLS.workspace]: read, [URLS.members]: roster };
    wrapped(<AdminPage />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toContain('Failed to load your organization: Request failed (500)');
    expect(alerts()).not.toContain('last read');
    expect(claimsOutsideAlerts(/Acme Studio/)).toEqual([]);
    expect(claimsOutsideAlerts(/^Free$/)).toEqual([]);
    expect(claimsOutsideAlerts(/No team members yet/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    // at base this card refetched BOTH reads, whatever had refused.
    expect(roster.refetch).not.toHaveBeenCalled();
  });

  it('a roster that never answered is its own outage, not the organization card denying a colleague', () => {
    const org = ok(ORG);
    const read = failed('Request failed (503)');
    registry.byUrl = { [URLS.workspace]: org, [URLS.members]: read };
    wrapped(<AdminPage />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toContain('Failed to load your team members: Request failed (503)');
    expect(claimsOutsideAlerts(/No team members yet/)).toEqual([]);
    expect(claimsOutsideAlerts(/Ada Lovelace/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(org.refetch).not.toHaveBeenCalled();
  });

  it('says the tenant has no members when the roster answered "there are none", with no alert', () => {
    registry.byUrl = { [URLS.workspace]: ok(ORG), [URLS.members]: ok({ data: [] }) };
    wrapped(<AdminPage />);
    expect(screen.getByText('No team members yet')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.getByRole('link', { name: /see all/i })).toBeTruthy();
  });

  it('the invite that was refused: an empty last roster still says none, and says that is all it saw', () => {
    registry.byUrl = { [URLS.workspace]: ok(ORG), [URLS.members]: staleRead({ data: [] }) };
    wrapped(<AdminPage />);
    expect(screen.getByText('No team members yet')).toBeTruthy();
    expect(alerts()).toContain('the roster and the seats used below are the last read');
    expect(claimsOutsideAlerts(/Failed to load your team members/)).toEqual([]);
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [URLS.workspace]: ok(ORG), [URLS.members]: mute(MEMBERS) };
    wrapped(<AdminPage />);
    expect(alerts()).toContain('the roster and the seats used below are the last read: no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('says nothing about freshness when both reads answer', () => {
    registry.byUrl = { [URLS.workspace]: ok(ORG), [URLS.members]: ok(MEMBERS) };
    wrapped(<AdminPage />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(cardUnder('Deals', 'p-4')).toContain('3');
    expect(alerts()).toBe('');
  });
});

describe('the ratchet these two pages are measured by (#2872)', () => {
  const ROOT = process.cwd();
  const UD = 'app/tenant/settings/user-defaults/page.tsx';
  const ADMIN = 'app/tenant/settings/admin/page.tsx';
  const srcOf = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits both reads of user-defaults apart instead of ignoring one error', () => {
    const ud = srcOf(UD);
    expect(ud, 'the defaults read still refuses to look at its own error')
      .toMatch(/data: defaultsData, isLoading: defaultsLoading, error: defaultsError, refetch: refetchDefaults,/);
    expect(ud).toMatch(/const failed = Boolean\(defaultsError\) && !defaultsData;/);
    expect(ud).toMatch(/const stale = Boolean\(defaultsError\) && Boolean\(defaultsData\);/);
    expect(ud).toMatch(/defaultsError\?\.message \|\| 'no response from the server'/);
    expect(ud, 'an unread map still renders its fields and its tally').toMatch(/if \(failed\) \{/);
    expect(ud, 'a kept read still grows no saying-it-is-current banner').toMatch(/\{stale && \(/);
    expect(ud, 'a branch off the bare flag came back').not.toMatch(/if \(defaultsError\) \{/);
    // The gate read is deliberately not split — it only answers is_admin, both writes re-check admin
    // with a 403, and #2932 ruled the same way for the picklists gate. Pin that it stays that way
    // rather than half-read: the page must not start routing `meError` into a panel state.
    expect(ud, 'the is_admin gate grew a state the page cannot show').not.toMatch(/meError/);
    expect(ud).toMatch(/const isAdmin = meData\?\.is_admin \?\? true;/);
  });

  it('splits admin per read instead of branching on the flag', () => {
    const admin = srcOf(ADMIN);
    for (const [n, err, d] of [['org', 'orgError', 'orgData'], ['members', 'membersError', 'membersData']] as const) {
      expect(admin).toMatch(new RegExp(`const ${n}Failed = Boolean\\(${err}\\) && !${d};`));
      expect(admin).toMatch(new RegExp(`const ${n}Stale = Boolean\\(${err}\\) && Boolean\\(${d}\\);`));
      expect(admin).toMatch(new RegExp(`const ${n}Reason = ${err}\\?\\.message \\|\\| 'no response from the server';`));
    }
    expect(admin, 'the bare-flag branch that threw the whole panel away came back')
      .not.toMatch(/if \(orgError \|\| membersError\)/);
    expect(admin, 'an unread read must still take the panel out').toMatch(/if \(orgFailed \|\| membersFailed\) \{/);
    expect(admin, 'one outage card still refetches both reads')
      .not.toMatch(/refetchOrg\(\); refetchMembers\(\);/);
    expect(admin).toMatch(/\{orgStale && \(/);
    expect(admin).toMatch(/\{membersStale && \(/);
  });

  it('keeps the read failure out of the fading channel and the write feedback in it', () => {
    const ud = srcOf(UD);
    expect(ud, 'the read failure started toasting from the render body').not.toMatch(/^\s*if \(defaultsError\) toast\.error/m);
    expect(ud, 'the read failure moved into an effect instead').not.toMatch(/useEffect\(\(\) => \{ if \(defaultsError\) toast\.error/);
    expect(ud, 'the read has no durable channel at all').toMatch(/<InlineErrorState/);
    expect(ud, 'an action still owes the operator transient feedback').toMatch(/onError: \(e: Error\) => toast\.error\(e\.message \|\| 'Failed'\)/);
    expect(ud).toMatch(/onError: \(\) => toast\.error\('Failed'\)/);
    expect(srcOf(ADMIN), 'the organization panel started carrying state on a toast').not.toMatch(/react-hot-toast/);
  });

  it('names the trigger the splits\' WHY comments claim', () => {
    // Neither page invalidates anything: the refused refresh is the remount past staleTime (and the
    // browser reconnecting), which is what makes "kept rows + error" the ordinary state rather than an
    // edge case. If someone wires up invalidateQueries, the stale copy has to be re-justified.
    for (const f of [UD, ADMIN]) {
      const src = srcOf(f);
      expect(src, `${f} grew an invalidation; re-read the trigger comment`).not.toMatch(/invalidateQueries|useQueryClient/);
      expect(src, `${f} no longer names staleTime as the trigger`).toMatch(/staleTime/);
      expect(src, `${f} no longer names refetchOnReconnect`).toMatch(/refetchOnReconnect/);
      expect(src, `${f} stopped claiming nothing invalidates its key`).toMatch(/nvalidates/i);
    }
    // user-defaults merges per key, so the PATCH is not the loss path — the whole-map DELETE is.
    expect(srcOf(UD)).toMatch(/Clear-all|clearing now removes every stored default/);
  });

  it('dashes nothing, because both pages take the unread panel out instead', () => {
    for (const f of [UD, ADMIN]) {
      const src = srcOf(f);
      expect(src, `${f} grew a dash off the split`).not.toMatch(/(?:failed|Failed|stale|Stale) \? '—'/);
      expect(src, `${f} dashes a figure off the bare flag`).not.toMatch(/Error \? '—'/);
    }
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: Record<string, [RegExp, string][]> = {
      [UD]: [
        [/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/, '\n'],
        [/if \(failed\) \{/, 'if (defaultsError) {'],
        [/const failed = Boolean\(defaultsError\) && !defaultsData;\n\s*const stale = Boolean\(defaultsError\) && Boolean\(defaultsData\);\n/, ''],
      ],
      [ADMIN]: [
        [/\n\s*\{orgStale && \([\s\S]*?\)\s*\}\n/, '\n'],
        [/\n\s*\{membersStale && \([\s\S]*?\)\s*\}\n\n/, '\n\n'],
        [/if \(orgFailed \|\| membersFailed\) \{/, 'if (orgError || membersError) {'],
        [/onRetry=\{refetchOrg\}/, 'onRetry={() => { refetchOrg(); refetchMembers(); }}'],
      ],
    };
    for (const [file, patterns] of Object.entries(rewinds)) {
      const src = srcOf(file);
      expect(inspect(file, src).offends, `${file} was already on the guard's list`).toBe(false);
      for (const [pattern, replacement] of patterns) {
        expect(src, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
        expect(
          inspect(file, src.replace(pattern, replacement)).offends,
          `${file} would be visible to the guard once the split is taken back out: ${replacement}`,
        ).toBe(false);
      }
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866 each had to undo.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of [UD, ADMIN]) expect(files, `${f} should never have been baselined`).not.toContain(f);
  });

  it('stays inside the line ceiling both pages are allowed', () => {
    for (const f of [UD, ADMIN]) {
      const lines = srcOf(f).split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves these two pages to one #2872 suite, and no other suite to a last read', () => {
    const mine = 'panel-page-error-not-empty-userdefaults-admin-stale-2872.test.tsx';
    const speakers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx') && f !== mine && /2872/.test(f))
      .filter((f) => /settings\/(user-defaults|admin)\/page/.test(srcOf(join('tests/unit', f))))
      .sort();
    expect(speakers, `${mine} is not the only #2872 suite on these pages`).toEqual([]);
    // #2829 and #2735 mount the organization panel to pin the never-answered half and the row shape;
    // neither may start speaking about a kept read, or this slice would be double-claiming their copy.
    for (const f of ['tests/unit/panel-page-error-not-empty-tenant-settings-2829.test.tsx',
      'tests/unit/admin-settings-member-shape-2735.test.tsx',
      'tests/unit/members-permission-map-2726.test.ts']) {
      expect(srcOf(f), `${f} now speaks about a last read`).not.toMatch(/last read|refused refresh|Could not refresh/);
    }
  });
});
