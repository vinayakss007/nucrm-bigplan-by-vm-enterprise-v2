// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/rbac/page.tsx`, the Access Control panel: three reads,
 * one per tab (`/api/tenant/rbac/field-permissions`, `/…/record-permissions`,
 * `/…/approval-rules`), each judged by its own bare error flag.
 *
 * TanStack Query keeps `data` when a revalidation of a read that already succeeded
 * fails, so `list.length > 0 ? list : error ? outage : empty` answered two different
 * questions with one branch. With rows in hand the tab fell into the FIRST arm and
 * never mentioned the refusal — the operator reads a permission matrix that is the
 * last successful answer and is told nothing. And a last read that legitimately held
 * nothing fell into the outage arm, claiming "Failed to load …" over an empty list
 * that the server really did return. #2597 (and `rbac-tab-error-state-2597.test.tsx`)
 * fixed the never-answered half, which this suite keeps: the outage sentence, its
 * status code and the "none vs unreadable" contrast are exactly right when there is
 * nothing to keep.
 *
 * The page also gated all three reads behind one `fpLoading || rpLoading || arLoading`
 * `if (loading) return <div>Loading RBAC settings…</div>`, so two reads that had
 * answered were blanked — lists and tab navigation both — because the third had not,
 * and a read that hangs forever is a page that never says anything. Each tab now waits
 * on its own read, which the last group below pins.
 *
 * There is no write control on this page to gate (it renders no form and calls no
 * mutation — the matrix is written per grant by `/api/tenant/permissions/fields`, not
 * here), so the audit here is that no failed or stale read invents one.
 *
 * Fixtures are documentation-only (`corp.test`, RFC 2606).
 * `scripts/check-panel-error-state.mjs` reports this file clean both before and after
 * the splits are rewound, which is the point of the anti-vacuity case: the sweep asks
 * whether a panel binds an error and renders a banner, and all three tabs already did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. Three keys, three reads. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import RBACSettingsPage from '@/app/tenant/settings/rbac/page';

const FP = '/api/tenant/rbac/field-permissions';
const RP = '/api/tenant/rbac/record-permissions';
const AR = '/api/tenant/rbac/approval-rules';

const fpRow = {
  id: 'fp-1', roleId: 'role-secops', roleName: 'Sec Ops',
  entityType: 'deal', fieldName: 'amount', access: 'write',
};
const rpRow = {
  id: 'rp-1', roleId: 'role-secops', roleName: 'Sec Ops',
  entityType: 'deal', accessLevel: 'team',
};
const arRow = {
  id: 'ar-1', name: 'Deals above the floor', entityType: 'deal',
  conditions: { amount: { gt: 50000 } }, approvers: ['approver@corp.test'], isActive: true,
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** Answered, then refused: `data` is what the page is still holding. */
const staleRead = (data: unknown, message = 'Request failed (503)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Never answered — nothing to keep. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** A refusal with no message: the old banner printed "undefined" as the explanation. */
const silentFailure = (withData?: unknown): QueryResult => ({
  data: withData, error: Object.assign(new Error(), { status: 504 }), isLoading: false, refetch: vi.fn(),
});

const rowsFor = (url: string) => ({ data: url === FP ? [fpRow] : url === RP ? [rpRow] : [arRow] });
/** All three reads healthy, unless a case says otherwise. */
const healthyReads = () => ({ [FP]: ok(rowsFor(FP)), [RP]: ok(rowsFor(RP)), [AR]: ok(rowsFor(AR)) });

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const tabLabels = ['Field Permissions', 'Record Permissions', 'Approval Rules'];
const openTab = (label: string) => {
  if (label !== tabLabels[0]) fireEvent.click(screen.getByRole('button', { name: label }));
};
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );
};
const rowCell = (url: string) => (url === FP ? 'amount' : url === RP ? 'team' : 'Deals above the floor');
const emptyCopy = {
  [FP]: /No field permissions configured yet/,
  [RP]: /No record permissions configured yet/,
  [AR]: /No approval rules configured yet/,
};
const outageCopy = {
  [FP]: /Failed to load field permissions/,
  [RP]: /Failed to load record permissions/,
  [AR]: /Failed to load approval rules/,
};

/** Every button on screen must be a tab or a retry — this page writes nothing. */
const noWriteControls = () => {
  const extras = screen
    .getAllByRole('button')
    .map((b) => (b.textContent ?? '').trim())
    .filter((t) => !tabLabels.includes(t) && !/^Try again$/.test(t));
  expect(extras, `the page grew a write control: ${extras.join(', ')}`).toEqual([]);
};

const CASES: { url: string; tab: string }[] = [
  { url: FP, tab: 'Field Permissions' },
  { url: RP, tab: 'Record Permissions' },
  { url: AR, tab: 'Approval Rules' },
];

