// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two `app/tenant/settings/*` roster panels that already had a failure channel.
 *
 * `panel-page-error-not-empty-tenant-settings-2829` gave `lead-scoring` and `tags-manager` a
 * banner: bind the query error, render `InlineErrorState`, stop answering a refused read with
 * "No scoring rules defined yet." / "No tags yet." That half is correct and stays, verbatim — the
 * outage copy below is the copy #2829 already pins. This slice is the other half #2829 never
 * asked about: the read that *did* answer, and then failed to answer again.
 *
 * TanStack Query keeps `data` when a refetch of an already-succeeded query fails, and both pages
 * write with `invalidateQueries` on the very key they read:
 *
 *   - lead-scoring: save / delete / install-starters each call `load()` →
 *     `invalidateQueries({ queryKey: ['tenant', 'admin', 'lead-scoring'] })` (the only query under
 *     that key), and the Refresh button `refetch()`es it too.
 *   - tags-manager: rename / merge / delete each call `reload()` →
 *     `invalidateQueries({ queryKey: ['tenant', 'admin', 'tags'] })`, plus the Refresh button.
 *
 * So the ordinary state right after pausing / creating / renaming something is "kept rows + error
 * flag set" — and both pages branched on the flag alone, which read as an outage over rows that
 * were still on the screen. `failed = Boolean(err) && !data` keeps the outage; `stale =
 * Boolean(err) && data` keeps the rows and says they are the last read.
 *
 * Neither page prints an aggregate derived count: lead-scoring's only read-derived value is the
 * `rules.length` that gates the absence sentence and the Recompute button, and tags-manager's
 * totals are per-row and come from the kept rows themselves — both already key off `failed` after
 * the split. tags-manager's filter is client-side (the URL carries no query string), so a
 * filtered miss is a real search miss, never a last read of a view that never answered.
 *
 * RED AT BASE. With both product files at their `origin/main` state and this file as committed,
 * the stale/caveat cases and the ratchet cases fail; the outage / empty / row controls are #2829
 * regression pins that pass at base and must keep passing.
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
  isFetching?: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import LeadScoringPage from '@/app/tenant/settings/lead-scoring/page';
import TagsManagerPage from '@/app/tenant/settings/tags-manager/page';

const LEAD_SCORING = '/api/tenant/admin/lead-scoring';
const TAGS = '/api/tenant/admin/tags';
const ME = '/api/tenant/me';

