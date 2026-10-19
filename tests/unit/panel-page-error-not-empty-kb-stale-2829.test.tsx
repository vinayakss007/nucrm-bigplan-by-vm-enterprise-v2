// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2869 — the residual of #2863 on the two knowledge-base panels.
 *
 * #2863 fixed the sentence: neither page answers a refused read with "there are none"
 * any more, and `panel-page-error-not-empty-kb-2829` proves it. Four behaviours it left
 * on `main` (`7a9bffa5`) are this slice, each measured by reading the merged branch
 * structure rather than inferred from the diff:
 *
 *   - `kb/page.tsx:129` and `kb/categories/page.tsx:68` branched on `error` alone.
 *     TanStack keeps `data` when a refetch of a query that already answered fails, and
 *     BOTH pages invalidate their own queries after every mutation (`load()` after an
 *     article is created, `reload()` after a category is added, edited or deleted), so
 *     the ordinary post-save state replaced the rows on screen with an outage banner.
 *     That is especially sharp on `kb/categories`, where the operator has just deleted a
 *     category and is being told the list cannot be loaded, over the list they can see.
 *   - `kb/page.tsx:134` printed "No articles found" for a search or chip that matched
 *     nothing over a read that answered with articles. #2863 pinned that wording on
 *     purpose (`panel-page-error-not-empty-kb-2829.test.tsx:243`), so this slice moves
 *     that case rather than quietly widening around it.
 *   - `kb/page.tsx:105` told the operator "the articles below are shown unfiltered" while
 *     `activeCategory` — its own state, untouched by the read — kept narrowing them.
 *   - `CreateArticleModal` took a plain array, so opened under a failed category read it
 *     offered the single "Uncategorized" option, which is a filing decision made on the
 *     tenant's behalf by a request that never answered.
 *
 * The honest arms stay honest: `stale` is not `failed`. The rows and the chips remain
 * usable in it, and the banner says which of the two it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import KBPage from '@/app/tenant/kb/page';
import KBCategoriesPage from '@/app/tenant/kb/categories/page';

const ARTICLES = '/api/tenant/kb/articles?status=published';
const CATEGORIES = '/api/tenant/kb/categories';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state #2863 could not reach: the read answered before, this refresh did not. */
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

// ── fixtures ───────────────────────────────────────────────────────────────────
const NOW = '2026-10-01T00:00:00Z';

const articleRows = {
  data: [
    {
      id: 'kb-1', title: 'Reset a user password', excerpt: 'Two clicks from Settings.',
      categoryId: 'cat-1', categoryName: 'Onboarding', createdAt: NOW, views: 12, helpful: 0,
    },
    {
      id: 'kb-2', title: 'How invoicing tax works', excerpt: 'Per-tenant rates.',
      categoryId: 'cat-2', categoryName: 'Billing', createdAt: NOW, views: 40, helpful: 0,
    },
  ],
};

const categoryRows = {
  data: [
    { id: 'cat-1', name: 'Onboarding', description: 'Setup guides' },
    { id: 'cat-2', name: 'Billing', description: null },
  ],
};

describe('kb: a refresh that failed does not hide the articles on screen (#2869)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('keeps the rows and says "last read" when only the refresh failed', () => {
    registry.byUrl = {
      [ARTICLES]: staleRead(articleRows),
      [CATEGORIES]: ok(categoryRows),
    };
    wrapped(<KBPage />);
    expect(screen.getByText('Reset a user password')).toBeTruthy();
    expect(screen.getByText('How invoicing tax works')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    // The sentence #2863 killed must not come back wearing the refresh's clothes.
    expect(screen.queryAllByText(/No published articles/).length).toBe(0);
  });

  it('routes the retry under the rows to the articles read', () => {
    registry.byUrl = { [ARTICLES]: staleRead(articleRows), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ARTICLES].refetch).toHaveBeenCalled();
    expect(registry.byUrl[CATEGORIES].refetch).not.toHaveBeenCalled();
  });

  it('names the outage and shows no rows when the read never answered', () => {
    registry.byUrl = { [ARTICLES]: failed('Request failed (401)'), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    expect(alerts()).toMatch(/Failed to load the knowledge base/i);
    expect(alerts()).toMatch(/Request failed \(401\)/);
    expect(screen.queryAllByText('Reset a user password').length).toBe(0);
    expect(alerts()).not.toMatch(/last read/i);
  });

  it('re-runs the read from the outage banner', () => {
    registry.byUrl = { [ARTICLES]: failed(), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[ARTICLES].refetch).toHaveBeenCalled();
  });
});