describe.each(CASES)('rbac: %s — the read that never answered (#2597, kept)', ({ url, tab }) => {
  beforeEach(() => { registry.byUrl = { ...healthyReads(), [url]: failed() }; });
  afterEach(() => cleanup());

  it('names the failed read instead of claiming the workspace has none', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(alerts()).toMatch(outageCopy[url]);
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(emptyCopy[url])).toBeNull();
    expect(screen.queryByText(rowCell(url))).toBeNull();
  });

  it('offers to re-run THIS read and nothing else', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[url].refetch).toHaveBeenCalledTimes(1);
    for (const other of CASES) {
      if (other.url !== url) expect(registry.byUrl[other.url].refetch).not.toHaveBeenCalled();
    }
  });

  it('says "no response from the server" when the refusal carries no message', () => {
    registry.byUrl = { ...healthyReads(), [url]: silentFailure() };
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('presents no figure and no write control over a read it does not have', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(screen.queryByText(/Approvers:/)).toBeNull();
    noWriteControls();
  });
});

describe.each(CASES)('rbac: %s — a refused refresh over rows it kept (#2872)', ({ url, tab }) => {
  beforeEach(() => { registry.byUrl = { ...healthyReads(), [url]: staleRead(rowsFor(url)) }; });
  afterEach(() => cleanup());

  it('keeps the rows and says out loud that they are the last read', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(screen.getByText(rowCell(url))).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Could not refresh/);
  });

  it('does not claim an outage it did not have, and does not claim an empty list', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(alerts()).not.toMatch(outageCopy[url]);
    expect(screen.queryByText(emptyCopy[url])).toBeNull();
  });

  it('names this tab and only this tab', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(alerts().split(' | ')).toHaveLength(1);
  });

  it('still offers THIS read as the retry', () => {
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[url].refetch).toHaveBeenCalledTimes(1);
  });

  it('says "no response from the server" when the refused refresh carries no message', () => {
    registry.byUrl = { ...healthyReads(), [url]: silentFailure(rowsFor(url)) };
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
    expect(screen.getByText(rowCell(url))).toBeTruthy();
  });

  it('keeps the rows the refusal did not take away, not just the count of them', () => {
    // The shape the merged `calls`/`usage` slices fixed: kept rows plus a refusal must
    // never be read as an outage, and an emptied view of kept rows is a question about
    // rows the page HAS, not a failure.
    registry.byUrl = { ...healthyReads(), [url]: staleRead({ data: [] }) };
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(screen.getByText(emptyCopy[url])).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(outageCopy[url]);
  });
});

