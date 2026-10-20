// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/products/page.tsx`.
 *
 * The page is past #2829: it binds a prefixed error, keeps the `refetch`, and renders
 * `InlineErrorState` where the absence sentence used to sit. That half stays. What it could not
 * tell apart is the state its own writes put it in — TanStack Query keeps `data` when a
 * refetch of a read that already succeeded fails, and the page branched on the flag:
 *
 *     : filtered.length === 0 ? (productsError ? <outage/> : <sentence/>) : <rows/>
 *
 * `saveProduct` and `removeProduct` both finish in `reload()` →
 * `invalidateQueries(['tenant','products'])`, and that is the exact key the read lives under, so
 * the refresh every one of those actions asks for is the refresh that gets refused. The operator
 * then saw either of two wrong screens: kept rows with no word about the refused refresh, or —
 * because the search box filters client-side and can exclude every kept row — "Failed to load
 * products" printed over a read that had answered, with the honest "no match" sentence, the footer
 * tally and the kept rows' Edit/Delete buttons replaced by an outage card.
 *
 * `failed = Boolean(productsError) && !data` keeps the banner #2829 added; `stale =
 * Boolean(productsError) && data` keeps the rows and says they are the last read. No number is
 * derived off the flag here — the footer tally prints only above a non-empty table — so the
 * dash-half of the fix is a no-op on this page and is pinned as such.
 *
 * `scripts/check-panel-error-state.mjs` reports this file clean both before and after the split is
 * rewound: the sweep only asks whether a failure reaches the screen, and here it reached it too
 * eagerly. These assertions are what stands in its place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

import ProductsPage from '@/app/tenant/products/page';

const PRODUCTS = '/api/tenant/products?limit=200';

const NOW = '2026-10-18T09:00:00.000Z';
const productRows = {
  data: [
    { id: 'p1', name: 'Widget Mk II', description: null, sku: 'WGK-2', base_price: '199.00', created_at: NOW, updated_at: NOW },
    { id: 'p2', name: 'Service retainer', description: 'Monthly support', sku: 'SVC-RET', base_price: '90.00', created_at: NOW, updated_at: NOW },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh was refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const wrapped = (node: ReactNode) => {
  cleanup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

describe('products: a write whose reload was refused keeps the catalog (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [PRODUCTS]: staleRead(productRows) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both products, the footer tally and the caveat that they are the last read', () => {
    const result = registry.byUrl[PRODUCTS];
    wrapped(<ProductsPage />);
    expect(screen.getByText('Widget Mk II')).toBeTruthy();
    expect(screen.getByText('Service retainer')).toBeTruthy();
    // The tally is a count of rows the page is still holding, so it stays a real number.
    expect(screen.getByText('2 products')).toBeTruthy();
    expect(alerts()).toContain('the catalog below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be a lie here: the read answered, only the refresh did not.
    expect(alerts()).not.toMatch(/Failed to load products/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(result.refetch).not.toHaveBeenCalled();
  });

  it('re-runs the products read from the caveat', () => {
    const result = registry.byUrl[PRODUCTS];
    wrapped(<ProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a kept row actionable', () => {
    wrapped(<ProductsPage />);
    fireEvent.click(screen.getAllByTitle('Edit')[0]);
    expect(screen.getByText('Edit Product')).toBeTruthy();
    expect((screen.getByPlaceholderText('e.g. Widget Pro') as HTMLInputElement).value).toBe('Widget Mk II');
  });

  it('a search that excludes every kept row is a miss, not an outage', () => {
    wrapped(<ProductsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search products/i), { target: { value: 'zzz-no-such-sku' } });
    expect(screen.getByText('No products match your search')).toBeTruthy();
    expect(alerts()).toContain('the catalog below is the last read');
    // The bug this slice exists for: kept rows + flag set read as "could not load".
    expect(alerts()).not.toMatch(/Failed to load products/);
  });

  it('an unread catalog is the outage, and "No products yet" is unreachable', () => {
    registry.byUrl = { [PRODUCTS]: failed('Request failed (503)') };
    wrapped(<ProductsPage />);
    expect(alerts()).toMatch(/Failed to load products: Request failed \(503\)/);
    expect(screen.queryByText(/No products yet/)).toBeNull();
    expect(screen.queryByText(/0 products/)).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
  });

  it('says none exist, with no alert at all, when that is what came back', () => {
    registry.byUrl = { [PRODUCTS]: ok({ data: [] }) };
    wrapped(<ProductsPage />);
    expect(screen.getByText('No products yet. Add your first product!')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty catalog is all the last read has', () => {
    registry.byUrl = { [PRODUCTS]: staleRead({ data: [] }) };
    wrapped(<ProductsPage />);
    expect(screen.getByText('No products yet. Add your first product!')).toBeTruthy();
    // The caveat is what separates "the tenant has none" from "I could not check".
    expect(alerts()).toMatch(/last read/);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [PRODUCTS]: ok(productRows) };
    wrapped(<ProductsPage />);
    expect(screen.getByText('Widget Mk II')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [PRODUCTS]: staleRead(productRows, '') };
    wrapped(<ProductsPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Widget Mk II')).toBeTruthy();

    registry.byUrl = { [PRODUCTS]: failed('') };
    wrapped(<ProductsPage />);
    expect(alerts()).toMatch(/Failed to load products: no response from the server/);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/tenant/products/page.tsx';
  const src = () => readFileSync(join(ROOT, PAGE), 'utf8');

  it('splits the two states apart', () => {
    const s = src();
    expect(s).toMatch(/const productsFailed = Boolean\(productsError\) && !data;/);
    expect(s).toMatch(/const productsStale = Boolean\(productsError\) && Boolean\(data\);/);
    expect(s).toMatch(/productsError\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\{productsStale && \(/);
    expect(s).toMatch(/onRetry=\{refetchProducts\}/);
  });

  it('no longer treats any error as an outage', () => {
    const s = src();
    expect(s, 'still branches the read on the bare flag').not.toMatch(/\w*[Ee]rror \? '—'/);
    expect(s, 'still replaces kept rows with the outage card').not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
    expect(s, 'carries a page state in a fading toast').not.toMatch(/^\s*if \(error\) toast\.error/m);
  });

  it('dashes nothing that a kept read already counted', () => {
    // The page has no header total: the footer tally prints only inside a non-empty table. Pinned,
    // so a later edit that adds one has to key it off the outage and not off the flag.
    expect(src()).not.toMatch(/[Ee]rror \? '—'/);
    registry.byUrl = { [PRODUCTS]: staleRead(productRows) };
    wrapped(<ProductsPage />);
    expect(screen.getByText('2 products')).toBeTruthy();
    cleanup();
    registry.byUrl = { [PRODUCTS]: failed('Request failed (503)') };
    wrapped(<ProductsPage />);
    expect(alerts()).toMatch(/Failed to load products/);
    expect(screen.queryByText(/0 product/)).toBeNull();
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    expect(inspect(PAGE, s).offends, 'the page was already on the guard\'s list').toBe(false);
    const rewind = /const productsFailed = Boolean\(productsError\) && !data;\s*\n\s*const productsStale = Boolean\(productsError\) && Boolean\(data\);/;
    expect(s, 'the shape this slice depends on moved').toMatch(rewind);
    expect(
      inspect(PAGE, s.replace(rewind, 'const productsFailed = Boolean(productsError);')).offends,
      'the guard would catch this rewind after all',
    ).toBe(false);
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, not a count — pinning the number is what #2858, #2865 and #2866 each had to undo.
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files, 'the guard already saw this page — it should never have been baselined').not.toContain(PAGE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    expect(src().split('\n').length - 1, 'crossed MAX_LINES').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('does not put #2829 words about a kept read into its own suite', () => {
    // Overlap hygiene: that file pins the never-answered half of this same page. If it started
    // asserting the stale copy too, this slice would be double-claiming its ground.
    const t = 'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx';
    expect(readFileSync(join(ROOT, t), 'utf8'), `${t} now speaks about a last read`).not.toMatch(/last read/);
  });
});