describe('kb: a filtered miss is a miss, not an empty knowledge base (#2869)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const searchFor = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText(/Search articles/i), { target: { value } });

  it('says the search found nothing among articles it did read', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    searchFor('nothing matches this');
    expect(screen.getByText(/No published articles match this search or category/i)).toBeTruthy();
    // The count the read actually established, so the operator can see the filter is the
    // narrow thing and the knowledge base is not the empty one.
    expect(screen.getByText(/2 published articles/i)).toBeTruthy();
    expect(screen.queryAllByText(/No published articles yet/i).length).toBe(0);
    expect(alerts()).toBe('');
  });

  it('says the same when a category chip is what narrowed it to nothing', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    searchFor('password');
    expect(screen.getByText(/No published articles match this search or category/i)).toBeTruthy();
    expect(screen.queryAllByText(/No published articles yet/i).length).toBe(0);
    expect(alerts()).toBe('');
  });

  it('keeps the honest "none yet" for a knowledge base that really has no articles', () => {
    registry.byUrl = { [ARTICLES]: ok({ data: [] }), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    expect(screen.getByText(/No published articles yet/i)).toBeTruthy();
    expect(screen.queryAllByText(/No published articles match/i).length).toBe(0);
    expect(alerts()).toBe('');
  });

  it('reports the outage rather than a filtered miss when the list never answered', () => {
    registry.byUrl = { [ARTICLES]: failed(), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    searchFor('password');
    expect(alerts()).toMatch(/Failed to load the knowledge base/i);
    expect(screen.queryAllByText(/No published articles match/i).length).toBe(0);
  });
});

describe('kb: the category banner says what the page is actually doing (#2869)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('says "unfiltered" only when nothing is filtering', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed() };
    wrapped(<KBPage />);
    expect(alerts()).toMatch(/shown unfiltered/i);
  });

  it('says the list is still narrowed when the chip that set it has disappeared', () => {
    // The sequence the page actually allows: healthy chips, pick one, the category read
    // fails on the next refresh. `activeCategory` is its own state, so it survives the
    // chips vanishing and keeps filtering the rows — while the banner claims otherwise.
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    const { rerender } = wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByText('How invoicing tax works')).toBeTruthy();
    expect(screen.queryAllByText('Reset a user password').length).toBe(0);

    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed() };
    rerender(tree(<KBPage />));
    expect(alerts()).toMatch(/still narrowed to the category you picked/i);
    expect(alerts()).not.toMatch(/shown unfiltered/i);
    // Still filtering, which is the behaviour the old sentence misdescribed.
    expect(screen.getByText('How invoicing tax works')).toBeTruthy();
    expect(screen.queryAllByText('Reset a user password').length).toBe(0);
  });

  it('keeps the chips and says "last read" when only their refresh failed', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: staleRead(categoryRows) };
    wrapped(<KBPage />);
    expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Onboarding' })).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toMatch(/offers only Uncategorized/i);
  });
});

describe('kb: the create dialog cannot file an article on a failed read\'s behalf (#2869)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const openDialog = () => {
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /New Article/i }));
  };

  // The dialog's own copy of the failure: with the category read refused, the page under
  // the modal raises its banner too, so the two "Try again" buttons have to be told apart.
  const dialogBanner = () => {
    const found = screen.queryAllByRole('alert').filter((el) => /dropdown offers only/.test(el.textContent ?? ''));
    expect(found.length, 'the dialog says nothing about the unread category list').toBe(1);
    return found[0];
  };
  // Neither select is labelled by association (`<label>` has no `htmlFor`), so the picker
  // is the first combobox in the form and its options are what the read put there.
  const picker = () => screen.getAllByRole('combobox')[0];

  it('says the dropdown offers only Uncategorized, and names the read that failed', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed('Request failed (503)') };
    openDialog();
    expect(dialogBanner().textContent).toMatch(/Request failed \(503\)/);
    expect([...picker().querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Uncategorized']);
  });

  it('re-runs the category read from inside the dialog', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed() };
    openDialog();
    fireEvent.click(within(dialogBanner()).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CATEGORIES].refetch).toHaveBeenCalled();
    expect(registry.byUrl[ARTICLES].refetch).not.toHaveBeenCalled();
  });

  it('still lets the article be written and saved over the unread list', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed() };
    openDialog();
    fireEvent.change(screen.getByPlaceholderText('Article title'), { target: { value: 'A title' } });
    fireEvent.change(screen.getByPlaceholderText(/Write article content here/i), { target: { value: 'Body' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Article/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/tenant/kb/articles',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('offers the real categories, with no alert in the dialog, for a read that answered', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    openDialog();
    expect([...picker().querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['Uncategorized', 'Onboarding', 'Billing']);
    expect(screen.queryAllByRole('alert').length).toBe(0);
  });

  it('says nothing about a tenant that genuinely has no categories', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok({ data: [] }) };
    openDialog();
    expect([...picker().querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Uncategorized']);
    expect(screen.queryAllByRole('alert').length).toBe(0);
  });
});