describe.each(CASES)('rbac: %s — the reads that answered (#2829 side, must stay quiet)', ({ url, tab }) => {
  afterEach(() => cleanup());

  it('shows the rows with no banner at all on a healthy read', () => {
    registry.byUrl = healthyReads();
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(screen.getByText(rowCell(url))).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(emptyCopy[url])).toBeNull();
  });

  it('shows the honest empty sentence, with no alert, on a successful empty read', () => {
    registry.byUrl = { ...healthyReads(), [url]: ok({ data: [] }) };
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    expect(screen.getByText(emptyCopy[url])).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('keeps the per-row figure the list is holding', () => {
    registry.byUrl = { ...healthyReads(), [url]: ok({ data: url === AR ? [arRow] : rowsFor(url).data }) };
    wrapped(<RBACSettingsPage />);
    openTab(tab);
    if (url === AR) expect(screen.getByText(/Approvers: 1/)).toBeTruthy();
    else expect(screen.getByText(rowCell(url))).toBeTruthy();
  });
});

describe('rbac: the three reads stay independent of each other (#2872)', () => {
  afterEach(() => cleanup());

  it('a refused field-permissions refresh leaves the record-permissions tab healthy', () => {
    registry.byUrl = { ...healthyReads(), [FP]: staleRead(rowsFor(FP)) };
    wrapped(<RBACSettingsPage />);
    expect(alerts()).toMatch(/field-level grants/i);
    fireEvent.click(screen.getByRole('button', { name: 'Record Permissions' }));
    expect(alerts()).toBe('');
    expect(screen.getByText('team')).toBeTruthy();
    expect(screen.queryByText(emptyCopy[RP])).toBeNull();
  });

  it('a refused record-permissions refresh leaves the approval-rules tab healthy', () => {
    registry.byUrl = { ...healthyReads(), [RP]: staleRead(rowsFor(RP)) };
    wrapped(<RBACSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Record Permissions' }));
    expect(alerts()).toMatch(/record access rules/i);
    fireEvent.click(screen.getByRole('button', { name: 'Approval Rules' }));
    expect(alerts()).toBe('');
    expect(screen.getByText(/Approvers: 1/)).toBeTruthy();
  });

  it('one outage does not make the tab that answered look broken, on either visit', () => {
    registry.byUrl = {
      [FP]: failed('Request failed (403)'),
      [RP]: ok(rowsFor(RP)),
      [AR]: staleRead(rowsFor(AR)),
    };
    wrapped(<RBACSettingsPage />);
    expect(alerts()).toMatch(/Failed to load field permissions: Request failed \(403\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Record Permissions' }));
    expect(alerts()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Approval Rules' }));
    expect(alerts()).toMatch(/approval rules below are the last read/i);
    expect(alerts()).not.toMatch(/Failed to load approval rules/);
    fireEvent.click(screen.getByRole('button', { name: 'Field Permissions' }));
    expect(alerts()).toMatch(/Failed to load field permissions/);
  });

  it('a read still loading does not blank the tabs that already answered', () => {
    // Base shape: `if (fpLoading || rpLoading || arLoading) return <div>Loading RBAC
    // settings...</div>` — no nav, no rows, no alert, no retry, for two reads that had
    // told the truth.
    registry.byUrl = {
      [FP]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [RP]: ok(rowsFor(RP)),
      [AR]: ok(rowsFor(AR)),
    };
    wrapped(<RBACSettingsPage />);
    expect(screen.getByRole('button', { name: 'Record Permissions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approval Rules' })).toBeTruthy();
    expect(screen.queryByText(/Loading RBAC settings/)).toBeNull();
    expect(screen.getByText(/Loading field permissions/)).toBeTruthy();
    expect(alerts()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Record Permissions' }));
    expect(screen.getByText('team')).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/rbac/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits all three reads instead of branching on one flag each', () => {
    const s = src();
    for (const name of ['fp', 'rp', 'ar']) {
      expect(s, `${name} never learned the difference`).toMatch(new RegExp(`Boolean\\(${name}Error\\) && !${name}Data`));
      expect(s).toMatch(new RegExp(`Boolean\\(${name}Error\\) && Boolean\\(${name}Data\\)`));
      expect(s).toMatch(new RegExp(`${name}Error\\?\\.message \\|\\| 'no response from the server'`));
      expect(s, `${name} has no banner for a kept read`).toMatch(new RegExp(`\\{${name}Stale && \\(`));
    }
  });

  it('no arm keys off the bare flag, and no empty sentence sits under a failure', () => {
    const s = src();
    expect(s, 'a tab still treats any error as an outage').not.toMatch(/\)\s*:\s*(?:fp|rp|ar)Error \? \(/);
    expect(s, 'the kept rows were still being replaced').not.toMatch(/^\s*\{(?:fp|rp|ar)Error \?/m);
    for (const [flag, sentence] of [['fp', 'No field permissions configured yet'], ['rp', 'No record permissions configured yet'], ['ar', 'No approval rules configured yet']]) {
      const failedAt = s.indexOf(`${flag}Failed ? (`);
      const emptyAt = s.indexOf(sentence);
      expect(failedAt, `${flag}Failed never gates anything`).toBeGreaterThan(-1);
      expect(failedAt, `the ${flag} empty sentence precedes its outage arm`).toBeLessThan(emptyAt);
    }
  });

  it('gates each tab on its own read, not on the union of three', () => {
    const s = src();
    // The two halves of the base shape, in the spellings only CODE uses — the page's
    // own #2872 comment describes the old gate in prose, and a ratchet that matched
    // prose would be red against a fixed file.
    expect(s, 'one slow read still blanks the whole page').not.toMatch(/const loading\s*=\s*\(?\s*fpLoading/);
    expect(s, 'the page still returns everything on the union of three loads').not.toMatch(/^\s*if \(loading\)\s*return/m);
    expect(s).not.toMatch(/if \(loading\) \{/);
    for (const name of ['fp', 'rp', 'ar']) {
      expect(s, `${name} does not wait on itself`).toMatch(new RegExp(`\\{${name}Loading \\? \\(`));
    }
  });

  it('keeps the operator-facing copy free of server internals, and the page read-only', () => {
    const s = src();
    const banners = s.split('\n').filter((line) => /Could not refresh/.test(line));
    expect(banners, 'no last-read banner in the source').toHaveLength(3);
    for (const line of banners) {
      expect(line, 'the banner said "out of date"').not.toMatch(/out of date/i);
      expect(line).not.toMatch(/\bendpoint\b|\broute\b|\b500\b|\bstatus\b/i);
    }
    expect(s, 'this page started writing the matrix from a read it may not have').not.toMatch(/\bapiFetch\b|method:\s*['"](?:POST|PUT|PATCH|DELETE)|useMutation/);
  });

  it('reports the page clean before and after the splits are taken back out', async () => {
    const { inspect } = await import('file://' + join(process.cwd(), 'scripts/check-panel-error-state.mjs'));
    const rewinds: [RegExp, string][] = [
      [/const fpFailed = Boolean\(fpError\) && !fpData;\s*\n\s*const fpStale = Boolean\(fpError\) && Boolean\(fpData\);/,
       'const fpFailed = Boolean(fpError);'],
      [/\{fpStale && \(/, '{fpError && ('],
      [/\) : fpFailed \? \(/, ') : fpError ? ('],
      [/\) : arFailed \? \(/, ') : arError ? ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      const s = src();
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'rbac went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length - 1, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
