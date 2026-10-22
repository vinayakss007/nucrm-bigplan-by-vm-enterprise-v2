// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/general/page.tsx` and `app/tenant/settings/localization/page.tsx`.
 *
 * Neither page was a toast-only panel, which is the shape the epic describes, so the two
 * failures here are the two neighbours of it:
 *
 *   - `general` read `['tenant','workspace']` → `/api/tenant/workspace` and destructured
 *     **`{ data }` and nothing else**. The read had no channel at all. A workspace it had
 *     never seen rendered as the form's own initial values — an empty name, `#7c3aed`,
 *     "UTC", "USD", auto-invoice off — with a live Save button, and PATCH
 *     (`app/api/tenant/workspace/route.ts:145-167`) writes every field the body carries
 *     (`name`, `primary_color`, `industry`, `subdomain`, `custom_domain`, and `settings`
 *     merged shallow over the stored jsonb) while the concurrency guard at `:175` only
 *     engages on an `expectedUpdatedAt` this payload never sends. So the unanswered read
 *     was one Save away from overwriting the workspace with blanks.
 *   - `localization` had the opposite problem: #2829 already put `InlineErrorState` at
 *     `if (locError)`, which is a branch off the bare flag. A refused refresh of the read
 *     that had already answered therefore threw the whole form away — timezone, weekend,
 *     business hours, the holiday list and the Save bar — and announced "Failed to load"
 *     about settings the page was still holding in `locData`. Its second read,
 *     `['tenant','me']` → `/api/tenant/me`, was bound without `error` at all, so
 *     `meData?.is_admin ?? true` fail-opened: an unread permission check handed the Save
 *     bar to a reader `PATCH` would have refused (`route.ts:86` answers 403).
 *
 * The refused refresh is reachable on both pages the same way, and it is NOT the operator's
 * own write: nothing in the app invalidates `['tenant','workspace']`,
 * `['tenant','admin','localization']` or `['tenant','me']` — `general`'s save only sets
 * `tenantOverride`, `localization`'s only re-seeds `original` — so the state arrives from a
 * remount past `staleTime: 30_000` with the payload still in the cache (`gcTime` 5 min), from
 * `refetchOnReconnect` (not disabled in `lib/query/client.tsx:47-58`) after the network
 * flaked, or from the banner's own "Try again" failing a second time. The write-walk cases
 * below therefore test the gate over a kept read, not a save that provokes its own refusal.
 *
 * Nothing is dashed that the page never derived: `general` prints no number, and
 * `localization`'s only tally, `Holidays (${loc.holidays.length})`, is inside the form the
 * outage already refuses to render, so the caveat is where it gets qualified — a stale empty
 * answer still says "No holidays yet", and says that is all it saw.
 *
 * RED AT BASE — measured on `df2701bc` (this branch's tip; `origin/main` `a4da39c4` carries both
 * page files byte-for-byte identically) with the two pages rewound
 * (`git checkout origin/main -- app/tenant/settings/general/page.tsx
 * app/tenant/settings/localization/page.tsx`) and this file as committed:
 * **19 failed / 9 passed (28)**. Thirteen of the nineteen put a read in a state the class is about:
 * `general`'s never-answered outage (which at base said nothing at all, kept the "Custom domains
 * require the Enterprise plan" claim standing and left Save clickable), the outage's write gate,
 * its refused refresh over a kept workspace, its write walk starting from that kept read, and its
 * messageless refusal; `localization`'s refused refresh over a kept timezone/holiday list (at base
 * #2829's branch replaced the form, so no field carried a value), the same over an EMPTY last read,
 * the caveat's own retry (which at base passed on the outage banner bound to the same refetch, hence
 * the copy assertion), a kept holiday row's remove control, its write walk over the kept map, both
 * `me` states, and its messageless refusal.
 * The other six are source ratchets — the split bindings for both pages, the two write gates, the
 * WHY-comment trigger pins, and the guard-blindness case whose rewind patterns match nothing until
 * the banners exist. The 9 that pass at base are the controls this slice must not regress:
 * `general`'s healthy read and its answered "no subdomain yet" read, `localization`'s never-answered
 * case (which is #2829's, kept whole), its answered `is_admin: false` decision and its
 * both-reads-healthy render, plus the toast-channel pin and the guard+baseline, line-ceiling and
 * overlap-hygiene pins.
 *
 * Fixtures are documentation-only: a tenant named "Acme Studio", nil-shaped ids, and no domain,
 * host or credential value anywhere in this file (the pages' own `.nucrm.io` copy is asserted
 * through its shape, never by writing the host back out).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
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
// Both pages still toast — but only inside their mutation handlers. Mocking the module is how
// this suite proves a READ failure never reaches that channel: no assertion below can be
// satisfied by a fading toast, and every outage/stale claim is read out of `role="alert"`.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// `general` renders the workspace logo through next/image, which needs the Next runtime. This
// stands in for it without an <img> (no case here reads a pixel; the alt text is enough to see
// which placeholder the page chose).
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => <span>{alt ?? ''}</span>,
}));

