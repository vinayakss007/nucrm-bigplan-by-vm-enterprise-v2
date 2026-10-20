// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/hierarchy/page.tsx`: the Access Control panel that reported its own
 * health by the absence of a sentence.
 *
 * One read — `['tenant','hierarchy']` → `/api/tenant/hierarchy` — and at base it destructured
 * **neither** `error` nor `refetch`:
 *
 *     const { data, isLoading: loading } = useApiQuery(HIERARCHY_QUERY, '/api/tenant/hierarchy');
 *     …
 *     ) : children.length === 0 && parents.length === 0 ? (<p>No hierarchy relationships</p>) : (<grid/>);
 *
 * Both of the page's writes (`createMutation` POST, `deleteMutation` DELETE) end in `reload()`,
 * which invalidates that exact key. TanStack Query hands a failed refetch of a read that already
 * succeeded back to the page WITH its `data`, so the routine state right after the operator pressed
 * Add Relationship was the previous payload — quite possibly the empty one — under a flag nobody
 * read. The panel then showed the old links and called them current, or, when the list had been
 * empty, denied a relationship that now exists. #2829's guard never counted the page because its
 * `role="alert"` check looks for a false "No … yet" clause and this copy has none: silence was the
 * all-clear.
 *
 * `failed = Boolean(error) && !data` is the outage — the card quotes the reason and the retry is
 * bound to this read. `stale = Boolean(error) && Boolean(data)` keeps what is on screen under a
 * "last read" caveat that names the add or remove a refused refresh would not reflect. The absence
 * sentence is reachable only on a read that answered; a stale empty answer still says the tenant has
 * none and adds that this is all it saw. Nothing is dashed: the permission grid in the create modal
 * comes from the module constants `RELATIONSHIP_TYPES` and `AVAILABLE_PERMISSIONS`, and the modal's
 * one free-text field is the id the operator is typing — so an outage must not lock the form, which
 * is how a first link ever gets made. `children`/`parents` are read off the payload with `?? []`, so
 * there is no count on this page for a refusal to turn into a zero.
 *
 * The sibling `rbac` page is deliberately absent: #2928 landed its three reads first, and
 * `panel-page-error-not-empty-settings-rbac-stale-2872.test.tsx` owns that ground. Two suites
 * mounting one page is how copy diverges.
 *
 * RED AT BASE — measured on `46df92cb` (this branch's parent) with
 * `app/tenant/settings/hierarchy/page.tsx` rewound to what main carries and this file as committed:
 * **9 failed / 8 passed (17)**. Seven of the nine put the read in a state the class is about: kept
 * rows under a refusal, the refusal over an empty last read, the walk good → refused → good, the
 * remove control on a kept row, the never-answered outage (which at base rendered the empty state
 * instead, so even the outage's own Add button was a duplicate), the messageless fallback that
 * printed `undefined`, and the outage card's missing "Try again". The last two are the source
 * ratchets — the split bindings, and the guard-blindness case whose rewind patterns match nothing
 * until the stale banner exists. The 8 that pass at base are the controls this slice must not
 * regress: the healthy read saying nothing about freshness, the answered "there are none", and the
 * six pins that hold regardless of the split (dash ban, toast channel, the reload() trigger, guard
 * + baseline, line ceiling, overlap hygiene).
 *
 * Fixtures are documentation-only (RFC 2606 .test names).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
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
// The page still toasts — but only inside its mutation handlers. Mocking the module is how this
// suite proves a READ failure never reaches that channel: no assertion below can be satisfied by a
// toast, and the outage cases assert the load copy reached the panel's own subtree instead.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import HierarchyPage from '@/app/tenant/settings/hierarchy/page';

const HIERARCHY = '/api/tenant/hierarchy';
const NOW = '2026-10-01T00:00:00Z';

const hierarchyRows = {
  data: {
    children: [
      { id: 'h-1', parentTenantId: 'acme-hq', childTenantId: 'acme-west', relationship: 'subsidiary', createdAt: NOW },
    ],
    parents: [
      { id: 'h-2', parentTenantId: 'northwind-hq', childTenantId: 'acme-hq', relationship: 'parent', createdAt: NOW },
    ],
  },
};
const noHierarchy = { data: { children: [], parents: [] } };

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
 * Matches of `re` that are NOT inside an alert. The outage copy quotes the sentence it retires, so
 * a bare `queryByText(/No hierarchy relationships/)` would find the banner's own words and report
 * the false claim as still standing.
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

describe('hierarchy: the panel that bound neither error nor refetch (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused reload after a write keeps both lists and calls them the last read', () => {
    const read = staleRead(hierarchyRows);
    registry.byUrl = { [HIERARCHY]: read };
    wrapped(<HierarchyPage />);
    // createMutation and deleteMutation both end in reload() on HIERARCHY_QUERY, so this is the
    // page's own state right after the operator pressed Add Relationship.
    expect(screen.getByText('acme-west')).toBeTruthy();
    expect(screen.getByText('subsidiary')).toBeTruthy();
    expect(screen.getByText('northwind-hq')).toBeTruthy();
    expect(screen.getByText('Child Organizations')).toBeTruthy();
    expect(screen.getByText('Parent Organizations')).toBeTruthy();
    expect(alerts()).toContain('the relationships below are the last read');
    expect(alerts()).toContain('A link you just added or removed is not reflected here');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load the organization hierarchy/)).toEqual([]);
    expect(screen.queryByText('No hierarchy relationships')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the kept child can still be removed while the read is a last read', async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }));
    registry.byUrl = { [HIERARCHY]: staleRead(hierarchyRows) };
    wrapped(<HierarchyPage />);
    // The row control is an icon-only button, so it is found through the row it belongs to — and
    // removing a link the last read still shows is exactly what a stale panel must not refuse.
    const row = screen.getByText('acme-west').closest('.admin-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    await waitFor(() => expect(calls.length).toBe(1), { interval: 10 });
    const [url, init] = calls[0] as [string, { method: string }];
    expect(url).toContain('/api/tenant/hierarchy?id=h-1');
    expect(init.method).toBe('DELETE');
    expect(alerts()).toContain('the relationships below are the last read');
  });

  it('a read that never answered is an outage, and "No hierarchy relationships" is unreachable', () => {
    registry.byUrl = { [HIERARCHY]: failed('Request failed (500)') };
    wrapped(<HierarchyPage />);
    expect(screen.queryByText('acme-west')).toBeNull();
    expect(claimsOutsideAlerts(/No hierarchy relationships/)).toEqual([]);
    expect(alerts()).toContain('Failed to load the organization hierarchy: Request failed (500)');
    expect(alerts()).not.toContain('last read');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[HIERARCHY].refetch).toHaveBeenCalledTimes(1);
  });

  it('the create form persists nothing the read held, so an outage does not lock it', () => {
    // The modal is built from RELATIONSHIP_TYPES and AVAILABLE_PERMISSIONS — module constants —
    // and a free-text tenant id. Dashing or disabling those over a read that never answered would
    // be a new lie, and it would leave the operator unable to make the first link at all.
    registry.byUrl = { [HIERARCHY]: failed('Request failed (500)') };
    wrapped(<HierarchyPage />);
    const add = screen.getByRole('button', { name: /add relationship/i });
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    const create = screen.getByRole('button', { name: /^Create$/ });
    expect(create.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('e.g. tenant_abc123'), { target: { value: 'acme-east' } });
    expect(screen.getByRole('button', { name: /^Create$/ }).hasAttribute('disabled')).toBe(false);
  });

  it('says the tenant has none when the read answered "there are none", with no alert', () => {
    registry.byUrl = { [HIERARCHY]: ok(noHierarchy) };
    wrapped(<HierarchyPage />);
    expect(screen.getByText('No hierarchy relationships')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('the create that was refused: an empty last read still says none, and says that is all it saw', () => {
    // The exact routine state on this page: the list read empty, the operator added a link,
    // reload() was refused, and TanStack returned the empty payload. The absence sentence is now
    // honest about what it is — the last read — instead of being a permanent all-clear.
    registry.byUrl = { [HIERARCHY]: staleRead(noHierarchy) };
    wrapped(<HierarchyPage />);
    expect(screen.getByText('No hierarchy relationships')).toBeTruthy();
    expect(alerts()).toContain('the relationships below are the last read');
    expect(alerts()).toContain('A link you just added or removed is not reflected here');
    expect(claimsOutsideAlerts(/Failed to load the organization hierarchy/)).toEqual([]);
  });

  it('walks the walk: a good read, a refused reload, and a good read again', () => {
    registry.byUrl = { [HIERARCHY]: ok(noHierarchy) };
    const view = wrapped(<HierarchyPage />);
    expect(screen.getByText('No hierarchy relationships')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [HIERARCHY]: staleRead(noHierarchy) };
    view.rerender(tree(<HierarchyPage />));
    expect(screen.getByText('No hierarchy relationships')).toBeTruthy();
    expect(alerts()).toContain('the relationships below are the last read');

    registry.byUrl = { [HIERARCHY]: ok(hierarchyRows) };
    view.rerender(tree(<HierarchyPage />));
    expect(screen.getByText('acme-west')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [HIERARCHY]: { data: undefined, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn() } };
    wrapped(<HierarchyPage />);
    expect(alerts()).toContain('Failed to load the organization hierarchy: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [HIERARCHY]: ok(hierarchyRows) };
    wrapped(<HierarchyPage />);
    expect(screen.getByText('acme-west')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const HIER = 'app/tenant/settings/hierarchy/page.tsx';
  const srcOf = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the one read apart instead of ignoring its error', () => {
    const hier = srcOf(HIER);
    expect(hier, 'the hierarchy read still refuses to look at its own error')
      .toMatch(/const \{ data, isLoading: loading, error, refetch \} = useApiQuery/);
    expect(hier).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(hier).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(hier).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(hier, 'the outage card still stands where the absence sentence is decided').toMatch(/\) : failed \? \(/);
    expect(hier, 'kept rows carry no saying-they-are-the-last-read banner').toMatch(/\{stale && \(/);
    expect(hier, 'a kept read still routes the failure through the bare flag')
      .not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
  });

  it('dashes nothing, because the page has no figure a read can make unread', () => {
    // The lists are `data?.data?.children ?? []` and the modal grid is AVAILABLE_PERMISSIONS, so
    // `failed ? '—'` would invent a total the panel never had. The honest pin is the absence.
    const hier = srcOf(HIER);
    expect(hier, 'hierarchy dashes something on a flag').not.toMatch(/\? '—'/);
    expect(hier, 'hierarchy punishes a kept read with a dash').not.toMatch(/\w*[Ee]rror \? '—'/);
    expect(hier, 'hierarchy grew an interpolated tally; review the dash rule').not.toMatch(/\{\w+\.length\}/);
  });

  it('keeps the read failure out of the fading channel and the write feedback in it', () => {
    const hier = srcOf(HIER);
    expect(hier, 'the read failure still toasts from the render body').not.toMatch(/^\s*if \(error\) toast\.error/m);
    expect(hier, 'the read failure moved into an effect instead').not.toMatch(/useEffect\(\(\) => \{ if \(error\) toast\.error/);
    expect(hier, 'an action still owes the operator transient feedback').toMatch(/onError: \(e: Error\) => toast\.error/);
    expect(hier).toMatch(/toast\.success\('Relationship created'\)/);
    expect(hier).toMatch(/toast\.success\('Relationship removed'\)/);
  });

  it('names the trigger the split\'s WHY comment claims', () => {
    // Both writes end in reload(), which invalidates the read's exact key — that is what makes
    // kept-rows-plus-refusal the routine state here rather than an edge case.
    const hier = srcOf(HIER);
    expect(hier).toMatch(/const HIERARCHY_QUERY = \['tenant', 'hierarchy'\] as const/);
    expect(hier).toMatch(/queryKey: HIERARCHY_QUERY/);
    expect(hier.match(/reload\(\);/g), 'a write stopped reloading; the stale state needs re-justifying').toHaveLength(2);
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [RegExp, string][] = [
      [/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/, '\n'],
      [/\) : failed \? \(/, ') : error ? ('],
      [/const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);\n/, ''],
    ];
    const src = srcOf(HIER);
    expect(inspect(HIER, src).offends, `${HIER} was already on the guard's list`).toBe(false);
    for (const [pattern, replacement] of rewinds) {
      expect(src, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(
        inspect(HIER, src.replace(pattern, replacement)).offends,
        `${HIER} would be visible to the guard once the split is taken back out: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866 each had to
    // undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    expect(files, `${HIER} should never have been baselined`).not.toContain(HIER);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = srcOf(HIER).split('\n').length - 1;
    expect(lines, `${HIER} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the never-answered half to the suites that already pin it, and rbac to #2928', () => {
    // Overlap hygiene: those files assert the outage. If they started asserting the stale copy too,
    // this slice would be double-claiming their ground.
    for (const t of [
      'tests/unit/rbac-tab-error-state-2597.test.tsx',
      'tests/unit/panel-fetch-error-not-empty-2823.test.tsx',
      'tests/unit/panel-page-error-not-empty-tenant-settings-2829.test.tsx',
    ]) {
      expect(srcOf(t), `${t} now speaks about a last read`).not.toMatch(/last read/);
    }
    // rbac landed on main in #2928 with its own three-read split and its own suite; this slice must
    // not have re-cut it, and must not mount it — two suites over one page is how copy diverges.
    expect(srcOf('app/tenant/settings/rbac/page.tsx')).toMatch(/const arStale = Boolean\(arError\) && Boolean\(arData\);/);
    expect(srcOf('tests/unit/panel-page-error-not-empty-settings-rbac-stale-2872.test.tsx'),
      'rbac owns its own suite; this one must not reach into it')
      .not.toMatch(/hierarchy/);
  });
});
