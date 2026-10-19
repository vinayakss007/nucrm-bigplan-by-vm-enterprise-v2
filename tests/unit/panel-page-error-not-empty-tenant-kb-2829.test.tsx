// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, knowledge slice — `kb` and `kb/categories`.
 *
 * Measured on `3387f9c9` with the repo's own screen (`inspect()` from
 * `scripts/check-panel-error-state.mjs`), before any of this was written:
 *
 *   - `kb:118`           — `No articles found` over a failed published-article read,
 *     `error` bound and spent on `if (articlesError) toast.error(...)` in the render body.
 *   - `kb/categories:64` — `No categories yet`, same render-body toast.
 *
 * The part the screen cannot see is that a page is only as honest as its worse read.
 * `kb` bound the article list and left `/api/tenant/kb/categories` destructured with no
 * `error` and no `refetch` at all. A refused category read therefore produced no message
 * anywhere and silently shrank the create dialog's dropdown to its one fallback option:
 * the operator filed the new article as Uncategorized and was never told the list had
 * failed to load. That is the option-list shape — from the operator's side, "none" and
 * "unread" are indistinguishable — and it is why this slice renders two separate
 * statements for that one read: the filter row says it offers only `All`, and the dialog
 * says its dropdown offers only `Uncategorized`, because the dialog covers the row.
 *
 * The honest arms stay honest. `kb` filters its published articles **client-side** (the
 * search box and the category chips), so a successful read that shows nothing under a
 * search term is a real answer about that term and not an outage; it now says "match this
 * search or category", and says something else again when nothing is filtered. And because
 * both reads are invalidated by their own mutations, a failed *refresh* keeps the rows on
 * screen and says "last read" — a second state, tested separately, not an outage banner
 * replacing the data the operator is looking at.
 *
 * `forms` and `email-templates` were in this slice until `#2862` claimed them on top of
 * the #2829 note; they are handed there rather than duplicated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

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

