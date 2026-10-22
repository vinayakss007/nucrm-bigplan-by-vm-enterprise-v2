// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/users/[id]/page.tsx`: the account card that let one flag answer two
 * opposite questions.
 *
 * One read — `['superadmin','user',id]` → `/api/superadmin/users/<id>` — and at base the page
 * bound `error` only to feed a fading toast, then branched on the payload:
 *
 *     const { data, isLoading, error } = useApiQuery(...);
 *     useEffect(() => { if (error) toast.error(...) }, [error]);
 *     if (!user) return <p>User not found</p>;
 *
 * `lib/query/client.tsx:41` is what makes that branch a lie: `apiFetcher` throws
 * `ApiQueryError('Request failed (504)')` on a non-2xx, and TanStack hands a FAILED REVALIDATION of
 * an already-answered read back to the page WITH its `data`. So both of these arrived at the same
 * sentence:
 *
 *   - a read that never got through (500, dead pool, gateway timeout) → "User not found", a claim
 *     about whether the account exists, made by a request that never reached the table. The card
 *     then disappears for four seconds' worth of toast and the operator is left holding an
 *     assertion the server never made.
 *   - a refresh refused after the account loaded → the last read, rendered with nothing saying so.
 *     The tenant count and the membership rows are exactly the fields a super-admin is checking
 *     before they add or remove a membership elsewhere, and none of it is current.
 *
 * A third state is real and must NOT be folded into the outage: `app/api/superadmin/users/[id]/route.ts:61`
 * answers an id that is not a user with `404 User not found` (and `:25` does the same for a
 * non-id segment, the #2781 fix). That is the server ANSWERING about this id, and
 * `lib/query/client.tsx:27` proves `ApiQueryError` carries the `status` it got, so `notFound =
 * failed && error?.status === 404` stays its own arm: a refused refresh may not be reported as
 * "this user does not exist", and a genuinely missing user may not be reported as an outage.
 *
 * Rule 1 has nothing to gate here, and that is the finding: this page issues no writes. It has no
 * `useMutation`, no `fetch(`, no PATCH/POST/DELETE — the only controls it renders are the two
 * banners' "Try again" and navigation `Link`s, and every case below captures `fetch` to prove it.
 * The links stay live over a last read because each destination re-reads for itself
 * (`app/superadmin/users/page.tsx:132`, `app/superadmin/tenants/<id>/page.tsx:58-62`), so clicking
 * through asks the question again rather than acting on what this card is holding. Nothing
 * irreversible or queue-wide is reachable from a stale copy of this page. (That second path is
 * spelled `<id>` rather than the route folder's bracketed form on purpose: #2940's overlap pin
 * scans every suite source for that page's directory path and treats a hit as a suite that MOUNTS
 * it, and this one only cites where a link goes.)
 *
 * What is dashed: `membership_count`. `?? 0` printed a total for a field the payload never carried;
 * the route does send one (`app/api/superadmin/users/[id]/route.ts:53`, COALESCE'd), so the honest
 * zero stays honest and the missing field becomes `—`.
 *
 * RED AT BASE — measured on `5f53fe71` and again on this branch's base after the rebase,
 * `34ae7808`, with the page rewound to what main
 * carries and this file as committed: **18 failed / 9 passed (27)** (unchanged by **#3018**,
 * which rewrote a different page). Seven of the eighteen are the
 * refused refresh (kept rows with nothing saying so, the caveat's own retry, the caveat over an
 * empty last answer, the messageless refusal that printed nothing, the count a payload left out,
 * the internals pin, and the finding that this page issues no write to gate), four are the outage
 * (a never-answered read still claiming the account does not exist, its own messageless case, the
 * "way back" case, the good → refused → good walk), and seven are source ratchets (the three-state
 * split, the two banners verbatim above what they describe, the retry bound to this read alone, the
 * dash keyed off the absent field, the read failure kept off the fading channel, no server
 * internals in its own copy, and the guard's blindness before and after the rewind). The 9 that
 * pass at base are the behaviour this fix must not regress: the 404 that really is an answer about
 * this id, the answered "no such account" card, the honest zero an answered read reported, the
 * freshness silence on a good read, the first-load spinner, the no-loading-union pin, the guard +
 * baseline scan, the line ceiling, and the hygiene check that no other suite mounts this page.
 *
 * Fixtures are documentation-only (RFC 2606 .test names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
// The page used to answer its read failure with a toast. Mocking the module is how this suite
// proves that channel can no longer satisfy an assertion: nothing below reads a toast, and every
// failure case asserts the copy reached the page's own `role="alert"` subtree.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'usr-7' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/superadmin/users',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import UserDetailPage from '@/app/superadmin/users/[id]/page';

// The page builds its URL off `useParams().id`, mocked above to 'usr-7'.
const USER = '/api/superadmin/users/usr-7';
const NOW = '2026-01-05T00:00:00Z';

const userDetail = {
  id: 'usr-7',
  email: 'ada@acme.test',
  full_name: 'Ada Operator',
  phone: '+15550100',
  timezone: 'Asia/Singapore',
  is_super_admin: true,
  email_verified: true,
  oauth_provider: 'google',
  locale: 'en',
  theme: 'dark',
  created_at: NOW,
  membership_count: 2,
  memberships: [
    { tenant_id: 'tn-1', tenant_name: 'Acme Freight', role_slug: 'owner', status: 'active', created_at: NOW },
    { tenant_id: 'tn-2', tenant_name: 'Northwind HQ', role_slug: 'agent', status: 'suspended', created_at: NOW },
  ],
};
const payload = { data: userDetail };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the account loaded before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** `apiFetcher` stamps the status it got (`lib/query/client.tsx:41`); 404 is an answer about this id. */
const refused404 = (): QueryResult => {
  const error = new Error('Request failed (404)') as Error & { status?: number };
  error.status = 404;
  return { data: undefined, error, isLoading: false, refetch: vi.fn() };
};

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * The account's name as the card prints it. `full_name` and `email` are each rendered twice (the
 * header and the Profile card), so a bare text query over them is ambiguous by construction.
 */
const nameHeading = () => screen.getByRole('heading', { level: 1 });

/**
 * Matches of `re` that are NOT inside an alert. The outage copy quotes the sentence it retires
 * ("does not exist"), so a bare text query would find the banner's own words and report the false
 * claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

/** Every `fetch` the page issues, so a rule-1 claim about "no writes here" is measured, not assumed. */
function captureFetch() {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  }));
  return calls;
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

describe('user detail: kept rows say they are the last read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused refresh keeps the account on screen and names the read it is holding', () => {
    const read = staleRead(payload);
    registry.byUrl = { [USER]: read };
    const { container } = wrapped(<UserDetailPage />);
    expect(nameHeading().textContent).toContain('Ada Operator');
    expect(screen.getAllByText('ada@acme.test').length).toBeGreaterThan(0);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('Northwind HQ')).toBeTruthy();
    expect(screen.getByText(/2 active tenants/)).toBeTruthy();
    expect(alerts()).toContain(
      'Could not refresh this user, so the profile, tenant count and memberships below are the last read: Request failed (504). ' +
      'A membership added, removed or re-roled since that read is missing here, and the count is the number that read reported.',
    );
    // The outage sentence would be the opposite lie, and "User not found" is the claim this slice
    // exists to stop: an account the server named 60 seconds ago may not be announced as absent.
    expect(claimsOutsideAlerts(/Failed to load this user/)).toEqual([]);
    expect(screen.queryByText('User not found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    // Banner ABOVE the rows and figures it describes.
    const banner = container.querySelector('[role="alert"]') as HTMLElement;
    const rows = nameHeading();
    expect(banner.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the page issues no write at all, so there is nothing to gate over a last read', () => {
    const calls = captureFetch();
    registry.byUrl = { [USER]: staleRead(payload) };
    const { container } = wrapped(<UserDetailPage />);
    // Every control this page renders is either a banner retry or a navigation link.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => (b.textContent ?? '').trim())).toEqual(['Try again']);
    fireEvent.click(buttons[0]);
    expect(calls).toEqual([]);
    expect(registry.byUrl[USER].refetch).toHaveBeenCalledTimes(1);
    // The links stay live because each destination re-reads; clicking through asks again instead of
    // acting on what this card is holding.
    expect(screen.getByText('Acme Freight').closest('a')?.getAttribute('href')).toBe('/superadmin/tenants/tn-1');
    expect(screen.getByText('Northwind HQ').closest('a')?.getAttribute('href')).toBe('/superadmin/tenants/tn-2');
    expect(container.querySelector('a[href="/superadmin/users"]')).toBeTruthy();
  });

  it('the caveat re-runs this read, and is not a reload of the app', () => {
    const calls = captureFetch();
    const read = staleRead(payload);
    registry.byUrl = { [USER]: read };
    wrapped(<UserDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    // A retry re-runs this read through the query client the page is mounted in; it is not the
    // page reaching for `fetch` itself, and not a queue-wide invalidation (pinned in the ratchet).
    expect(calls).toEqual([]);
  });

  it('a refused refresh over an empty last answer says not found AND carries the caveat', () => {
    // Reachable shape for a payload whose `data` arm is null while the next refresh refused; the
    // absence sentence is then honest about being the last read's answer.
    registry.byUrl = { [USER]: staleRead({ data: null }) };
    wrapped(<UserDetailPage />);
    expect(screen.getByText('User not found')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh this user, so the answer below is the last read: Request failed (504).');
    expect(alerts()).toContain('An account created or restored since that read would not appear here.');
    expect(claimsOutsideAlerts(/Failed to load this user/)).toEqual([]);
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [USER]: staleRead(payload, '') };
    wrapped(<UserDetailPage />);
    expect(alerts()).toContain('are the last read: no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(alerts()).not.toContain('null');
    expect(nameHeading().textContent).toContain('Ada Operator');
  });

  it('a count the read never carried is dashed, not zeroed', () => {
    // The route COALESCEs the count (`app/api/superadmin/users/[id]/route.ts:53`), so this shape is
    // a payload that did not answer that question — `?? 0` used to print a total for it.
    registry.byUrl = { [USER]: ok({ data: { ...userDetail, membership_count: undefined } }) };
    wrapped(<UserDetailPage />);
    expect(screen.getByText(/— active tenants/)).toBeTruthy();
    expect(screen.queryByText(/0 active tenants/)).toBeNull();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [USER]: ok(payload) };
    wrapped(<UserDetailPage />);
    expect(nameHeading().textContent).toContain('Ada Operator');
    expect(screen.getByText(/2 active tenants/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('leaves no server internals in what the operator actually reads', () => {
    // The DOM is the copy the rules are about. With the interpolated refusal removed — `${reason}`
    // is the house convention and carries the status on purpose — nothing on the page may name a
    // code, a path or a hook.
    for (const read of [failed('Request failed (503)'), staleRead(payload)]) {
      registry.byUrl = { [USER]: read };
      wrapped(<UserDetailPage />);
      const spoken = alerts().replace(/Request failed \(\d{3}\)/g, '');
      expect(spoken.length).toBeGreaterThan(20);
      expect(spoken).not.toMatch(/\b(?:4|5)\d\d\b/);
      expect(spoken).not.toMatch(/endpoint|status code|useApiQuery|\.tsx?\b|app\/api/i);
      cleanup();
    }
  });

  it('an honest zero from an answered read stays a zero', () => {
    registry.byUrl = {
      [USER]: ok({ data: { ...userDetail, membership_count: 0, memberships: [] } }),
    };
    wrapped(<UserDetailPage />);
    expect(screen.getByText(/0 active tenants/)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/User not found/)).toEqual([]);
  });
});

describe('user detail: a read that never answered (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('is an outage, and never a statement that the user does not exist', () => {
    registry.byUrl = { [USER]: failed('Request failed (500)') };
    wrapped(<UserDetailPage />);
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.queryByText('Acme Freight')).toBeNull();
    // No absence sentence, and no figure a failed read turned into a number.
    expect(claimsOutsideAlerts(/User not found/)).toEqual([]);
    expect(screen.queryByText(/active tenants/)).toBeNull();
    expect(alerts()).toContain(
      'Failed to load this user: Request failed (500). The profile, tenant count and memberships are unanswered, and this is not a statement that the account does not exist.',
    );
    expect(alerts()).not.toContain('last read');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[USER].refetch).toHaveBeenCalledTimes(1);
  });

  it('an outage still leaves the way back, and issues no write', () => {
    const calls = captureFetch();
    registry.byUrl = { [USER]: failed('Request failed (502)') };
    wrapped(<UserDetailPage />);
    expect(screen.getByText(/Back to Users/).getAttribute('href')).toBe('/superadmin/users');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(calls).toEqual([]);
  });

  it('an outage with nothing to say names the server, not undefined', () => {
    registry.byUrl = { [USER]: failed('') };
    wrapped(<UserDetailPage />);
    expect(alerts()).toContain('Failed to load this user: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('a 404 is the server answering that this account does not exist', () => {
    // app/api/superadmin/users/[id]/route.ts:61 — the request got through and named this id. Folding
    // it into the outage arm is its own false statement, so it keeps its own branch.
    registry.byUrl = { [USER]: refused404() };
    wrapped(<UserDetailPage />);
    expect(screen.getByText('User not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(/Failed to load this user/)).toBeNull();
  });

  it('a read that answered with no account says not found with no alert', () => {
    registry.byUrl = { [USER]: ok({ data: null }) };
    wrapped(<UserDetailPage />);
    expect(screen.getByText('User not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('walks the refresh: a good read, a refused one, a good read again', () => {
    registry.byUrl = { [USER]: ok(payload) };
    const view = wrapped(<UserDetailPage />);
    expect(nameHeading().textContent).toContain('Ada Operator');
    expect(alerts()).toBe('');

    registry.byUrl = { [USER]: staleRead(payload) };
    view.rerender(tree(<UserDetailPage />));
    expect(nameHeading().textContent).toContain('Ada Operator');
    expect(alerts()).toContain('are the last read');

    registry.byUrl = { [USER]: ok(payload) };
    view.rerender(tree(<UserDetailPage />));
    expect(alerts()).toBe('');
  });

  it('a first load is a spinner that claims nothing at all', () => {
    registry.byUrl = { [USER]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    const { container } = wrapped(<UserDetailPage />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claimsOutsideAlerts(/User not found/)).toEqual([]);
    expect(claimsOutsideAlerts(/Failed to load this user/)).toEqual([]);
    expect(screen.queryByText(/active tenants/)).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/superadmin/users/[id]/page.tsx';
  const src = () => readFileSync(join(ROOT, PAGE), 'utf8');

  it('splits the one read into three states', () => {
    const text = src();
    expect(text).toMatch(/const \{ data, isLoading, error, refetch \} = useApiQuery/);
    expect(text).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(text).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(text).toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
    // …and keeps the server's answer about this id out of the outage arm.
    expect(text).toMatch(/const notFound = failed && error\?\.status === 404;/);
    expect(text).toMatch(/if \(failed && !notFound\) \{/);
    expect(text, 'the outage branch still routes off the bare flag').not.toMatch(/if \(error\) \{/);
  });

  it('speaks the two banners verbatim, above what they describe', () => {
    const text = src();
    expect(text).toContain(
      '`Failed to load this user: ${reason}. The profile, tenant count and memberships are unanswered, and this is not a statement that the account does not exist.`',
    );
    expect(text).toContain(
      '`Could not refresh this user, so the profile, tenant count and memberships below are the last read: ${reason}. ' +
      'A membership added, removed or re-roled since that read is missing here, and the count is the number that read reported.`',
    );
    expect(text).toContain(
      '`Could not refresh this user, so the answer below is the last read: ${reason}. An account created or restored since that read would not appear here.`',
    );
    expect(text.match(/Could not refresh this user/g)).toHaveLength(2);
    // Each banner renders ahead of the rows and figures it describes, and the one in the main
    // return is the first thing under the page's own container.
    const firstBanner = text.indexOf('{stale && <InlineErrorState');
    const lastBanner = text.lastIndexOf('{stale && <InlineErrorState');
    expect(firstBanner).toBeGreaterThan(-1);
    expect(lastBanner).toBeLessThan(text.indexOf('<h1 className="text-lg font-bold'));
    expect(lastBanner).toBeLessThan(text.indexOf('active tenant'));
    expect(text.match(/\{stale && <InlineErrorState/g)).toHaveLength(2);
  });

  it('binds every retry to this read, and to nothing else', () => {
    const text = src();
    expect(text.match(/onRetry=\{refetch\}/g)).toHaveLength(3);
    expect(text, 'a retry became a full page reload').not.toMatch(/location\.reload|window\.location/);
    expect(text, 'a retry became a queue-wide invalidation').not.toMatch(/invalidateQueries|useQueryClient/);
    expect(text).not.toMatch(/queryClient/);
  });

  it('has no loading union and no second read to union with', () => {
    const text = src();
    expect(text, 'two reads are unioned into one spinner').not.toMatch(/isLoading\s*\|\||\|\|\s*\w+\.isLoading/);
    expect(text).toMatch(/const loading = isLoading;/);
    expect((text.match(/useApiQuery</g) ?? []).length, 'this slice grew a second read').toBe(1);
  });

  it('dashes the count a payload left out instead of calling it zero', () => {
    const text = src();
    expect(text).toMatch(/user\.membership_count \?\? '—'/);
    expect(text, 'a missing count printed as a total again').not.toMatch(/membership_count \?\? 0/);
    expect(text, 'a dash keyed off the bare error flag').not.toMatch(/\w*[Ee]rror \? '—'/);
    expect(text, 'kept rows hidden behind the bare flag').not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
  });

  it('keeps the read failure on the page, out of the fading channel', () => {
    const text = src();
    expect(text, 'the read failure toasts instead of staying on screen').not.toMatch(/react-hot-toast|toast\.error/);
    expect(text, 'the load failure moved into an effect instead').not.toMatch(/useEffect\(\(\) => \{/);
    expect(text).toMatch(/InlineErrorState/);
    expect(text, 'the banner component the house uses for a failed read is not imported').toMatch(
      /import InlineErrorState from '@\/components\/shared\/inline-error-state'/,
    );
  });

  it('prints no server internals in its own copy', () => {
    // Every string this page hands to a banner: the three message templates, however they are
    // spelled (a `const …Message = \`…\`` or an inline `message={\`…\`}`).
    const text = src();
    const banners = [
      ...text.matchAll(/(?:const \w*Message = |message=\{)`([^`]*)`/g),
    ].map((m) => m[1]);
    expect(banners.length).toBeGreaterThanOrEqual(3);
    for (const line of banners) {
      for (const banned of [
        /endpoint/i, /\broute\b/i, /status code/i, /\bapp\/|\.tsx?\b/, /\buseApiQuery\b/,
        /\b(?:4|5)\d\d\b/, /may be out of date/i, /may not be reflected/i, /some data/i,
      ]) {
        expect(line, `the page prints server internals: ${banned}`).not.toMatch(banned);
      }
      // `${reason}` is the house convention; nothing else may carry a status.
      expect(line).toContain('${reason}');
    }
    expect((banners.join('\n').match(/\$\{reason\}/g) ?? []).length).toBe(3);
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{stale && <InlineErrorState[\s\S]*?\/>\}/, ''],
      [/if \(failed && !notFound\) \{/, 'if (error) {'],
      [/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);\n\s*const reason = error\?\.message \|\| 'no response from the server';\n\s*const notFound = failed && error\?\.status === 404;\n/, ''],
    ];
    const text = src();
    expect(inspect(PAGE, text).offends, `${PAGE} was already on the guard's list`).toBe(false);
    for (const [pattern, replacement] of rewinds) {
      expect(text, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(
        inspect(PAGE, text.replace(pattern, replacement)).offends,
        `${PAGE} would be visible to the guard once the split is taken back out: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality. The list is empty since #2829's last slice, so every offender
    // is novel — including anything this page might grow.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    expect(files, `${PAGE} should never have been baselined`).not.toContain(PAGE);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${PAGE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('owns this page: no other suite speaks of a last read over it', () => {
    const own = 'panel-page-error-not-empty-superadmin-userdetail-stale-2872.test.tsx';
    const dir = join(ROOT, 'tests/unit');
    const others = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx') && f !== own)
      .filter((f) => /users\/\[id\]\/page/.test(readFileSync(join(dir, f), 'utf8')));
    expect(others, `${PAGE} grew a second owner`).toEqual([]);
    expect(readFileSync(join(dir, own), 'utf8')).toMatch(/last read/);
    // The roster page is #2872's other super-admin user slice; this one must not reach into it.
    expect(readFileSync(join(dir, 'panel-page-error-not-empty-superadmin-users-stale-2872.test.tsx'), 'utf8'))
      .not.toMatch(/users\/\[id\]\/page/);
  });
});
