// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the per-tenant role console, `superadmin/tenants/[id]/roles`.
 *
 * This page is not the toast-only shape the epic names, which is why it was invisible to
 * `check-panel-error-state.mjs`: it read only `.data` and `.isLoading` off both of its
 * queries and bound NEITHER `error`. Its absence sentence was silence — `{roles.map(...)}`
 * with no empty state at all, so an unread roster and an answered-empty one rendered the
 * identical page, and a refused refresh rendered the cards with nothing said. The sibling
 * drill-in, `.../settings`, had the same class in a different shape (a fabricated
 * `{ settings: {}, error: true }` payload and a hand-rolled box with no `role="alert"`);
 * that page and its write gate are **#3018**'s ground, and this suite deliberately does
 * not speak about it — see the overlap-hygiene case at the end.
 *
 * The trigger is the operator's own write. `invalidateRoles()` is the `onSuccess` of the
 * permission PATCH, the create POST and the delete DELETE, and it re-reads BOTH
 * `['superadmin','tenant',tenantId]` — the very key the tenant detail page holds, so that
 * page's Save revalidates this header too — and `['superadmin','tenant-roles',tenantId]`. And `useQuery` keeps the previous `data` when a
 * revalidation rejects (no `keepPreviousData` is set anywhere in `lib/query/client.tsx`,
 * and none is needed: retaining `data` beside a fresh `error` is the default), so "rows
 * kept, error set" is the ordinary state right after a write that succeeded.
 *
 * Both keys carry the tenant id, so a 404 is an answer about the RECORD: GET
 * `/api/superadmin/tenants/[id]` replies 'Tenant not found' for an unresolvable id
 * (`route.ts:25`, `:59`), while `.../roles` answers 200 with an empty list for a tenant
 * that has no roles (`roles/route.ts:80`). That gets a record branch, not an outage.
 *
 * The write decision is taken from the routes, not from the flag. The whole-map PATCH only
 * opens from a card this read produced; POST refuses a taken slug with 409
 * (`roles/route.ts:109-131`) and DELETE 404s a row that is gone
 * (`[roleId]/route.ts:181`), so create, edit and delete stay live over the last read and
 * the cost of a stale save is said where the checkboxes are.
 *
 * RED AT BASE — measured on `9c1f6e1f` with the page rewound to what main carries and this
 * file as committed: **17 failed | 6 passed (23)**. The sixteen behavioural cases split the
 * way the class says they should: nine against a refused refresh (the kept cards that
 * claimed to be current, the row still actionable over a last read, the editor silent about
 * the whole-map save it is making, two banners that never appear, the messageless refusal
 * that printed `undefined`, and both "none configured" wordings), five against a read that
 * never answered (the silence itself, the retry, the unread organization, the 404), and one
 * for the refresh the operator's own Save schedules. The six that pass at base are the
 * controls this slice must not regress, not evidence of the bug: the healthy read that says
 * nothing about freshness, the retired row whose delete stays live because the server
 * answers for a gone row, the create that the outage leaves alone, the four guards green
 * with an empty baseline, the line ceiling, and the overlap-hygiene case. That last group
 * passing at base is the point: `check-panel-error-state.mjs` looked at this page, found a
 * page that prints no absence sentence at all, and moved on. The suite, not the screen, is
 * the check.
 *
 * Fixtures are documentation-only (RFC 2606 names, TEST-NET ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { PERMISSIONS } from '@/lib/permissions/definitions';

type QueryResult = {
  data?: unknown;
  error: (Error & { status?: number; info?: unknown }) | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const ids = vi.hoisted(() => ({
  tenant: '70000000-0000-4000-8000-000000000001',
}));

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
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: ids.tenant }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/superadmin/tenants',
  notFound: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import toast from 'react-hot-toast';
import TenantRolesPage from '@/app/superadmin/tenants/[id]/roles/page';
const TENANT_ID = ids.tenant;
const ROLE_ADMIN = '70000000-0000-4000-8000-0000000000a1';
const ROLE_SALES = '70000000-0000-4000-8000-0000000000a2';

const TENANT_URL = `/api/superadmin/tenants/${TENANT_ID}`;
const ROLES_URL = `/api/superadmin/tenants/${TENANT_ID}/roles`;
const ROLES = {
  data: [
    { id: ROLE_ADMIN, name: 'Administrator', slug: 'admin', description: 'Everything', permissions: { all: true }, is_system: true, user_count: 2 },
    // Real permission ids from `lib/permissions/definitions`, so the map the save sends can be
    // compared against what the modal's category controls actually write.
    { id: ROLE_SALES, name: 'Sales', slug: 'sales', description: 'Pipeline only', permissions: { 'contacts.view_all': true, 'contacts.edit': false, 'leads.view': true }, is_system: false, user_count: 4 },
  ],
  tenantId: TENANT_ID,
};
const TENANT_ROW = { data: { id: TENANT_ID, name: 'Harbor Fitness' } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
const failed = (message = 'Request failed (500)', status = 500): QueryResult => ({
  data: undefined, error: Object.assign(new Error(message), { status, info: {} }), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could name: the read answered, this refresh was refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: Object.assign(new Error(message), { status: 504, info: {} }), isLoading: false, refetch: vi.fn(),
});
/** The same read refusing, with no message at all. */
const messageless = (data: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 502, info: {} }), isLoading: false, refetch: vi.fn(),
});
/** The record is gone — an answer, not an outage. */
const notFoundRead = (route: string): QueryResult => ({
  data: undefined,
  error: Object.assign(new Error('Request failed (404)'), { status: 404, info: { error: 'Tenant not found' }, route }),
  isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Both replacement banners here quote the state
 * they retire, so a bare `queryByText(/Could not load tenant settings/)` would find the banner's
 * own words and report the false claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const button = (name: RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = button(name);
  return el !== null && el.disabled === false;
};
/** The card holding a role row, so its own controls can be picked without an icon-only name. */
function roleCardButtons(roleName: string): HTMLElement[] {
  const card = screen.getByText(roleName).closest('.admin-card') as HTMLElement;
  return Array.from(card.querySelectorAll('button'));
}

/** One category's `None` button. Every category renders its All/None pair whether it is expanded
 *  or not, so a page-wide `getByRole('button', { name: 'None' })` is ambiguous by construction. */
function categoryButton(cat: string, label: 'All' | 'None'): HTMLElement {
  const block = screen.getByText(cat, { exact: true }).closest('button')?.parentElement;
  const found = Array.from(block?.querySelectorAll('button') ?? [])
    .find((b) => (b.textContent ?? '').trim() === label);
  if (!found) throw new Error(`no ${label} button in the ${cat} category`);
  return found;
}

let client: QueryClient;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};
const mountRoles = (tenantResult: QueryResult, rolesResult: QueryResult) => {
  registry.byUrl = { [TENANT_URL]: tenantResult, [ROLES_URL]: rolesResult };
  return wrapped(<TenantRolesPage />);
};
/** Records every write the page attempts, so "the payload is the whole map" is measured. */
let writes: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
function stubWrites(payload: unknown = { ok: true }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    writes.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }));
}