const RULE = { id: 'r1', factor: 'email_verified', weight: 10, condition: null, sortOrder: 1, active: true };
const RULES = { rules: [RULE] };
const VIP_TAG = { tag: 'vip', leads: 2, contacts: 1, companies: 0, total: 3 };
const TAGS_ROW = { tags: [VIP_TAG] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
afterEach(cleanup);

describe('lead-scoring: a refused revalidation keeps the rules (#2872)', () => {
  const OUTAGE = /Failed to load lead scoring rules/;
  const CAVEAT = /the rules below are the last read/;

  it('shows kept rows + a last-read caveat, not an outage', () => {
    registry.byUrl = { [LEAD_SCORING]: staleRead(RULES) };
    wrapped(<LeadScoringPage />);
    expect(screen.getByText('email_verified')).toBeTruthy();
    expect(alerts()).toContain('the rules below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage copy would be a lie: the rules are on the screen.
    expect(screen.queryByText(OUTAGE)).toBeNull();
    expect(document.body.textContent).not.toContain('No scoring rules defined yet');
  });

  it('the caveat retries that read and not the sibling /api/tenant/me', () => {
    const sibling = ok({ is_admin: true });
    const result = staleRead(RULES);
    registry.byUrl = { [LEAD_SCORING]: result, [ME]: sibling };
    wrapped(<LeadScoringPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(sibling.refetch).not.toHaveBeenCalled();
  });

  it('an unread rule set is an outage that names the reason and hides the sentence', () => {
    registry.byUrl = { [LEAD_SCORING]: failedRead('Request failed (500) — RLS refused the read') };
    wrapped(<LeadScoringPage />);
    expect(alerts()).toContain('Failed to load lead scoring rules');
    expect(alerts()).toContain('Request failed (500)');
    expect(document.body.textContent).not.toContain('No scoring rules defined yet');
    expect(screen.queryByText(CAVEAT)).toBeNull();
  });

  it('a genuine empty answer says none with no alert', () => {
    registry.byUrl = { [LEAD_SCORING]: ok({ rules: [] }) };
    wrapped(<LeadScoringPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No scoring rules defined yet');
  });

  it('stale over an empty answer still says none plus the caveat', () => {
    registry.byUrl = { [LEAD_SCORING]: staleRead({ rules: [] }) };
    wrapped(<LeadScoringPage />);
    expect(document.body.textContent).toContain('No scoring rules defined yet');
    expect(alerts()).toContain('the rules below are the last read');
  });

  it('a good read shows the rule with no alert', () => {
    registry.byUrl = { [LEAD_SCORING]: ok(RULES) };
    wrapped(<LeadScoringPage />);
    expect(screen.getByText('email_verified')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal with no message falls back to no response from the server', () => {
    registry.byUrl = { [LEAD_SCORING]: failedRead('') };
    wrapped(<LeadScoringPage />);
    expect(alerts()).toContain('no response from the server');
  });

  it('does not dash a count it never held: no unread total above kept rows (#2872)', () => {
    // lead-scoring prints no aggregate figure; the value a bare-flag branch used to get wrong is
    // the rules.length that both hides the absence sentence and gates Recompute. After the split
    // the count follows the kept rows, and neither state invents a "none" figure.
    registry.byUrl = { [LEAD_SCORING]: staleRead(RULES) };
    const { rerender } = wrapped(<LeadScoringPage />);
    expect(document.body.textContent).not.toContain('No scoring rules defined yet');
    registry.byUrl = { [LEAD_SCORING]: failedRead('Request failed (500)') };
    rerender(tree(<LeadScoringPage />));
    expect(alerts()).toContain('Failed to load lead scoring rules');
  });

  it('a kept row stays actionable under the caveat', async () => {
    const fetchStub = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchStub);
    registry.byUrl = { [LEAD_SCORING]: staleRead(RULES) };
    wrapped(<LeadScoringPage />);
    const removeButton = screen.getByTitle('Delete rule') as HTMLButtonElement;
    expect(removeButton.disabled).toBe(false);
    fireEvent.click(removeButton);
    await waitFor(() => expect(fetchStub).toHaveBeenCalled(), { interval: 10 });
    vi.unstubAllGlobals();
  });
});

describe('tags-manager: a refused revalidation keeps the tags (#2872)', () => {
  const OUTAGE = /Failed to load tags/;
  const CAVEAT = /the tags below are the last read/;

  it('shows kept rows + a last-read caveat, not an outage', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead(TAGS_ROW) };
    wrapped(<TagsManagerPage />);
    expect(screen.getAllByText('vip').length).toBeGreaterThan(0);
    expect(alerts()).toContain('the tags below are the last read');
    expect(alerts()).toContain('A tag you just renamed, merged or deleted is not reflected here yet');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(OUTAGE)).toBeNull();
  });

  it('the caveat retries the tags read and not the /api/tenant/me sibling', () => {
    const sibling = ok({ is_admin: true });
    const result = staleRead(TAGS_ROW);
    registry.byUrl = { [ME]: sibling, [TAGS]: result };
    wrapped(<TagsManagerPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(sibling.refetch).not.toHaveBeenCalled();
  });

  it('an unread list is an outage that names the reason and hides the sentence', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: failedRead('Request failed (500) — RLS refused the read') };
    wrapped(<TagsManagerPage />);
    expect(alerts()).toContain('Failed to load tags');
    expect(alerts()).toContain('Request failed (500)');
    expect(document.body.textContent).not.toContain('No tags yet');
    expect(screen.queryByText(CAVEAT)).toBeNull();
  });

  it('a genuine empty answer says none with no alert', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: ok({ tags: [] }) };
    wrapped(<TagsManagerPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No tags yet');
  });

  it('stale over an empty answer still says none plus the caveat', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead({ tags: [] }) };
    wrapped(<TagsManagerPage />);
    expect(document.body.textContent).toContain('No tags yet');
    expect(alerts()).toContain('the tags below are the last read');
  });

  it('a good read shows the tag with no alert', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: ok(TAGS_ROW) };
    wrapped(<TagsManagerPage />);
    expect(screen.getAllByText('vip').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal with no message falls back to no response from the server', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead(TAGS_ROW, '') };
    wrapped(<TagsManagerPage />);
    expect(alerts()).toContain('no response from the server');
  });

  it('the client-side filter never invents an outage over a kept read', () => {
    // tags is the single read; `query` is a local filter that is not part of the key, so a
    // filtered miss on a kept (non-empty) read stays an honest "No tags match", plus the caveat.
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead(TAGS_ROW) };
    wrapped(<TagsManagerPage />);
    fireEvent.change(screen.getByPlaceholderText('Filter tags…'), { target: { value: 'zzz' } });
    expect(document.body.textContent).toContain('No tags match "zzz"');
    expect(alerts()).toContain('the tags below are the last read');
    expect(screen.queryByText(OUTAGE)).toBeNull();
  });

  it('per-row totals come from the kept rows and are not dashed (#2872)', () => {
    // tags-manager's only numbers are per-row (leads/contacts/companies/total). On a refused
    // revalidation they must render from the cached rows rather than fall back to a dash.
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead(TAGS_ROW) };
    wrapped(<TagsManagerPage />);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(alerts()).not.toContain('—');
  });

  it('a kept row stays actionable under the caveat', () => {
    registry.byUrl = { [ME]: ok({ is_admin: true }), [TAGS]: staleRead(TAGS_ROW) };
    wrapped(<TagsManagerPage />);
    fireEvent.click(screen.getAllByTitle('Rename')[0]);
    expect(screen.getByText(/Renames/)).toBeTruthy();
    expect(screen.getByDisplayValue('vip')).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/lead-scoring/page.tsx',
    'app/tenant/settings/tags-manager/page.tsx',
  ];

  it('splits the two states apart on both pages', () => {
    const byFile: Record<string, [RegExp, RegExp]> = {
      'app/tenant/settings/lead-scoring/page.tsx': [
        /const queryFailed = Boolean\(queryError\) && !data;/,
        /const queryStale = Boolean\(queryError\) && Boolean\(data\);/,
      ],
      'app/tenant/settings/tags-manager/page.tsx': [
        /const failed = Boolean\(error\) && !tagsData;/,
        /const stale = Boolean\(error\) && Boolean\(tagsData\);/,
      ],
    };
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const [failedRe, staleRe] = byFile[f];
      expect(src, `${f} never separates the outage from the stale read`).toMatch(failedRe);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(staleRe);
      expect(src, `${f} prints a raw error that can be undefined`)
        .toMatch(/\.message \|\| 'no response from the server'/);
      // A last-read caveat must exist, keyed off the stale branch.
      expect(src, `${f} has no last-read caveat`).toMatch(/last read/);
    }
  });

  it('leaves no absence sentence or figure keyed off the bare flag', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      // the empty row must hide only on the outage, not on any error
      expect(src, `${f} still hides its absence on the bare error`)
        .not.toMatch(/!error && (rules|filtered)\.length === 0/);
      // no derived figure may dash on the bare error
      expect(src, `${f} still dashes on the bare error`).not.toMatch(/\w*[Ee]rror \? '—'/);
    }
  });

  it('has no render-body toast carrying the page state', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts the read failure from the render body`)
        .not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still renders a bare-error banner`).not.toMatch(/\{error && \(/);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // Both pages bound `error` and rendered InlineErrorState before this slice, so #2829's guard
    // already reported them clean — and it stays clean whether we keep the split or rewind it to a
    // bare-flag branch. That is exactly why this file, not the guard, is the screen on this class.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f}: the fixed page offends the guard`).toBe(false);

      // Rewind the #2872 split: drop the stale const + block, and let the outage/emptiness tests
      // read off the bare flag again — the shape these pages had at origin/main.
      const rewound = src
        .replace(/const (queryFailed|failed) = [^\n]*\n/g, '')
        .replace(/const (queryStale|stale) = [^\n]*\n/g, '')
        .replace(/const (queryReason|reason) = [^\n]*\n/g, '')
        .replace(/\{\s*queryStale && \([\s\S]*?\)\s*\}\n/g, '')
        .replace(/\{\s*stale && \([\s\S]*?\)\s*\}\n/g, '')
        .replace(/queryFailed/g, 'error')
        .replace(/(!\s*)failed\b/g, '$1error');
      expect(rewound, `${f}: the split changed shape, update this check`).not.toBe(src);
      // the last-read caveat banner is gone; only the outage branch remains on the bare flag
      expect(rewound).not.toMatch(/Could not refresh/);
      expect(rewound).not.toMatch(/queryStale|const stale =/);
      expect(inspect(f, rewound).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling on purpose: an equality goes false every time another slice honestly fixes a panel.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is already visible to the guard`).not.toContain(f);
    }
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

describe('overlap hygiene with the #2829 suite (#2872)', () => {
  it('the settings 2829 suite never speaks about a kept read', () => {
    const src = readFileSync(
      join(process.cwd(), 'tests/unit/panel-page-error-not-empty-tenant-settings-2829.test.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/last read/);
  });
});