import GeneralPage from '@/app/tenant/settings/general/page';
import LocalizationPage from '@/app/tenant/settings/localization/page';

const WORKSPACE = '/api/tenant/workspace';
const LOC = '/api/tenant/admin/localization';
const ME = '/api/tenant/me';

/** Exactly what GET /api/tenant/workspace returns (`route.ts:25-50`: the drizzle row's own
 *  camelCase keys, joined plan columns and the `settings` jsonb). */
const WORKSPACE_ROWS = {
  data: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Studio',
    slug: 'acme-studio',
    planId: 'growth',
    status: 'active',
    logoUrl: null,
    primaryColor: '#0f766e',
    industry: 'Technology',
    subdomain: 'acme-studio',
    customDomain: null,
    settings: { timezone: 'Europe/Paris', currency: 'EUR', autoInvoiceOnWon: true },
    plan_name: 'Growth',
  },
};
/** A workspace the tenant really has: named, but with no subdomain claimed yet. */
const WORKSPACE_NO_SUBDOMAIN = { data: { ...WORKSPACE_ROWS.data, subdomain: '' } };

/** Exactly what GET /api/tenant/admin/localization stores — no value here is a DEFAULTS value. */
const STORED_LOC = {
  localization: {
    timezone: 'Europe/Paris', currency: 'EUR', fiscal_year_start_month: 4, week_start: 'monday',
    weekend_days: ['sunday'],
    business_hours: { enabled: false, start_time: '08:00', end_time: '16:00', working_days: ['monday'] },
    holidays: [{ date: '2026-07-14', name: 'Bastille Day' }],
    number_format: '1 234,56',
  },
};
const STORED_LOC_NO_HOLIDAYS = {
  localization: { ...STORED_LOC.localization, holidays: [] },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
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
 * Matches of `re` that are NOT inside an alert. The retired outage copy is quoted inside the
 * stale caveat's neighbourhood, so a bare `queryByText` would report a retired claim as still
 * standing — or the banner's own words as a claim about the tenant.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
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

/** Records what each write actually carries, so "the payload is the last read plus the edit"
 *  is measured rather than assumed. */
let writes: { url: string; method: string; body: Record<string, unknown> }[];
function stubWrites(payload: unknown = { data: {} }) {
  writes = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    writes.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch);
}

