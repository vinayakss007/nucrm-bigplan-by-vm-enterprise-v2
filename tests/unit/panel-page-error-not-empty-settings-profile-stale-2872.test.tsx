// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/profile/page.tsx`: the profile editor that reported a
 * read that never answered as a read still in flight, forever.
 *
 * One read — `['tenant','me']` → `/api/tenant/me` — and at base it destructured only
 * `data`, so the page had no error to branch on and one guard for everything:
 *
 *     const { data } = useApiQuery<{ user?: UserProfile }>(['tenant', 'me'], '/api/tenant/me');
 *     …
 *     if (!user) return <div className="animate-pulse …">;
 *
 * That skeleton is the false claim. It is the picture of a request in progress, and
 * nothing ever resolves it: the outage arm and the loading arm were the same arm, and
 * the only retry available was to reload the document. Meanwhile a refused
 * revalidation handed the page back its `data` (`lib/query/client.tsx` keeps it), which
 * the same guard read as "still loading" and hid — so the operator lost an answered
 * profile to a 504 and was given no way to say why.
 *
 * Now: `failed = Boolean(meError) && !data` is the outage — the editor is not offered,
 * because a blank name, an empty phone and the `UTC` default are not this operator's
 * details and pressing Save with them would write them over what is on record. That is
 * epic rule #1 on a page whose only server write is the operator's own row
 * (`app/api/user/profile/route.ts:82-85`, `where eq(users.id, ctx.userId)`): the record
 * is right, the values are not, and the route's version check
 * (`route.ts:75-79`, `expectedUpdatedAt`) only runs when the body carries a stamp, which
 * this page never sends — pinned below by reading the actual PATCH body. `stale =
 * Boolean(meError) && Boolean(data)` keeps the form and its seeded values under a
 * banner that names that overwrite. The Change Password card is never suppressed by
 * either read state: it derives nothing from `['tenant','me']`, it re-reads
 * `passwordHash` and verifies the current password before writing
 * (`app/api/user/password/route.ts:32-40`), so a profile outage must not lock the one
 * control that can still be exercised correctly.
 *
 * Fixtures are documentation-only (RFC 2606 names).
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
// Mocking the toast module is how this suite proves a READ failure never reaches the
// write channel: no assertion below can be satisfied by a toast.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import ProfilePage from '@/app/tenant/settings/profile/page';
import toast from 'react-hot-toast';

const ME = '/api/tenant/me';
const ROOT = process.cwd();
const PAGE = 'app/tenant/settings/profile/page.tsx';

/** The payload /api/tenant/me actually returns (route.ts:16-26): no phone, no timezone. */
const PROFILE = {
  user: {
    id: 'u-1',
    email: 'operator@acme.test',
    fullName: 'Ada Operator',
    avatarUrl: 'https://avatars.test/ada.png',
    isSuperAdmin: false,
    lastTenantId: 'acme',
    createdAt: '2026-01-04T00:00:00.000Z',
  },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this page could not name: the read answered, the refresh was refused. */
const refusedRefresh = (data: unknown = PROFILE, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const waiting = (): QueryResult => ({
  data: undefined, error: null, isLoading: true, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** Matches of `re` that are NOT inside an alert, so a banner quoting a retired claim
 *  is not mistaken for the claim still standing. */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const src = () => readFileSync(join(ROOT, PAGE), 'utf8');

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );
};

/** Captures every request the page's own writes make, so the PATCH body can be read. */
function captureFetch(payload = { user: PROFILE.user }) {
  const calls: Array<[string, { method?: string; body?: string }]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string } = { method: 'GET' }) => {
    calls.push([url, init]);
    return { ok: true, status: 200, json: async () => payload };
  }));
  return calls;
}