describe('kb/categories: a failed refresh keeps the list the operator is deleting from (#2869)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('keeps the rows and says "last read"', () => {
    registry.byUrl = { [CATEGORIES]: staleRead(categoryRows) };
    wrapped(<KBCategoriesPage />);
    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(screen.getByText('Billing')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(screen.queryAllByText(/No categories yet/i).length).toBe(0);
  });

  it('names the outage and keeps "New Category" reachable when nothing was ever read', () => {
    registry.byUrl = { [CATEGORIES]: failed('Request failed (401)') };
    wrapped(<KBCategoriesPage />);
    expect(alerts()).toMatch(/Failed to load the categories/i);
    expect(alerts()).toMatch(/Request failed \(401\)/);
    expect(alerts()).not.toMatch(/last read/i);
    expect(screen.getByRole('button', { name: /New Category/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(registry.byUrl[CATEGORIES].refetch).toHaveBeenCalled();
  });

  it('keeps its honest sentence for a tenant with no categories', () => {
    registry.byUrl = { [CATEGORIES]: ok({ data: [] }) };
    wrapped(<KBCategoriesPage />);
    expect(screen.getByText(/No categories yet/i)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('#2869 decayed nothing it did not fix, and left no brittle count behind', () => {
  const ROOT = process.cwd();
  const doc = () => JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
    files: Record<string, string>;
  };

  it('the guard is green and the two kb pages still do not offend', () => {
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`OK — ${Object.keys(doc().files).length} panel\\(s\\)`));
    expect(doc().files['app/tenant/kb/page.tsx']).toBeUndefined();
    expect(doc().files['app/tenant/kb/categories/page.tsx']).toBeUndefined();
  });

  it('both pages carry the third state, because the guard only reads the file', () => {
    // `offends: false` was already true before this slice: #2863 renders a banner, and the
    // screen is a per-file question. What only a test can hold is that the banner is not
    // replacing rows a refresh failed to re-read.
    const kb = readFileSync(join(ROOT, 'app/tenant/kb/page.tsx'), 'utf8');
    const cats = readFileSync(join(ROOT, 'app/tenant/kb/categories/page.tsx'), 'utf8');
    for (const [name, src] of [['kb', kb], ['kb/categories', cats]] as const) {
      expect(src, `${name} has no stale state`).toMatch(/Boolean\(.*rror\) && Boolean\(/);
      expect(src, `${name} has no failed state`).toMatch(/Boolean\(.*rror\) && !/);
      expect(src, `${name} does not say last read`).toMatch(/last read/i);
    }
  });

  it('the dialog is told whether the categories were read, not just what came back', () => {
    const kb = readFileSync(join(ROOT, 'app/tenant/kb/page.tsx'), 'utf8');
    expect(kb).toMatch(/categoriesFailed=\{categoriesFailed\}/);
    expect(kb).toMatch(/dropdown offers only Uncategorized/);
  });

  it('moves #2863 case that pinned "No articles found" for a search with no matches', () => {
    // That assertion was deliberate, not an accident, so it is corrected here rather than
    // left to fail and be found by the next slice.
    const sibling = readFileSync(
      join(ROOT, 'tests/unit/panel-page-error-not-empty-kb-2829.test.tsx'),
      'utf8',
    );
    expect(sibling, 'the sibling still asserts the false-empty wording').not.toMatch(
      /getByText\('No articles found'\)/,
    );
    expect(sibling).toMatch(/No published articles match this search or category/);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