const byName = (name: RegExp) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  registry.byUrl = {};
  stubWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('general: the workspace form that bound neither error nor refetch (#2872)', () => {
  it('a read that never answered is an outage, and the subscription sentence goes quiet', () => {
    const read = failed('Request failed (500)');
    registry.byUrl = { [WORKSPACE]: read };
    wrapped(<GeneralPage />);
    expect(alerts()).toContain('Failed to load your workspace settings: Request failed (500)');
    expect(alerts()).toContain('Save is closed');
    expect(alerts()).not.toContain('last read');
    // `plan_id` comes off the same read, so at base an unread workspace was reported to the
    // operator as a tenant who is not on Enterprise.
    expect(claimsOutsideAlerts(/Custom domains require the Enterprise plan/)).toEqual([]);
    fireEvent.click(byName(/try again/i));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it("the outage closes the write that would have pushed this form's blanks (#2872)", () => {
    registry.byUrl = { [WORKSPACE]: failed() };
    wrapped(<GeneralPage />);
    const save = byName(/save settings/i);
    expect(save.disabled, 'Save Settings is clickable over a workspace the read never seeded').toBe(true);
    fireEvent.click(save);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // The fields are still the form's own initial values, and the banner says so.
    expect(screen.queryByDisplayValue('Acme Studio')).toBeNull();
    expect(screen.getByDisplayValue('UTC')).toBeTruthy();
  });

  it('a refused refresh keeps the workspace in the form and calls it the last read', () => {
    const read = staleRead(WORKSPACE_ROWS);
    registry.byUrl = { [WORKSPACE]: read };
    wrapped(<GeneralPage />);
    expect(screen.getByDisplayValue('Acme Studio')).toBeTruthy();
    expect(screen.getByDisplayValue('acme-studio')).toBeTruthy();
    expect(screen.getByDisplayValue('Europe/Paris')).toBeTruthy();
    expect(screen.getByDisplayValue('EUR')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /auto-create draft invoice/i })
      .getAttribute('aria-checked')).toBe('true');
    expect(alerts()).toContain('this form holds the last read: Request failed (504)');
    expect(alerts()).toContain('a renamed workspace, an edited subdomain');
    expect(claimsOutsideAlerts(/Failed to load your workspace settings/)).toEqual([]);
    // A kept read is not an outage: the write stays available, because the payload is the
    // last read plus the operator's own edits.
    expect(byName(/save settings/i).disabled).toBe(false);
    fireEvent.click(byName(/try again/i));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the write walk over a last read sends the last read plus the edit', async () => {
    registry.byUrl = { [WORKSPACE]: staleRead(WORKSPACE_ROWS) };
    wrapped(<GeneralPage />);
    // The walk starts from the state the split is about — a kept read under a refusal — so a
    // page that lost the caveat (or the form) here is not testing the save it claims to.
    expect(alerts()).toContain('this form holds the last read');
    fireEvent.change(screen.getByDisplayValue('EUR'), { target: { value: 'GBP' } });
    fireEvent.click(byName(/save settings/i));
    await waitFor(() => expect(writes.length).toBe(1), { interval: 10 });
    const [patch] = writes;
    expect(patch.url).toBe(WORKSPACE);
    expect(patch.method).toBe('PATCH');
    // Measured, not assumed: the body carries the whole form — the values the read returned
    // and nothing the page invented about a workspace it did not see.
    expect(patch.body).toMatchObject({
      name: 'Acme Studio',
      subdomain: 'acme-studio',
      industry: 'Technology',
      settings: { timezone: 'Europe/Paris', currency: 'GBP', autoInvoiceOnWon: true },
    });
    // …and it carries no `expectedUpdatedAt`, which is why the gate has to live in the page.
    expect(patch.body).not.toHaveProperty('expectedUpdatedAt');
    expect(registry.byUrl[WORKSPACE].refetch, "this page's save does not re-read the workspace").not.toHaveBeenCalled();
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [WORKSPACE]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() } };
    wrapped(<GeneralPage />);
    expect(alerts()).toContain('Failed to load your workspace settings: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the workspace answers', () => {
    registry.byUrl = { [WORKSPACE]: ok(WORKSPACE_ROWS) };
    wrapped(<GeneralPage />);
    expect(screen.getByDisplayValue('Acme Studio')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a workspace that answered "no subdomain yet" is an answer, not an outage', () => {
    // The CRM-URL preview is the only absence this page states, and it is gated on the form
    // value the read seeded — so it must stay silent AND alert-free, never become a banner.
    registry.byUrl = { [WORKSPACE]: ok(WORKSPACE_NO_SUBDOMAIN) };
    wrapped(<GeneralPage />);
    expect(alerts()).toBe('');
    expect(screen.queryByText(/^https:\/\//)).toBeNull();
    expect(byName(/save settings/i).disabled).toBe(false);
  });
});

describe("localization: #2829's banner was a branch off the bare flag (#2872)", () => {
  it('a refused refresh keeps the timezone, weekend and holiday and calls them the last read', () => {
    const read = staleRead(STORED_LOC);
    registry.byUrl = { [LOC]: read, [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    expect(screen.getByDisplayValue('Europe/Paris')).toBeTruthy();
    expect(screen.getByDisplayValue('EUR')).toBeTruthy();
    expect(screen.getByText('Bastille Day')).toBeTruthy();
    expect(screen.getByText(/Holidays \(1\)/)).toBeTruthy();
    expect(alerts()).toContain('every value on this page and the holiday count below are the last read: Request failed (504)');
    expect(alerts()).toContain('a holiday, weekend or timezone another admin set since is gone');
    expect(claimsOutsideAlerts(/Failed to load your localization settings/)).toEqual([]);
    expect(claimsOutsideAlerts(/No holidays yet/)).toEqual([]);
    fireEvent.click(byName(/try again/i));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the caveat re-reads localization and not its sibling permission check', () => {
    const locRead = staleRead(STORED_LOC);
    const meRead = ok({ is_admin: true });
    registry.byUrl = { [LOC]: locRead, [ME]: meRead };
    wrapped(<LocalizationPage />);
    // Without this the case would pass on #2829's outage banner, which happens to be bound to
    // the same refetch — the retry being proved is the caveat's.
    expect(alerts()).toContain('every value on this page and the holiday count below are the last read');
    fireEvent.click(byName(/try again/i));
    expect(locRead.refetch).toHaveBeenCalledTimes(1);
    expect(meRead.refetch).not.toHaveBeenCalled();
  });

  it('a kept holiday can still be removed while the read is a last read', () => {
    registry.byUrl = { [LOC]: staleRead(STORED_LOC), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    const row = screen.getByText('Bastille Day').parentElement?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    expect(screen.queryByText('Bastille Day')).toBeNull();
    // The list the operator just edited is dirty, so Save stays offered over the last read —
    // refusing it here would punish the one action the page is for.
    expect(byName(/save localization/i).disabled).toBe(false);
    expect(alerts()).toContain('the last read');
  });

  it('the write walk over a last read sends the whole map, with no proof of what it replaced', async () => {
    registry.byUrl = { [LOC]: staleRead(STORED_LOC), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    fireEvent.click(screen.getByRole('button', { name: /^mon$/i }));
    fireEvent.click(byName(/save localization/i));
    await waitFor(() => expect(writes.length).toBe(1), { interval: 10 });
    const [patch] = writes;
    expect(patch.url).toBe(LOC);
    expect(patch.method).toBe('PATCH');
    // The payload is the last read plus the operator's edit, and it carries every key — which is
    // why the caveat, not a disabled button, is what has to tell the operator what a save costs.
    expect(patch.body).toEqual({
      localization: { ...STORED_LOC.localization, weekend_days: ['sunday', 'monday'] },
    });
    expect(patch.body).not.toHaveProperty('expectedUpdatedAt');
    expect((patch.body as { localization?: Record<string, unknown> }).localization).not.toHaveProperty('expectedUpdatedAt');
    expect(alerts()).toContain('the last read');
  });

  it('an unread permission check closes Save and keeps the localization on screen', () => {
    const meRead = failed('Request failed (503)');
    registry.byUrl = { [LOC]: ok(STORED_LOC), [ME]: meRead };
    wrapped(<LocalizationPage />);
    expect(alerts()).toContain('Failed to check whether you may edit these settings: Request failed (503)');
    expect(alerts()).toContain('Save is closed');
    // Nothing about the localization itself is unknown, so it is shown and not dashed.
    expect(screen.getByDisplayValue('Europe/Paris')).toBeTruthy();
    expect(screen.getByText('Bastille Day')).toBeTruthy();
    expect(claimsOutsideAlerts(/Failed to load your localization settings/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^mon$/i }));
    expect(byName(/save localization/i).disabled, 'Save was open over an unread permission check').toBe(true);
    fireEvent.click(byName(/save localization/i));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.click(byName(/try again/i));
    expect(meRead.refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[LOC].refetch).not.toHaveBeenCalled();
  });

  it('a refused permission refresh keeps the last answer and says which answer it is', () => {
    registry.byUrl = { [LOC]: ok(STORED_LOC), [ME]: staleRead({ is_admin: true }, 'Request failed (504)') };
    wrapped(<LocalizationPage />);
    expect(alerts()).toContain('the permission this form is acting on is the last read: Request failed (504)');
    expect(alerts()).not.toContain('Failed to check whether you may edit these settings');
    expect(claimsOutsideAlerts(/Admins only/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^mon$/i }));
    expect(byName(/save localization/i).disabled).toBe(false);
  });

  it('a read that never answered shows no form at all (#2829, kept)', () => {
    registry.byUrl = { [LOC]: failed(), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    expect(alerts()).toContain('Failed to load your localization settings: Request failed (500)');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByText('Bastille Day')).toBeNull();
    expect(claimsOutsideAlerts(/No holidays yet/)).toEqual([]);
    expect(screen.queryByText(/Save localization/i)).toBeNull();
  });

  it('a refused refresh over an empty last read still says there are no holidays — and says that is all it saw', () => {
    // The state #2829's bare flag could not separate from the case above: the read answered
    // "none", the refresh was refused, and the absence sentence is honest about the answer it
    // is reporting while being silent about whatever arrived since.
    registry.byUrl = { [LOC]: staleRead(STORED_LOC_NO_HOLIDAYS), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    expect(claimsOutsideAlerts(/No holidays yet/)).toHaveLength(1);
    expect(alerts()).toContain('the last read');
    expect(screen.getByText(/Holidays \(0\)/)).toBeTruthy();
    expect(claimsOutsideAlerts(/Failed to load your localization settings/)).toEqual([]);
  });

  it('a refusal with no message prints a reason, not undefined', () => {
    registry.byUrl = { [LOC]: staleRead(STORED_LOC, ''), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    expect(alerts()).toContain('are the last read: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a permission the read answered is a decision, not an outage', () => {
    registry.byUrl = { [LOC]: ok(STORED_LOC), [ME]: ok({ is_admin: false }) };
    wrapped(<LocalizationPage />);
    expect(claimsOutsideAlerts(/Admins only/)).toHaveLength(1);
    expect(alerts()).toBe('');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('says nothing about freshness when both reads answer', () => {
    registry.byUrl = { [LOC]: ok(STORED_LOC), [ME]: ok({ is_admin: true }) };
    wrapped(<LocalizationPage />);
    expect(screen.getByDisplayValue('Europe/Paris')).toBeTruthy();
    expect(screen.getByText('Bastille Day')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const GEN = 'app/tenant/settings/general/page.tsx';
  const LOCFILE = 'app/tenant/settings/localization/page.tsx';
  const srcOf = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the workspace read apart instead of ignoring its error', () => {
    const gen = srcOf(GEN);
    expect(gen, 'the read still refuses to look at its own error')
      .toMatch(/const \{ data, error, refetch \} = useApiQuery/);
    expect(gen).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(gen).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(gen).toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
    expect(gen, 'the outage and the caveat are not arms of this read').toMatch(/\{failed && \(/);
    expect(gen).toMatch(/\{stale && \(/);
    expect(gen, 'a kept read still routes the failure through the bare flag')
      .not.toMatch(/\{\s*error\s*&&\s*\(/);
    expect(gen, 'the bare flag decides a branch of its own').not.toMatch(/if \(error\) return/);
  });

  it('gates the write that replaces the workspace, and only on the outage', () => {
    const gen = srcOf(GEN);
    expect(gen, 'Save Settings can be pressed over a workspace the read never seeded')
      .toMatch(/disabled=\{saving \|\| failed\}/);
    expect(gen, 'the submit handler no longer refuses an unread read').toMatch(/if \(failed\) return;/);
    expect(gen, 'the write gate drifted onto the kept read — a last read must stay saveable')
      .not.toMatch(/disabled=\{[^}]*\|\| stale\}/);
    // The gate being pinned is `!failed` — that the plan sentence is asserted only about a
    // workspace the read answered. Its field spelling moved on 2026-10-21 when e96643cb (#2949)
    // corrected the seed to the camelCase the route actually answers with, so the gate reads
    // `tenant?.planId` now; a snake_case `plan_id` on that line would mean the fix was reverted.
    expect(gen, 'the plan sentence is asserted about an unread read again')
      .toMatch(/\{!failed && tenant\?\.planId !== 'enterprise' && \(/);
    expect(gen, 'the gate is back on the snake_case field the route never answers with')
      .not.toMatch(/tenant\?\.plan_id/);
    // Nothing on this page derives a figure from the read, so nothing may be dashed.
    expect(gen, 'general invented a dash for a total it never had').not.toMatch(/\? '—'/);
  });

  it('splits both localization reads by name, and retires the branch off the bare flag', () => {
    const loc = srcOf(LOCFILE);
    expect(loc, 'the permission read still refuses to look at its own error')
      .toMatch(/error: meError, refetch: refetchMe \} = useApiQuery/);
    expect(loc).toMatch(/const locFailed = Boolean\(locError\) && !locData;/);
    expect(loc).toMatch(/const locStale = Boolean\(locError\) && Boolean\(locData\);/);
    expect(loc).toMatch(/const meFailed = Boolean\(meError\) && !meData;/);
    expect(loc).toMatch(/const meStale = Boolean\(meError\) && Boolean\(meData\);/);
    expect(loc, 'both reads share one reason string — one of them can print undefined')
      .toMatch(/const locReason = locError\?\.message \|\| 'no response from the server';/);
    expect(loc).toMatch(/const meReason = meError\?\.message \|\| 'no response from the server';/);
    expect(loc, '#2829\'s outage is back on the bare flag').toMatch(/if \(locFailed\) return \(/);
    expect(loc, '#2829\'s outage is back on the bare flag').not.toMatch(/if \(locError\) return/);
    expect(loc, 'a kept localization read is being thrown away by an outage arm')
      .not.toMatch(/\{\s*locError\s*&&\s*\(/);
  });

  it('keeps the localization write gated on the permission it cannot see, not the settings it can', () => {
    const loc = srcOf(LOCFILE);
    expect(loc, 'Save is open over an unread permission check')
      .toMatch(/disabled=\{saving \|\| !dirty \|\| meFailed\}/);
    expect(loc, 'the save handler no longer refuses what it cannot authorize').toMatch(/if \(meFailed\) return;/);
    expect(loc, 'a refused refresh is blocking a write the operator is entitled to make')
      .not.toMatch(/disabled=\{[^}]*(locStale|locFailed|meStale)[^}]*\}/);
  });

  it('keeps the read failure out of the fading channel and the write feedback in it', () => {
    for (const [name, src] of [[GEN, srcOf(GEN)], [LOCFILE, srcOf(LOCFILE)]] as const) {
      expect(src, `${name} toasts the read failure from the render body`).not.toMatch(/^\s*if \(\w*[Ee]rror\) toast\.error/m);
      expect(src, `${name} moved the read failure into an effect`).not.toMatch(/useEffect\(\(\) => \{ if \(\w*[Ee]rror\) toast/);
    }
    expect(srcOf(GEN), 'an action still owes the operator transient feedback').toMatch(/onError: \(e: Error\) => toast\.error/);
    expect(srcOf(GEN)).toMatch(/toast\.success\('Settings saved'\)/);
    expect(srcOf(LOCFILE)).toMatch(/toast\.success\('Localization saved'\)/);
  });

  it('names the trigger its WHY comment claims, and the comment stays checkable', () => {
    // The epic's ordinary trigger — a write that invalidates its own read — does NOT exist on
    // these two pages. If someone adds one, this case goes red and the copy must be re-earned.
    for (const [name, src] of [[GEN, srcOf(GEN)], [LOCFILE, srcOf(LOCFILE)]] as const) {
      expect(src, `${name} now invalidates, so the WHY comment is stale`).not.toMatch(/invalidateQueries/);
      expect(src, `${name}'s WHY comment no longer names the remount that revalidates`).toMatch(/staleTime: 30_000/);
      expect(src).toMatch(/refetchOnReconnect/);
    }
    expect(srcOf(LOCFILE), 'localization\'s save stopped re-seeding original locally')
      .toMatch(/setOriginal\(loc\)/);
    expect(srcOf(GEN), 'general\'s save stopped merging the response locally')
      .toMatch(/setTenantOverride\(prev => \(\{ \.\.\.prev, \.\.\.d \}\)\)/);
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const gen = srcOf(GEN);
    const loc = srcOf(LOCFILE);

    expect(inspect(GEN, gen).offends, `${GEN} was already on the guard's list`).toBe(false);
    expect(inspect(LOCFILE, loc).offends, `${LOCFILE} was already on the guard's list`).toBe(false);

    const genRewinds: [RegExp, string][] = [
      // The caveat back onto the outage arm: a kept read announced as never-read.
      [/\n\s*\{stale && \([\s\S]*?\n\s*\)\}\n/, '\n'],
      // The outage back onto the bare flag.
      [/\{failed && \(/, '{error && ('],
      // No split at all.
      [/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);\n/, ''],
      // The write gate taken back out — the data-loss path this slice exists for.
      [/disabled=\{saving \|\| failed\}/, 'disabled={saving}'],
    ];
    for (const [pattern, replacement] of genRewinds) {
      expect(gen, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(GEN, gen.replace(pattern, replacement)).offends,
        `the guard would see ${GEN} once the split is taken back out: ${replacement}`).toBe(false);
    }

    const locRewinds: [RegExp, string][] = [
      [/\n\s*\{locStale && \([\s\S]*?\n\s*\)\}\n/, '\n'],
      [/if \(locFailed\) return \(/, 'if (locError) return ('],
      [/\n\s*\{meFailed && \([\s\S]*?\n\s*\)\}\n/, '\n'],
      [/disabled=\{saving \|\| !dirty \|\| meFailed\}/, 'disabled={saving || !dirty}'],
    ];
    for (const [pattern, replacement] of locRewinds) {
      expect(loc, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(LOCFILE, loc.replace(pattern, replacement)).offends,
        `the guard would see ${LOCFILE} once the split is taken back out: ${replacement}`).toBe(false);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality: pinning the count goes red every time another slice
    // honestly fixes a panel.
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files, 'a page belongs on the baseline only if a reviewed PR says why').not.toContain(GEN);
    expect(files).not.toContain(LOCFILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the guard allows', () => {
    for (const f of [GEN, LOCFILE]) {
      const lines = srcOf(f).split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the outage half to the suite that already pins it, and speaks of it nowhere else', () => {
    // #2829 owns the never-answered case for `localization`; two suites claiming one page is how
    // the copy diverges. It must not start asserting a kept read.
    const two829 = 'tests/unit/panel-page-error-not-empty-tenant-settings-2829.test.tsx';
    expect(srcOf(two829), `${two829} now speaks about a last read`).not.toMatch(/last read/);
    expect(srcOf(two829)).toMatch(/Failed to load your localization settings/);

    // And no other suite has started mounting these two pages.
    const mounted = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => /settings\/(general|localization)\/page/.test(srcOf(`tests/unit/${f}`)));
    expect(mounted.sort()).toEqual([
      'panel-page-error-not-empty-general-localization-stale-2872.test.tsx',
      'panel-page-error-not-empty-tenant-settings-2829.test.tsx',
      // `settings-general-camelcase-seed-2949` joined on 2026-10-21 (#2962). It mounts the
      // workspace form to pin what the form HOLDS and what its PATCH sends when the route
      // answers camelCase — a different claim from this file's, and it is held to the same
      // boundary as #2829's below: it must not start asserting the freshness copy.
      'settings-general-camelcase-seed-2949.test.tsx',
    ].sort());
    expect(srcOf('tests/unit/settings-general-camelcase-seed-2949.test.tsx'),
      'the #2949 seed suite has started speaking about a last read')
      .not.toMatch(/last read|Could not refresh|Failed to load/);
  });
});
