// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `settings/roles` and `settings/pipelines`: the two toast-only settings panels.
 *
 * Neither page had a failure branch at all. Both read their rows with `useApiQuery`, bound
 * `error`, and spent it on
 *
 *     if (error) toast.error('Failed to load roles');      // in the RENDER BODY
 *
 * which is a four-second toast that re-fires on every re-render. What stayed on screen after it
 * faded was the list render answering for the request: `data?.data ?? []` mapped over nothing, so
 * a refused read looked exactly like a tenant with no roles — and on `pipelines` it also left the
 * right-hand column blank, because the stage editor is seeded off the same read. `check-panel-error-
 * state.mjs` never saw either page: its EMPTY_SENTENCE only recognises a written "No … yet|found|
 * configured|…" clause, and these pages printed no clause at all. Silence was the false all-clear.
 *
 * TanStack Query keeps `data` when a refetch of a read that already succeeded fails, and both pages
 * invalidate their own key from their own writes, so the kept-rows-plus-error state is not exotic:
 *   - `roles`: `load()` → `invalidateQueries({ queryKey: ROLES_QUERY })`, called by `deleteRole`'s
 *     onSuccess and by the editor's `onSave` — so right after deleting or saving a role;
 *   - `pipelines`: the same `load()` on PIPELINES_QUERY, called by all three write handlers
 *     (create, save, delete) — so right after pressing the button whose whole job is to change
 *     the list on screen. Its key is also a prefix of the board page's `['tenant','pipelines',
 *     'full']`, so a settings write revalidates that read too; the reverse never happens.
 *
 * Per page: `failed = Boolean(error) && !data` gets the outage card, `stale = Boolean(error) &&
 * Boolean(data)` keeps everything on screen under a "last read" caveat that names the create /
 * save / delete a refused refresh would not reflect, and the render-body toast is gone — the banner
 * is the channel. Mutation toasts stay; an action deserves transient feedback.
 *
 * No figure on either page is dashed, and that is deliberate. `roles` prints its permission counts
 * two ways: `g` per row, counted off `role.permissions` (the read — it disappears with the rows, so
 * an unread read prints nothing rather than `0`), and `PERMISSIONS.length`, which is a module
 * constant from `lib/permissions/definitions` that no read can make unread. Dashing the second
 * would be a new lie. Both are asserted below, along with the genuine `0 permissions` row and the
 * `probability: 0` stage, which a real `0` from an answering read must still print.
 *
 * RED AT BASE — measured on this branch's base with the two product files reverted
 * (`git checkout --` them, this file as committed): 15 of these 24 cases fail — the twelve that put
 * a page in the stale, outage or genuinely-empty state (five `roles`, five `pipelines`, both
 * cross-page cases) and three ratchets (the split binding, the toast ban, the blindness case whose
 * rewind regexes match nothing until the banners exist). The other 9 pass at base and must keep
 * passing, because they are the controls a careless fix breaks: a read that answers, the read-derived
 * figures (a real `0`, the static catalogue size), the row controls, the invalidation pin, the guard
 * + baseline + line-count cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

import { PERMISSIONS } from '@/lib/permissions/definitions';

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
// Both pages still toast — but only inside mutation handlers. Mocking it is how this suite proves
// the READ's failure is not one of those calls any more: no assertion below is satisfiable by a
// toast, and the stale/outage cases assert the load copy never reaches this channel at all.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import toast from 'react-hot-toast';
import RolesPermissionsPage from '@/app/tenant/settings/roles/page';
import PipelinesSettingsPage from '@/app/tenant/settings/pipelines/page';

const ROLES = '/api/tenant/roles';
const PIPELINES = '/api/tenant/pipelines';

const roleRows = {
  data: [
    { id: 'role-1', name: 'Account Manager', slug: 'account-manager', description: 'Works the book of business',
      permissions: { 'contacts.view_all': true, 'deals.edit': true, 'tasks.create': true } },
    // A real zero from a read that answered. It has to print `0`, not `—`, not nothing.
    { id: 'role-2', name: 'Readonly', slug: 'viewer', permissions: {} },
    // `{ all: true }` makes the row print the static catalogue size, not a count off the read.
    { id: 'role-3', name: 'Ada Operator', slug: 'admin', permissions: { all: true } },
  ],
};

const pipelineRows = {
  data: [
    { id: 'pl-1', name: 'Enterprise Book', is_default: true, stages: [
      { id: 'st-1', label: 'Lead', order: 0, probability: 10 },
      { id: 'st-2', label: 'Proposal', order: 1, probability: 60 },
      { id: 'st-3', label: 'Won', order: 2, probability: 100 },
      { id: 'st-4', label: 'Lost', order: 3, probability: 0 },
    ] },
    { id: 'pl-2', name: 'Renewals', stages: [
      { id: 'st-5', label: 'Notice', order: 0, probability: 25 },
      { id: 'st-6', label: 'Signed', order: 1, probability: 90 },
    ] },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alertsIn = (root: HTMLElement | typeof document = document) =>
  Array.from((root === document ? document : root).querySelectorAll('[role="alert"]'))
    .map((el) => el.textContent ?? '')
    .join(' | ');
const alerts = () => alertsIn(document);

/**
 * `{g} permission{s}` and `{granted}/{PERMISSIONS.length} permissions` are both JSX with the
 * number in its own text node, so `getByText` cannot see the sentence. `textContent` on the `<p>`
 * can — and this is the list the dash would show up in if a static figure were ever dashed.
 */
const permissionLines = () =>
  Array.from(document.querySelectorAll('p'))
    .map((p) => p.textContent ?? '')
    .filter((t) => /permissions\b/.test(t));

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('roles: a refused reload keeps the roles (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps every role, labels them the last read, and names what the refusal may not reflect', () => {
    const read = staleRead(roleRows);
    registry.byUrl = { [ROLES]: read };
    const view = wrapped(<RolesPermissionsPage />);
    expect(screen.getByText('Account Manager')).toBeTruthy();
    expect(screen.getByText('Works the book of business')).toBeTruthy();
    expect(alertsIn(view.container)).toContain('the roles below are the last read');
    expect(alerts()).toContain('A role you just created, saved or deleted may not be reflected here');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be the lie: the roles are on the screen.
    expect(screen.queryByText(/^Failed to load roles/)).toBeNull();
    // …and so would the absence sentence, which the page now prints only on a read that answered.
    expect(screen.queryByText('No roles yet')).toBeNull();
    // A page state may not be carried by a fading toast either.
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load roles');
    fireEvent.click(within(view.container).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('counts what it holds: the read-derived figure stays a number, the catalogue figure was never a read', () => {
    registry.byUrl = { [ROLES]: staleRead(roleRows) };
    wrapped(<RolesPermissionsPage />);
    const lines = permissionLines();
    expect(lines).toContain('3 permissions');
    expect(lines).toContain('0 permissions');
    expect(lines).toContain(`All ${PERMISSIONS.length} permissions`);
    expect(lines.join(' | ')).not.toContain('—');
  });

  it('a kept role is still editable while the read is a last read', () => {
    registry.byUrl = { [ROLES]: staleRead(roleRows) };
    const view = wrapped(<RolesPermissionsPage />);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit: Account Manager')).toBeTruthy();
    // The modal's own figure is `{granted}/{PERMISSIONS.length}` — the denominator is a module
    // constant, so a refused refresh may not touch it, and the numerator is the kept row's own
    // count, which a last read is still entitled to print.
    expect(permissionLines()).toContain(`3/${PERMISSIONS.length} permissions`);
    // The System role is read-only; the refusal may not have quietly made it editable.
    expect(within(view.container).getAllByRole('button', { name: 'View' })).toHaveLength(2);
  });

  it('a read that never answered is an outage, and prints no list and no absence sentence', () => {
    registry.byUrl = { [ROLES]: failed('Request failed (500)') };
    const view = wrapped(<RolesPermissionsPage />);
    expect(screen.queryByText('Account Manager')).toBeNull();
    expect(screen.queryByText('No roles yet')).toBeNull();
    expect(permissionLines()).toEqual([]);
    expect(alerts()).toContain('Failed to load roles: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load roles');
    fireEvent.click(within(view.container).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ROLES].refetch).toHaveBeenCalledTimes(1);
  });

  it('says the tenant has none when the read answered "there are none", with no alert', () => {
    registry.byUrl = { [ROLES]: ok({ data: [] }) };
    wrapped(<RolesPermissionsPage />);
    expect(screen.getByText('No roles yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a refused refresh over an empty answer still says none, and says it is the last read', () => {
    // `data` is `{ data: [] }`, so this is a stale read of a genuinely empty list — the one case
    // where the absence sentence is honest and the caveat is still owed to the operator.
    registry.byUrl = { [ROLES]: staleRead({ data: [] }) };
    wrapped(<RolesPermissionsPage />);
    expect(screen.getByText('No roles yet')).toBeTruthy();
    expect(alerts()).toContain('the roles below are the last read');
    expect(alerts()).not.toContain('Failed to load roles');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [ROLES]: ok(roleRows) };
    wrapped(<RolesPermissionsPage />);
    expect(screen.getByText('Account Manager')).toBeTruthy();
    expect(screen.getByText('Readonly')).toBeTruthy();
    expect(permissionLines()).toContain('3 permissions');
    expect(alerts()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a refusal with no message falls back to a sentence, not the word undefined', () => {
    registry.byUrl = { [ROLES]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    wrapped(<RolesPermissionsPage />);
    expect(alerts()).toContain('Failed to load roles: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('pipelines: a refused reload keeps the pipelines and the stages (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the list and the stage editor, and calls them the last read', () => {
    const read = staleRead(pipelineRows);
    registry.byUrl = { [PIPELINES]: read };
    const view = wrapped(<PipelinesSettingsPage />);
    expect(within(view.container).getByText('Enterprise Book')).toBeTruthy();
    expect(within(view.container).getByText('Renewals')).toBeTruthy();
    expect(within(view.container).getByText('default')).toBeTruthy();
    // The right-hand column is seeded off the same read, so the caveat has to cover it too —
    // a stage rename that was saved and then refused looks identical to one that never landed.
    expect(within(view.container).getByDisplayValue('Enterprise Book')).toBeTruthy();
    expect(within(view.container).getByDisplayValue('Proposal')).toBeTruthy();
    expect(alertsIn(view.container)).toContain('the pipelines below are the last read');
    expect(alerts()).toContain('and so may the stages open on the right');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/^Failed to load pipelines/)).toBeNull();
    expect(screen.queryByText('No pipelines yet')).toBeNull();
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load pipelines');
    fireEvent.click(within(view.container).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('the kept stages are still actionable, and a real 0 probability is still 0', () => {
    registry.byUrl = { [PIPELINES]: staleRead(pipelineRows) };
    const view = wrapped(<PipelinesSettingsPage />);
    const editor = view.container.querySelector('.admin-card') as HTMLElement;
    expect(within(editor).getByDisplayValue('0')).toBeTruthy();
    const saveButton = within(editor).getByRole('button', { name: /save pipeline/i });
    expect(saveButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(editor).getByRole('button', { name: /add stage/i }));
    expect(within(editor).getByDisplayValue('New Stage')).toBeTruthy();
    // Opening the other kept row is a row control, not a re-read: a last read still lets the
    // operator work the pipelines it holds.
    fireEvent.click(within(view.container).getByRole('button', { name: 'Renewals' }));
    expect(within(editor).getByDisplayValue('Notice')).toBeTruthy();
  });

  it('a read that never answered is an outage, and shows neither an empty list nor a stage editor', () => {
    registry.byUrl = { [PIPELINES]: failed('Request failed (500)') };
    const view = wrapped(<PipelinesSettingsPage />);
    expect(screen.queryByText('Enterprise Book')).toBeNull();
    expect(screen.queryByText('No pipelines yet')).toBeNull();
    expect(within(view.container).queryByPlaceholderText('Pipeline name')).toBeNull();
    expect(alerts()).toContain('Failed to load pipelines: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load pipelines');
    fireEvent.click(within(view.container).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PIPELINES].refetch).toHaveBeenCalledTimes(1);
  });

  it('says the tenant has none when the read answered "there are none", with no alert', () => {
    registry.byUrl = { [PIPELINES]: ok({ data: [] }) };
    wrapped(<PipelinesSettingsPage />);
    expect(screen.getByText('No pipelines yet')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a refused refresh over an empty answer still says none, and says it is the last read', () => {
    registry.byUrl = { [PIPELINES]: staleRead({ data: [] }) };
    wrapped(<PipelinesSettingsPage />);
    expect(screen.getByText('No pipelines yet')).toBeTruthy();
    expect(alerts()).toContain('the pipelines below are the last read');
    expect(alerts()).not.toContain('Failed to load pipelines');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [PIPELINES]: ok(pipelineRows) };
    wrapped(<PipelinesSettingsPage />);
    expect(screen.getByText('Enterprise Book')).toBeTruthy();
    expect(within(document.body).getByDisplayValue('Proposal')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a refusal with no message falls back to a sentence, not the word undefined', () => {
    registry.byUrl = { [PIPELINES]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    wrapped(<PipelinesSettingsPage />);
    expect(alerts()).toContain('Failed to load pipelines: no response from the server');
    expect(alerts()).not.toContain('undefined');
  });
});

describe('the two panels stay in their own lane (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('one refused read is caveated and retried by itself, not by its neighbour', () => {
    const rolesRead = staleRead(roleRows);
    const pipelinesRead = staleRead(pipelineRows);
    registry.byUrl = { [ROLES]: rolesRead, [PIPELINES]: pipelinesRead };
    cleanup();
    const rolesView = render(tree(<RolesPermissionsPage />));
    const pipelinesView = render(tree(<PipelinesSettingsPage />));
    expect(alertsIn(rolesView.container)).toContain('the roles below are the last read');
    expect(alertsIn(pipelinesView.container)).toContain('the pipelines below are the last read');
    fireEvent.click(within(rolesView.container).getByRole('button', { name: /try again/i }));
    expect(rolesRead.refetch).toHaveBeenCalledTimes(1);
    expect(pipelinesRead.refetch).not.toHaveBeenCalled();
    fireEvent.click(within(pipelinesView.container).getByRole('button', { name: /try again/i }));
    expect(pipelinesRead.refetch).toHaveBeenCalledTimes(1);
    expect(rolesRead.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refusal on one read may not put the outage card over the other read\'s rows', () => {
    registry.byUrl = { [ROLES]: failed('Request failed (500)'), [PIPELINES]: ok(pipelineRows) };
    cleanup();
    const rolesView = render(tree(<RolesPermissionsPage />));
    const pipelinesView = render(tree(<PipelinesSettingsPage />));
    expect(alertsIn(rolesView.container)).toContain('Failed to load roles');
    expect(alertsIn(pipelinesView.container)).toBe('');
    expect(within(pipelinesView.container).getByText('Enterprise Book')).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/roles/page.tsx',
    'app/tenant/settings/pipelines/page.tsx',
  ];

  it('splits the two states apart on both pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(error\) && !data/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(error\) && Boolean\(data\)/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the read on the bare flag`).toMatch(/\bfailed \?/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*(?:\w*[Ee]rror|error) \? \(/);
    }
  });

  it('takes the load failure out of the toast channel', () => {
    // The rule is that a page STATE may not be carried by a fading toast. Mutation handlers keep
    // theirs — an action deserves transient feedback — so only the render-body form is banned.
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts its read failure from the render body`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} moved the read failure into an effect instead`).not.toMatch(/useEffect\(\(\) => \{ if \(error\) toast\.error/);
      expect(src, `${f} lost the write feedback the mutations owe the operator`).toMatch(/onError: \(\) => toast\.error|onError: \(e: Error\) => toast\.error/);
    }
  });

  it('names the invalidation that actually produces the refused revalidation', () => {
    // The WHY comments in both pages claim a specific trigger; this pins the claim, so the day a
    // write stops calling `load()` the suite cannot keep asserting a state nothing reaches.
    const roles = readFileSync(join(ROOT, 'app/tenant/settings/roles/page.tsx'), 'utf8');
    expect(roles).toMatch(/const ROLES_QUERY = \['tenant', 'roles'\] as const/);
    expect(roles).toMatch(/queryKey: ROLES_QUERY/);
    expect(roles).toMatch(/onSuccess: \(\) => \{ toast\.success\('Deleted'\); load\(\); \}/);
    expect(roles).toMatch(/onSave=\{\(\) => \{ load\(\); setShowEditor\(false\); \}\}/);

    const pipelines = readFileSync(join(ROOT, 'app/tenant/settings/pipelines/page.tsx'), 'utf8');
    expect(pipelines).toMatch(/const PIPELINES_QUERY = \['tenant', 'pipelines'\] as const/);
    expect(pipelines).toMatch(/queryKey: PIPELINES_QUERY/);
    expect(pipelines.match(/load\(\);/g)).toHaveLength(3);
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
    for (const f of FILES) {
      expect(files, `${f} has no business on the baseline`).not.toContain(f);
    }
  });

  it('is invisible to the guard, before and after the split is rewound', async () => {
    // Neither page printed an absence sentence at base, and neither does the guard's EMPTY_SENTENCE
    // recognise the layout they printed instead. So the screen calls both files clean whether the
    // split is in place or gone: this suite is the only thing standing between a rewind and CI.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} is already visible to the guard — this case is the wrong proof`).toBe(false);

      const withoutStale = src
        .replace(/\n\s*\{\w*[Ss]tale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const \w*[Ss]tale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`).toBe(false);

      const bare = src
        .replace(/\bfailed(?=\s*\?)/g, 'errorFlag')
        .replace(/const failed = [^\n]*\n/g, '');
      expect(bare, `${f}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(bare, `${f}: the rewind never reached a gate`).toMatch(/errorFlag/);
      expect(inspect(f, bare).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('leaves no #2829 or #2872 suite speaking about these two panels', () => {
    // Overlap hygiene: `app/tenant/pipelines/page.tsx` shares this suite's URL, and its own stale
    // copy lives in `panel-page-error-not-empty-last-slice-2829`. Nothing but this file may mount
    // the two settings panels, so no other suite can start asserting this slice's copy — or quietly
    // re-introducing the render-body toast these pages are fixed on.
    const testsDir = join(ROOT, 'tests');
    const grep = spawnSync('grep', ['-rl', 'settings/roles/page\|settings/pipelines/page', testsDir], { encoding: 'utf8' });
    const mounting = (grep.stdout ?? '')
      .split('\n')
      .filter((p) => p.trim() !== '')
      .map((p) => p.replace(`${ROOT}/`, '').split('/').pop())
      .filter((name) => name !== 'panel-page-error-not-empty-roles-pipelines-stale-2872.test.tsx')
      // `members-permission-map-2726` only names the file in prose about a different endpoint.
      .filter((name) => name !== 'members-permission-map-2726.test.ts');
    expect(mounting).toEqual([]);
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