beforeEach(() => {
  registry.byUrl = {};
  writes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('roles: a refused refresh keeps the roster and names the loss (#2872)', () => {
  it('shows both cards and says nothing about freshness', () => {
    mountRoles(ok(TENANT_ROW), ok(ROLES));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Harbor Fitness');
    expect(screen.getByText('Administrator')).toBeTruthy();
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('4 users')).toBeTruthy();
    expect(screen.getByText(/2\/\d+ permissions/)).toBeTruthy();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/last read/)).toEqual([]);
  });

  it('keeps the cards, their tallies and their counts under a last-read caveat', () => {
    const roles = staleRead(ROLES);
    const tenant = ok(TENANT_ROW);
    mountRoles(tenant, roles);
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('4 users')).toBeTruthy();
    expect(screen.getByText(/2\/\d+ permissions/)).toBeTruthy();
    expect(alerts()).toContain('the role cards below are the last read: Request failed (504)');
    expect(alerts()).toContain('one retired since is still listed and still clickable');
    expect(alerts()).not.toContain('Failed to load this organization');
    expect(claimsOutsideAlerts(/No roles configured/)).toEqual([]);
    // Bound to THIS read: the sibling read is not re-run by this banner.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(roles.refetch).toHaveBeenCalledTimes(1);
    expect(tenant.refetch).not.toHaveBeenCalled();
  });

  it('leaves a kept row actionable and its save clickable over the last read', () => {
    mountRoles(ok(TENANT_ROW), staleRead(ROLES));
    expect(roleCardButtons('Sales')[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit: Sales')).toBeTruthy();
    expect(offered(/save changes/i), 'a refused refresh locked the editor it is still showing').toBe(true);
    // The whole-map cost belongs where the checkboxes are, not only in the banner up the page.
    expect(screen.getByText(/permission map this list last read/)).toBeTruthy();
  });

  it('says at the editor what saving the whole map costs, and nowhere when nothing is stale', () => {
    mountRoles(ok(TENANT_ROW), staleRead(ROLES));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/Saving replaces that whole map/)).toBeTruthy();
    cleanup();
    mountRoles(ok(TENANT_ROW), ok(ROLES));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(claimsOutsideAlerts(/Saving replaces that whole map/)).toEqual([]);
    expect(claimsOutsideAlerts(/last read/)).toEqual([]);
  });

  it('keeps a retired row\'s delete live, because the server answers for a gone row', async () => {
    mountRoles(ok(TENANT_ROW), staleRead(ROLES));
    fireEvent.click(roleCardButtons('Sales')[1]);
    // `deleteRole` goes through the confirm dialog's promise, so the mutation is one tick away.
    await waitFor(() => expect(writes.some((w) => w.method === 'DELETE' && w.url.endsWith(ROLE_SALES))).toBe(true));
  });

  it('two refused refreshes get two banners, each retrying its own read', () => {
    const tenant = staleRead(TENANT_ROW, 'Request failed (502)');
    const roles = staleRead(ROLES);
    mountRoles(tenant, roles);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(alerts()).toContain('the organization name above is the last read: Request failed (502)');
    expect(alerts()).toContain('the role cards below are the last read: Request failed (504)');
    const retry = screen.getAllByRole('button', { name: /try again/i });
    fireEvent.click(retry[0]);
    expect(tenant.refetch).toHaveBeenCalledTimes(1);
    expect(roles.refetch).not.toHaveBeenCalled();
    fireEvent.click(retry[1]);
    expect(roles.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refusal with no message prints a reason, never undefined', () => {
    mountRoles(ok(TENANT_ROW), messageless(ROLES));
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('still says "none configured" for an empty last read, next to the caveat', () => {
    mountRoles(ok(TENANT_ROW), staleRead({ data: [], tenantId: TENANT_ID }));
    expect(screen.getByText('No roles configured for this organization.')).toBeTruthy();
    expect(alerts()).toContain('the role cards below are the last read');
    expect(alerts()).not.toContain('Failed to load this organization');
  });

  it('says "none configured" for a read that answered empty, with no alert', () => {
    mountRoles(ok(TENANT_ROW), ok({ data: [], tenantId: TENANT_ID }));
    expect(screen.getByText('No roles configured for this organization.')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('roles: a read that never answered (#2872)', () => {
  it('replaces the silent roster with an outage that cannot claim there are none', () => {
    const roles = failed('Request failed (500)');
    mountRoles(ok(TENANT_ROW), roles);
    expect(alerts()).toContain("Failed to load this organization's roles: Request failed (500)");
    expect(alerts()).not.toContain('last read');
    // The silence this page used to fall back to is now the outage's, not an answer's.
    expect(claimsOutsideAlerts(/No roles configured/)).toEqual([]);
    expect(screen.queryByText('Sales')).toBeNull();
    // No card body at all: neither the tally nor the member count an answered read produced.
    // (A bare /permissions/ would also hit the header's own subtitle, which is not a claim.)
    expect(screen.queryByText(/^\d+\/\d+ permissions$/)).toBeNull();
    expect(screen.queryByText(/^\d+ users?$/)).toBeNull();
  });

  it('keeps New Role offered, because POST refuses a taken name instead of writing a second one', () => {
    mountRoles(ok(TENANT_ROW), failed());
    expect(offered(/new role/i)).toBe(true);
    expect(alerts()).toMatch(/the server refuses a name that is taken/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries only the roster read', () => {
    const tenant = ok(TENANT_ROW);
    const roles = failed();
    mountRoles(tenant, roles);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(roles.refetch).toHaveBeenCalledTimes(1);
    expect(tenant.refetch).not.toHaveBeenCalled();
  });

  it('reports an unread organization without hiding a roster that answered', () => {
    const tenant = failed('Request failed (503)', 503);
    mountRoles(tenant, ok(ROLES));
    expect(alerts()).toContain('Failed to load this organization: Request failed (503)');
    // The name is the only thing this read feeds, so the header says what it does not know.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('This organization');
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(claimsOutsideAlerts(/No roles configured/)).toEqual([]);
  });

  it('treats a 404 as the server answering about the tenant, not as an outage', () => {
    mountRoles(notFoundRead(TENANT_URL), failed('Request failed (404)', 404));
    expect(screen.getByText('No tenant with this id')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByRole('button', { name: /new role/i })).toBeNull();
    expect(claimsOutsideAlerts(/Failed to load this organization/)).toEqual([]);
  });
});

describe('roles: the refresh the operator\'s own write triggers (#2872)', () => {
  it('saves a role, invalidates both keys, and keeps the cards when the reload is refused', async () => {
    mountRoles(ok(TENANT_ROW), ok(ROLES));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const firstCategory = PERMISSIONS[0].category;
    fireEvent.click(categoryButton(firstCategory, 'None'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Permissions updated'));
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['superadmin', 'tenant', TENANT_ID] });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['superadmin', 'tenant-roles', TENANT_ID] });
    // Measured: the PATCH body is the role's ENTIRE permission map — the untouched categories
    // still ride along — and it carries no version field, so [roleId]/route.ts:95's
    // concurrencyGuard passes and nothing on the server can refuse the clash.
    const patch = writes.find((w) => w.method === 'PATCH');
    expect(patch?.url).toBe(`/api/superadmin/tenants/${TENANT_ID}/roles/${ROLE_SALES}`);
    expect(Object.keys(patch?.body ?? {})).toEqual(['permissions']);
    const sent = patch?.body?.permissions as Record<string, boolean>;
    const cleared = PERMISSIONS.filter((p) => p.category === firstCategory).map((p) => p.id);
    expect(cleared.every((id) => sent[id] === false)).toBe(true);
    // The category nobody touched still rides along in the replace.
    expect(sent['leads.view']).toBe(true);
    expect(Object.keys(sent).length).toBeGreaterThan(cleared.length);

    // The reload `invalidateRoles()` fires comes back refused: the roster the save produced is
    // still on screen, now labelled, with the editor still reachable from the cards.
    mountRoles(ok(TENANT_ROW), staleRead(ROLES));
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(alerts()).toContain('the role cards below are the last read');
    expect(alerts()).not.toContain('Failed to load this organization');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(offered(/save changes/i)).toBe(true);
  });

  it('a create is not a data-loss path, so the outage leaves it alone', async () => {
    mountRoles(ok(TENANT_ROW), ok(ROLES));
    fireEvent.click(screen.getByRole('button', { name: /new role/i }));
    fireEvent.change(screen.getByPlaceholderText('Custom Role Name'), { target: { value: 'Support lead' } });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const post = writes.find((w) => w.method === 'POST');
    expect(post?.url).toBe(`/api/superadmin/tenants/${TENANT_ID}/roles`);
    expect((post?.body as { name: string }).name).toBe('Support lead');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Role created'));
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const ROLES_FILE = 'app/superadmin/tenants/[id]/roles/page.tsx';
  const srcOf = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('splits both reads into the three states the page has to tell apart', () => {
    const r = srcOf(ROLES_FILE);
    for (const [read, payload] of [['tenantQuery', 'tenantData'], ['rolesQuery', 'rolesData']] as const) {
      expect(r, `${read} never separates the outage from a refused refresh`)
        .toMatch(new RegExp(`const \\w+Failed = Boolean\\(${read}\\.error\\) && !${payload};`));
      expect(r, `${read} keeps the payload without calling it the last read`)
        .toMatch(new RegExp(`const \\w+Stale = Boolean\\(${read}\\.error\\) && Boolean\\(${payload}\\);`));
      expect(r, `${read} prints a reason that can be undefined`)
        .toMatch(new RegExp(`const \\w+Reason = ${read}\\.error\\?\\.message \\|\\| 'no response from the server';`));
    }
    expect(r, 'roles treats a 404 about the tenant as an outage')
      .toMatch(/const notFound = \(tenantFailed && tenantQuery\.error\?\.status === 404\)/);
    for (const arm of ['{tenantFailed && (', '{tenantStale && (', '{rolesStale && (', '{rolesFailed && (']) {
      expect(r, `roles lost the ${arm} arm`).toContain(arm);
    }
    expect(r, 'roles never warns over a roster it is still showing')
      .not.toMatch(/\{\s*(?:tenant|roles)Query\.(?:error|isError)\s*(&&|\?)/);
  });

  it('retires the silence without gating a single write on the new flag', () => {
    const r = srcOf(ROLES_FILE);
    expect(r, 'the read failure went back to a fading toast').not.toMatch(/^\s*if \(error\) toast\.error/m);
    expect(r, 'the writes lost their own toasts').toMatch(/toast\.success\('Permissions updated'\)/);
    // Nothing here may lock a write onto `stale`, and no row control may be gated on the flag.
    expect(r, 'a write control started refusing the last read').not.toMatch(/disabled=\{[^}]*(?:rolesStale|rolesFailed|tenantStale|tenantFailed)[^}]*\}/);
    expect(r, 'the empty roster is back to answering for an unread read')
      .toMatch(/\{!rolesFailed && roles\.length === 0 && \(/);
    expect(r, 'the cards are rendered without the outage arm excluding them')
      .toMatch(/\{!rolesFailed && roles\.map\(/);
    // The header used to print `undefined — Role Permissions` for an organization it could not
    // read; it now falls back to a noun that is not a name. Pinned as an absence, because the
    // bare optional chain is what creeps back.
    expect(r, 'the header is back on a bare optional chain').not.toMatch(/\{tenant\?\.name\} — Role Permissions/);
  });

  it('records what the routes do, so the write decisions can be re-checked', () => {
    const r = srcOf(ROLES_FILE);
    expect(r, 'the page no longer says why create and delete stay live')
      .toMatch(/roles\/route\.ts:109-131, 409\)[\s\S]*\[roleId\]\/route\.ts:181/);
    expect(r, 'the page no longer says why the PATCH cannot be refused')
      .toMatch(/\[roleId\]\/route\.ts:85-87, :95;[\s\S]*lib\/api\/concurrency\.ts:31/);
  });

  it('keeps the guards green, with the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866 each had
    // to undo. #2829's last slice took it to zero.
    expect(files.length, 'the panel guard baseline grew').toBeLessThanOrEqual(3);
    expect(files, `${ROLES_FILE} belongs in a page, not in the baseline`).not.toContain(ROLES_FILE);
    for (const script of ['check-panel-error-state.mjs', 'check-file-size.mjs', 'check-any-suppressions.mjs', 'check-catch-empty.mjs']) {
      const res = spawnSync('node', [`scripts/${script}`], { cwd: ROOT, encoding: 'utf8' });
      expect(res.status, `${script}: ${res.stdout}${res.stderr}`).toBe(0);
    }
    const guard = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(guard.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks one question: does a page that prints "there are none" also bind an error
    // and render some failure affordance. This page answered it at base by printing no sentence
    // at all, and every rewind below keeps answering it — which is why this suite, not the
    // screen, is the check.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const r = srcOf(ROLES_FILE);
    expect(inspect(ROLES_FILE, r).offends, 'the fixed roles page offends the guard').toBe(false);

    const rewinds: [string, string][] = [
      // Base: neither read bound an error, and an unread roster printed the same silence an
      // empty answer did.
      ['no read bound, no sentence', r
        .replace('{rolesFailed && (', '{false && (')
        .replace('{!rolesFailed && roles.length === 0 && (', '{roles.length === 0 && (')
        .replace('const rolesFailed = Boolean(rolesQuery.error) && !rolesData;\n', '')],
      // The other wrong answer: the last-read caveat deleted, so kept cards claim the roster is
      // current right after the operator's own write was refused.
      ['no caveat over kept cards', r
        .replace(/\n\s*\{rolesStale && \(\n[\s\S]*?\n\s*\)\}\n/, '\n')
        .replace('const rolesStale = Boolean(rolesQuery.error) && Boolean(rolesData);\n', '')],
      // The roster's own outage banner back to a `length === 0` sentence: a read that never
      // answered is reported as an organization with no roles.
      ['outage collapsed into "none configured"', r
        .replace(/\n\s*\{rolesFailed && \(\n[\s\S]*?\n\s*\)\}\n/, '\n')
        .replace('{!rolesFailed && roles.length === 0 && (', '{roles.length === 0 && (')],
    ];

    for (const [name, rewind] of rewinds) {
      expect(rewind, `roles: ${name}: the split changed spelling, update this check`).not.toBe(r);
      expect(inspect(ROLES_FILE, rewind).offends, `roles: ${name} would be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling the guard allows', () => {
    const lines = srcOf(ROLES_FILE).split('\n').length - 1;
    // 498 on this slice's head against a ceiling of 500: the four banners and the editor's
    // caveat are what crossed it from main's 395, so a fifth sentence here needs to be said
    // shorter, not added.
    expect(lines, `${ROLES_FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the settings drill-in and its suite to #3018', () => {
    // Overlap hygiene, in both directions. This slice owns the roles page; #3018 shipped the
    // settings page and its own suite, so this file must not name that page — two suites over
    // one page is how the copy diverges — and no other suite may start speaking about the
    // roster this one now describes.
    const mine = 'panel-page-error-not-empty-superadmin-tenant-roles-stale-2872.test.tsx';
    const own = srcOf(join('tests/unit', mine));
    // Naming the path would already be a second suite reading that page from disk; importing and
    // mounting it is the overlap that actually diverges, so both are refused.
    expect(own, 'this suite speaks about the settings page, which #3018 owns')
      .not.toMatch(/tenants\/\[id\]\/settings\/page/);
    // The settings fixture's own URL constant: if it were back, this file would be mounting a
    // page #3018 already owns. Named by the identifier rather than the path, because a pattern
    // that quotes the path would be matching the text of its own assertion.
    expect(own, 'this suite mounts a third page through the settings URL').not.toContain('SETTINGS_' + 'URL');

    const speakers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.tsx') && f !== mine)
      .filter((f) => srcOf(join('tests/unit', f)).includes(ROLES_FILE));
    expect(speakers, `${speakers.join(', ')} also name the roles page`).toEqual([]);
    for (const t of [
      'tests/unit/second-read-false-empty-2841.test.tsx',
      'tests/unit/panel-page-error-not-empty-superadmin-2829.test.tsx',
      'tests/unit/superadmin-roles-tenant-scoping.test.ts',
    ]) {
      expect(srcOf(t), `${t} now speaks about a last read`).not.toMatch(/last read/);
    }
  });
});
