// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the two knowledge-base panels.
 *
 * Both pages already knew the read had failed and spent that knowledge on a toast
 * fired from the render body, then printed the "there are none" sentence anyway.
 * `kb` carries both baseline shapes at once, which is why it needs per-read tests
 * rather than one generic loop. Measured on `main` before the fix
 * (`git show 07c337fe:app/tenant/kb/page.tsx`, and the repo's own `inspect()`):
 *
 *   - `app/tenant/kb/page.tsx`
 *       line 53 at base: `if (articlesError) toast.error('Failed to load knowledge base')`
 *       — in the render body, so it re-fired on every render — and the list branch
 *       answered the refusal with "No articles found", the same sentence a search
 *       with no matches earns. The categories read above it (`useApiQuery` at line 46)
 *       destructured **no `error` at all**: a refused categories read just dropped the
 *       chips, which are one of the two ways into the KB, and left the New Article
 *       modal offering only "Uncategorized" while looking like a tenant who has never
 *       made a category.
 *   - `app/tenant/kb/categories/page.tsx`
 *       line 33 at base: `if (error) toast.error('Failed to load categories')` — then
 *       "No categories yet". Deleting a category is the only destructive action on that
 *       screen, so a false "none" invites rebuilding duplicates of categories that
 *       published articles still point at.
 *
 * What is pinned here: each read's own banner names that read; the false-empty sentence
 * is unreachable while it is failing; "Try again" re-runs *that* read and not the other
 * one; the failure is announced from the banner rather than the render body. And what is
 * deliberately left alone: the filtered-empty case — a search or a category chip that
 * matches nothing still legitimately prints "No articles found", so that branch is
 * asserted as still working, not converted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
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

describe('the knowledge base banners the read that refused it (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const PANELS = [
    {
      key: 'kb articles',
      Page: KBPage,
      failUrl: ARTICLES,
      withFailure: { [ARTICLES]: failed('Request failed (502)'), [CATEGORIES]: ok(categoryRows) },
      sentence: /No articles found/,
      phrase: /knowledge base/i,
      empty: { [ARTICLES]: ok({ data: [] }), [CATEGORIES]: ok(categoryRows) },
      rows: { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) },
      rowText: /Reset a user password/,
    },
    {
      key: 'kb categories',
      Page: KBCategoriesPage,
      failUrl: CATEGORIES,
      withFailure: { [CATEGORIES]: failed('Request failed (500)') },
      sentence: /No categories yet/,
      phrase: /categories/i,
      empty: { [CATEGORIES]: ok({ data: [] }) },
      rows: { [CATEGORIES]: ok(categoryRows) },
      rowText: /Onboarding/,
    },
  ] as const;

  for (const p of PANELS) {
    describe(p.key, () => {
      it('names the failed read instead of claiming the workspace has none', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        expect(alerts(), `${p.key}: a failed read still printed the false-empty sentence`)
          .not.toBe('');
        expect(alerts()).toMatch(p.phrase);
        expect(alerts()).toMatch(/failed|could not be read|no response/i);
        expect(screen.queryByText(p.sentence)).toBeNull();
      });

      it('says there are none, with no alert, when the read really returned none', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(screen.getByText(p.sentence)).toBeTruthy();
        expect(alerts()).toBe('');
      });

      it('shows the rows it read, with no alert', () => {
        registry.byUrl = { ...p.rows };
        wrapped(<p.Page />);
        expect(screen.queryAllByText(p.rowText).length).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('announces the failure from the banner, not the render body', () => {
        registry.byUrl = { ...p.withFailure };
        const { rerender } = wrapped(<p.Page />);
        expect(toast.error, `${p.key} toasts on the first render`).not.toHaveBeenCalled();
        rerender(tree(<p.Page />));
        expect(toast.error, `${p.key} toasts again on every re-render, as the render body did`).not.toHaveBeenCalled();
      });
    });
  }
});