describe('profile: the editor that made an outage look like a load that never finished (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a healthy read shows the account and says nothing about freshness', () => {
    registry.byUrl = { [ME]: ok(PROFILE) };
    wrapped(<ProfilePage />);
    expect(screen.getByText('operator@acme.test')).toBeTruthy();
    expect(screen.getByText('Full Name')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a read that never answered is an outage, not a skeleton that never resolves', () => {
    registry.byUrl = { [ME]: unread() };
    wrapped(<ProfilePage />);
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(alerts()).toContain('Failed to load your profile: Request failed (500)');
    expect(alerts()).not.toContain('last read');
  });

  it('the outage does not print an identity block it never read', () => {
    registry.byUrl = { [ME]: unread() };
    wrapped(<ProfilePage />);
    expect(screen.queryByText('operator@acme.test')).toBeNull();
    // `email_verified` is not in this payload at all, so the page has always printed
    // "Email not verified" as a fact about the account. Over a read that never
    // answered it must not be printed at all.
    expect(claimsOutsideAlerts(/Email not verified/)).toEqual([]);
  });

  it('rule #1: an unanswered read offers no Save Profile to blank out the record', () => {
    registry.byUrl = { [ME]: unread() };
    wrapped(<ProfilePage />);
    expect(screen.queryByRole('button', { name: /save profile/i })).toBeNull();
    expect(screen.queryByText('Full Name')).toBeNull();
    expect(screen.queryByText('Timezone')).toBeNull();
    expect(alerts()).toContain('an empty name, phone and timezone are not your details');
  });

  it('the password card is not locked by a profile outage: it re-reads before it writes', () => {
    const calls = captureFetch();
    registry.byUrl = { [ME]: unread() };
    wrapped(<ProfilePage />);
    const update = screen.getByRole('button', { name: /update password/i });
    expect(update.hasAttribute('disabled')).toBe(false);
    expect(alerts()).toContain('Failed to load your profile');
    expect(calls).toEqual([]);
  });

  it('a refused refresh keeps the account on screen and calls it the last read', () => {
    const read = refusedRefresh();
    registry.byUrl = { [ME]: read };
    wrapped(<ProfilePage />);
    expect(screen.getByText('operator@acme.test')).toBeTruthy();
    expect(screen.getByText('Full Name')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh your profile, so the email address and the form below are the last read: Request failed (504).');
    expect(alerts()).toContain('nothing on the server compares versions, because this page never sends a stamp to check against');
    expect(claimsOutsideAlerts(/Failed to load your profile/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('rule #1: Save Profile stays usable over a last read, and its body is the overwrite the banner names', async () => {
    const calls = captureFetch();
    registry.byUrl = { [ME]: refusedRefresh() };
    wrapped(<ProfilePage />);
    // The name field carries `required`, so the operator has to have typed something
    // before the browser lets the form go — the point of this case is the body, not the
    // validation, and it is the untouched fields that show what a save overwrites.
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Ada Operator' } });
    const save = screen.getByRole('button', { name: /save profile/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(calls.length).toBe(1), { interval: 10 });
    const [url, init] = calls[0];
    expect(url).toBe('/api/user/profile');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body ?? '{}');
    // The page sends the whole form it seeded from the last read and no version stamp,
    // which is why the banner has to name the overwrite instead of promising a merge.
    expect(Object.keys(body).sort()).toEqual(['avatar_url', 'full_name', 'phone', 'timezone']);
    expect(body.timezone).toBe('UTC');
    expect(body.expectedUpdatedAt).toBeUndefined();
    expect(body._updated_at).toBeUndefined();
  });

  it('a refusal that carried no message still reads as a sentence', () => {
    registry.byUrl = { [ME]: refusedRefresh(PROFILE, '') };
    wrapped(<ProfilePage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toMatch(/undefined|null/);
  });

  it('the never-answered fallback never prints undefined either', () => {
    registry.byUrl = { [ME]: unread('') };
    wrapped(<ProfilePage />);
    expect(alerts()).toContain('Failed to load your profile: no response from the server.');
    expect(alerts()).not.toMatch(/undefined|null/);
  });

  it('the first load is still a skeleton and still says nothing about an outage', () => {
    registry.byUrl = { [ME]: waiting() };
    wrapped(<ProfilePage />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/Failed to load/)).toEqual([]);
  });

  it('a read failure never reaches the toast channel', () => {
    registry.byUrl = { [ME]: unread() };
    wrapped(<ProfilePage />);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('binds the three states to this read and keeps the document reload out of it', () => {
    const s = src();
    expect(s).toMatch(/const failed = Boolean\(meError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(meError\) && Boolean\(data\);/);
    expect(s).toMatch(/const reason = meError\?\.message \|\| 'no response from the server';/);
    // The guard that made both states one arm is gone (the comment above `failed`
    // still quotes it, so the pattern is anchored to the start of a line).
    expect(s).not.toMatch(/^\s*if\s*\(\s*!user\s*\)\s*return/m);
    expect(s).not.toMatch(/location\.reload|window\.location/);
  });

  it('puts the refused-refresh banner above the card it describes', () => {
    const s = src();
    const banner = s.indexOf('{stale && (');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(s.indexOf('<form onSubmit={saveProfile}'));
  });

  it('keeps server internals out of the copy the page prints', () => {
    const s = src();
    const copy = s.split('\n').filter((line) => /message=\{?[`"]/.test(line)).join('\n');
    expect([...copy.matchAll(/message=/g)]).toHaveLength(2); // the two banners, nothing else
    expect(copy).toContain('{reason}');
    expect(copy, 'a source path reached the operator').not.toMatch(/app\/api|route\.ts|\.tsx?:\d|schema\//);
    expect(copy, 'server vocabulary reached the operator').not.toMatch(/\bendpoint\b|\broute\b|\bstatus code\b|\b404\b|\b500\b|\b504\b/);
    expect(copy, 'a hedged caveat').not.toMatch(/out of date|may be|some data/i);
  });

  it('is invisible to the sweep the way the class is, and the guard still passes', () => {
    const s = src();
    expect(s).not.toMatch(/>\s*No profile\b/);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    const files = readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8');
    expect(files, `${PAGE} should never have been baselined`).not.toContain('settings/profile');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    expect(src().split('\n').length - 1, `${PAGE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('is claimed by exactly this suite', () => {
    const others = spawnSync('grep', ['-rl', 'settings/profile/page', 'tests/unit'], { cwd: ROOT, encoding: 'utf8' });
    const files = (others.stdout ?? '').trim().split('\n').filter(Boolean);
    expect(files).toEqual(['tests/unit/panel-page-error-not-empty-settings-profile-stale-2872.test.tsx']);
  });
});