const NOW = '2026-10-01T00:00:00Z';
const URLS = {
  kbArticles: '/api/tenant/kb/articles?status=published',
  kbCategories: '/api/tenant/kb/categories',
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The other state: the read answered before, this refresh did not, the rows stay. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// ── fixtures: the shape each endpoint actually returns ─────────────────────────
const kbArticleRows = {
  data: [
    {
      id: 'ka1', title: 'Refund policy', excerpt: 'How refunds are decided.',
      categoryId: 'kc1', categoryName: 'Policies', createdAt: NOW, views: 12, helpful: 80,
    },
    {
      id: 'ka2', title: 'Importing contacts', excerpt: 'CSV columns we accept.',
      categoryId: 'kc2', categoryName: 'Guides', createdAt: NOW, views: 3, helpful: 0,
    },
  ],
};
const kbCategoryRows = {
  data: [
    { id: 'kc1', name: 'Policies', description: 'Refunds, terms, data.' },
    { id: 'kc2', name: 'Guides', description: null },
  ],
};

/** Every alert's text joined — a page can raise more than one failure. */
function alerts(): string {
  return screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => render(tree(node));

type Panel = {
  key: string;
  Page: () => ReactNode;
  /** the read this case refuses */
  failUrl: string;
  withFailure: Record<string, QueryResult>;
  /** the "there are none" claim it must not print over an outage */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  /** the reason text the banner has to carry through */
  reasonText: string;
  /** registry for a successful-but-empty render */
  empty: Record<string, QueryResult>;
  /** the sentence a genuinely empty library is allowed to print */
  emptyCopy: RegExp;
  /** registry for a render with real rows */
  rows: Record<string, QueryResult>;
  rowText: string;
  /** registry for a failed refresh: rows + error together */
  stale: Record<string, QueryResult>;
};

const PANELS: Panel[] = [
  {
    key: 'kb',
    Page: KBPage,
    failUrl: URLS.kbArticles,
    withFailure: { [URLS.kbArticles]: failed('Request failed (503)'), [URLS.kbCategories]: ok(kbCategoryRows) },
    sentence: /No articles found|No published articles yet/,
    phrase: /knowledge base/i,
    reasonText: '503',
    empty: { [URLS.kbArticles]: ok({ data: [] }), [URLS.kbCategories]: ok(kbCategoryRows) },
    emptyCopy: /No published articles yet/,
    rows: { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: ok(kbCategoryRows) },
    rowText: 'Refund policy',
    stale: { [URLS.kbArticles]: staleRead(kbArticleRows), [URLS.kbCategories]: ok(kbCategoryRows) },
  },
  {
    key: 'kb/categories',
    Page: KBCategoriesPage,
    failUrl: URLS.kbCategories,
    withFailure: { [URLS.kbCategories]: failed('Request failed (401)') },
    sentence: /No categories yet/,
    phrase: /categories/i,
    reasonText: '401',
    empty: { [URLS.kbCategories]: ok({ data: [] }) },
    emptyCopy: /No categories yet/,
    rows: { [URLS.kbCategories]: ok(kbCategoryRows) },
    rowText: 'Policies',
    stale: { [URLS.kbCategories]: staleRead(kbCategoryRows) },
  },
];

describe('a refused knowledge read is not reported as "there are none" (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  for (const p of PANELS) {
    describe(p.key, () => {
      it('names the failed read instead of claiming the tenant has none', () => {
        registry.byUrl = { ...p.withFailure };
        expect(() => wrapped(<p.Page />)).not.toThrow();
        expect(alerts()).toMatch(p.phrase);
        expect(alerts(), `${p.key}: the banner must carry the reason through`)
          .toContain(p.reasonText);
        expect(screen.queryAllByText(p.sentence).length, `${p.key}: still states the absence`).toBe(0);
      });

      it('announces the failure once, in the banner — not from a toast that fades', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, 'the toast channel is what left the false sentence on screen').not.toHaveBeenCalled();
        rerender(tree(<p.Page />));
        expect(toast.error, 'and it must not return on re-render either').not.toHaveBeenCalled();
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('keeps its honest sentence for a successful read that returned nothing', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(screen.getAllByText(p.emptyCopy).length).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('states what it actually read, with no failure on screen', () => {
        registry.byUrl = { ...p.rows };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toBe('');
      });

      it('keeps the rows and says "last read" when only the refresh failed', () => {
        // Both reads are invalidated by their own mutations, so this is the common
        // state, not a corner: replacing it with the outage banner would hide the
        // data the operator is looking at.
        registry.byUrl = { ...p.stale };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toMatch(/last read/i);
        expect(screen.queryAllByText(p.sentence).length).toBe(0);
      });
    });
  }
});

describe('kb: the category read the first pass left unbound (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('binds it, states it, and still shows the articles that did read', () => {
    registry.byUrl = { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: failed('Request failed (502)') };
    wrapped(<KBPage />);
    expect(alerts()).toMatch(/categories/i);
    expect(alerts()).toContain('502');
    expect(screen.getByText('Refund policy')).toBeTruthy();
    expect(screen.getByText('Importing contacts')).toBeTruthy();
  });

  it('tells the operator inside the create dialog that its dropdown offers only Uncategorized', () => {
    registry.byUrl = { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: failed('Request failed (502)') };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /New Article/i }));
    const banner = screen.getByText(/this dropdown offers only Uncategorized/i)
      .closest('[role="alert"]') as HTMLElement;
    expect(within(banner).getByText(/502/)).toBeTruthy();
    // The category picker is the first of the dialog's two selects. The silent shrink
    // to one option is the bug; filing the article as Uncategorized is its cost.
    const picker = screen.getAllByRole('combobox')[0];
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Uncategorized']);
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[URLS.kbCategories].refetch).toHaveBeenCalled();
  });

  it('names the shrunk filter row rather than leaving a lone All chip unexplained', () => {
    registry.byUrl = { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: failed('Request failed (502)') };
    wrapped(<KBPage />);
    expect(screen.getByText(/this filter offers only All/i)).toBeTruthy();
    // One chip and a failure statement — not a chip row that looks like a finished list.
    expect(screen.getAllByRole('button', { name: 'All' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Policies' })).toBeNull();
  });

  it('leaves the create dialog usable for a plain empty knowledge base', () => {
    registry.byUrl = { [URLS.kbArticles]: ok({ data: [] }), [URLS.kbCategories]: ok({ data: [] }) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /New Article/i }));
    expect(within(screen.getAllByRole('combobox')[0]).getAllByRole('option').length).toBe(1);
    expect(alerts(), 'an empty category list that read correctly is not an outage').toBe('');
  });
});