describe('kb keeps its two reads apart (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('leaves the category chips on screen when only the articles read failed', () => {
    registry.byUrl = { [ARTICLES]: failed('Request failed (502)'), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    expect(alerts()).toMatch(/knowledge base/i);
    expect(screen.queryByText('No articles found')).toBeNull();
    // the chips come from the healthy read, so the screen is still navigable
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
  });

  it('lists the articles it read when only the categories read failed, and says the list is unfiltered', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: failed('Request failed (504)') };
    wrapped(<KBPage />);
    expect(alerts()).toMatch(/categories/i);
    expect(alerts()).toMatch(/unfiltered/i);
    expect(screen.queryAllByText(/Reset a user password/).length).toBeGreaterThan(0);
    expect(screen.queryByText('No articles found')).toBeNull();
    // the chips themselves are gone: they would be an empty row of nothing to click
    expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
  });

  it('gives each banner its own retry, and each retry its own read', () => {
    registry.byUrl = { [ARTICLES]: failed(), [CATEGORIES]: failed() };
    wrapped(<KBPage />);
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
    const buttons = screen.getAllByRole('button', { name: /try again/i });
    expect(buttons).toHaveLength(2);

    // chips row comes first in the DOM
    fireEvent.click(buttons[0]);
    expect(registry.byUrl[CATEGORIES].refetch).toHaveBeenCalled();
    expect(registry.byUrl[ARTICLES].refetch, 'one read failing must not refetch the other').not.toHaveBeenCalled();

    fireEvent.click(buttons[1]);
    expect(registry.byUrl[ARTICLES].refetch).toHaveBeenCalled();
  });

  it('still calls a search that matches nothing "No articles found"', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.change(screen.getByPlaceholderText(/search articles/i), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No articles found')).toBeTruthy();
    expect(alerts(), 'a search with no matches is not an outage').toBe('');
  });

  it('filters the list by the chip the healthy read supplied', () => {
    registry.byUrl = { [ARTICLES]: ok(articleRows), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByText('How invoicing tax works')).toBeTruthy();
    expect(screen.queryByText('Reset a user password')).toBeNull();
  });

  it('keeps the New Article button usable under the banner', () => {
    registry.byUrl = { [ARTICLES]: failed(), [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBPage />);
    fireEvent.click(screen.getByRole('button', { name: /new article/i }));
    expect(screen.getByPlaceholderText('Article title')).toBeTruthy();
  });
});

describe('kb/categories still offers its header action under the banner (#2829)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  it('keeps "New Category" on screen, because it is not an empty-state CTA', () => {
    registry.byUrl = { [CATEGORIES]: failed('Request failed (500)') };
    wrapped(<KBCategoriesPage />);
    expect(alerts()).toMatch(/categories/i);
    expect(screen.queryByText('No categories yet')).toBeNull();
    expect(screen.getByRole('button', { name: /new category/i })).toBeTruthy();
  });

  it('routes the retry to the categories read only', () => {
    registry.byUrl = { [CATEGORIES]: failed() };
    wrapped(<KBCategoriesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[CATEGORIES].refetch).toHaveBeenCalled();
  });

  it('shows the categories it read, each with its row actions', () => {
    registry.byUrl = { [CATEGORIES]: ok(categoryRows) };
    wrapped(<KBCategoriesPage />);
    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(screen.getByText('Billing')).toBeTruthy();
    expect(screen.getByText('Setup guides')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('the #2829 ratchet is one notch tighter for these two', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/kb/page.tsx', 'app/tenant/kb/categories/page.tsx'];

  const baseline = () => {
    const doc = JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ) as { files: Record<string, string> };
    return Object.keys(doc.files);
  };

  it('counts whatever is left in the file, and never a number memorised from one slice (#2858)', () => {
    const keys = baseline();
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain(`OK — ${keys.length} panel(s)`);
    expect(keys.length, 'the list may only shrink from the 24 it started at').toBeLessThanOrEqual(24);
  });

  it('no longer carries either knowledge-base panel', () => {
    const files = JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ) as { files: Record<string, string> };
    for (const f of FILES) {
      expect(files.files, `${f} stayed on the list after being fixed`).not.toHaveProperty(f);
    }
  });

  it('and the repo screen agrees that both pages are clean', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(inspect(f, src).offends, `${f} still answers a refused read with a false-empty sentence`).toBe(false);
    }
  });

  it('binds the error and renders a banner on both pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} does not destructure an error from its read`).toMatch(/[Ee]rror/);
      expect(src, `${f} never renders InlineErrorState`).toMatch(/<InlineErrorState/);
      expect(src, `${f} still toasts a read failure from the render body`).not.toMatch(
        /if \((?:[A-Za-z_]*[Ee]rror)\)\s*toast\.error/,
      );
      expect(src, `${f} still toasts a read failure from an effect`).not.toMatch(
        /useEffect\(\(\) => \{\s*if \([A-Za-z_]*[Ee]rror\)/,
      );
    }
  });

  it('keeps every file it touches inside the size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