describe('kb: a client-side miss stays a miss (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('says "no published articles match" for a search that excludes everything, with no outage claimed', () => {
    registry.byUrl = { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: ok(kbCategoryRows) };
    wrapped(<KBPage />);
    fireEvent.change(screen.getByPlaceholderText('Search articles...'), { target: { value: 'zzzz' } });
    expect(screen.getByText(/No published articles match this search or category/)).toBeTruthy();
    expect(alerts(), 'a search miss is not an outage').toBe('');
  });

  it('says the same for a category chip narrowed until nothing is left', () => {
    registry.byUrl = { [URLS.kbArticles]: ok(kbArticleRows), [URLS.kbCategories]: ok(kbCategoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByText('Importing contacts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Policies' }));
    fireEvent.change(screen.getByPlaceholderText('Search articles...'), { target: { value: 'nothing' } });
    expect(screen.getByText(/No published articles match this search or category/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('does not borrow the miss copy for a failed read while a filter is set', () => {
    registry.byUrl = { [URLS.kbArticles]: failed('Request failed (500)'), [URLS.kbCategories]: ok(kbCategoryRows) };
    wrapped(<KBPage />);
    fireEvent.change(screen.getByPlaceholderText('Search articles...'), { target: { value: 'zzzz' } });
    expect(alerts()).toMatch(/Failed to load the knowledge base/i);
    expect(screen.queryByText(/No published articles match/i), 'an unread base is not a search miss').toBeNull();
  });
});

describe('kb/categories: the failure does not delete the create path (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('still lets a name be typed while the list could not be read', () => {
    registry.byUrl = { [URLS.kbCategories]: failed('Request failed (500)') };
    wrapped(<KBCategoriesPage />);
    expect(alerts()).toMatch(/categories/i);
    fireEvent.click(screen.getByRole('button', { name: /New Category/i }));
    expect(screen.getByPlaceholderText('e.g. Getting Started')).toBeTruthy();
  });

  it('keeps the rows and their actions for a failed refresh of the list it did read', () => {
    registry.byUrl = { [URLS.kbCategories]: staleRead(kbCategoryRows) };
    wrapped(<KBCategoriesPage />);
    expect(screen.getByText('Policies')).toBeTruthy();
    expect(screen.getByText('Guides')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('the ratchet decayed by exactly these two (#2829)', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/kb/page.tsx', 'app/tenant/kb/categories/page.tsx'];
  const doc = () => JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
    files: Record<string, string>;
  };

  it('is still green, and counts exactly the panels the baseline carries', () => {
    // The number is read off the file rather than written as a literal, so a sibling
    // slice landing first cannot make this suite lie in either direction.
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(new RegExp(`OK — ${Object.keys(doc().files).length} panel\\(s\\)`));
    expect(res.stdout, 'a fixed page must be deleted from the file, not left stale').not.toContain('no longer offends');
  });

  it('no longer carries either of the two', () => {
    const files = doc().files;
    // A ceiling, never an equality: #2851 and #2860 each delete entries of their own.
    expect(Object.keys(files).length).toBeLessThanOrEqual(18);
    for (const f of FILES) {
      expect(files, `${f} stayed on the list after being fixed`).not.toHaveProperty(f);
    }
  });

  it('each fixed page reads its failure and renders for it', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still offends the screen`).toBe(false);
      expect(src, `${f} does not bind error`).toMatch(/\berror\b/);
      expect(src, `${f} binds error and never renders it`).toMatch(/InlineErrorState/);
    }
    // The second read, the one the screen cannot count at all: `kb` now binds the
    // category failure and states it where the operator would otherwise act on the
    // shrunk dropdown rather than on the shrunk filter row.
    const kb = readFileSync(join(ROOT, 'app/tenant/kb/page.tsx'), 'utf8');
    expect(kb).toMatch(/categoriesError/);
    expect(kb).toMatch(/dropdown offers only Uncategorized/);
    expect(kb).toMatch(/filter offers only All/);
  });

  it('leaves no load-failure toast behind on these two pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts a read failure`).not.toMatch(/if \((?:error|\w*[Ee]rror)\)\s*toast\.error/);
      expect(src, `${f} still toasts a read failure from an effect`).not.toMatch(/toast\.error\((['`])Failed to load/);
    }
  });

  it('leaves no owed-name pointing at a page this slice fixed', () => {
    // `money-path` used to pin a page from another group to prove an empty sweep is not
    // success, and the pin had to be re-cut every time that group was fixed:
    // `superadmin/modules` → `visitors` → `kb` → `pipelines`, each one moved because a
    // slice did its job. #2860 removes the pins; this is the half that cannot rot, and it
    // is what the fix in #2865 for the same class of memorised count looks like from here.
    const money = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-money-path-2829.test.tsx'), 'utf8');
    for (const f of FILES) {
      expect(money, `money-path still asserts the fixed ${f}`).not.toMatch(
        new RegExp(`expect\\(f\\['${f.replace(/[/.]/g, (c) => `\\${c}`)}'\\]`),
      );
    }
    // The guard run is what the pins were pretending to prove, and it is in that file:
    // a page dropped from the baseline while it still offends is a NOVEL offender.
    expect(money, 'money-path stopped running the guard').toMatch(/check-panel-error-state\.mjs/);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
