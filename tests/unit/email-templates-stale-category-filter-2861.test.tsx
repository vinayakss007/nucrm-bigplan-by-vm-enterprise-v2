// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2861 — Email Templates said "No templates yet" while its own header counted a
 * live template.
 *
 * The category chips are derived from the list they filter (`page.tsx:281`), and
 * `filter` is plain state that nothing resets. Delete the last template of the
 * category you are looking at and the chip row recomputes without it, `visible`
 * goes empty, and the branch below it prints the workspace-is-empty sentence with
 * its "Create your first template" CTA — under a header that counts `templates`,
 * not `visible`. Two claims on one screen, and the invitation is to build a
 * near-duplicate of a template sequences may already be sending.
 *
 * The fix is the smaller of the two options the issue names: treat the stale
 * selection as "all". So the tests here are the real delete path — a mocked
 * DELETE, `onSuccess` → `reload()`, the refetch coming back without the category
 * that was being viewed — and assert that the library the server still has is
 * shown, that no empty-state sentence appears, and that the highlighted chip is
 * the one that is actually in effect.
 *
 * What is deliberately kept: a workspace with no templates at all still gets
 * "No templates yet" and its CTA (asserted), and a category that does have
 * matches still filters to them (asserted) — this is about a selection that no
 * longer exists, not about making the filter useless.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

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

import EmailTemplatesPage from '@/app/tenant/email-templates/page';

const URL = '/api/tenant/email-templates';
const NOW = '2026-10-01T00:00:00Z';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const tpl = (id: string, name: string, category: string) => ({
  id, name, subject: `${name} subject`, body: '<p>Hi</p>', category,
  created_at: NOW, updated_at: NOW,
});

const welcome = tpl('et-1', 'Welcome sequence', 'onboarding');
const invoice = tpl('et-2', 'Invoice reminder', 'billing');

/** Which chip is rendered as the active one — the one carrying the selected style. */
const selectedChip = () =>
  screen
    .getAllByRole('button')
    .filter((el) => /rounded-lg text-xs font-medium transition-colors capitalize/.test(el.className))
    .filter((el) => el.className.includes('shadow-sm'))
    .map((el) => el.textContent ?? '');

describe('the viewed category emptying out (#2861)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    // @ts-expect-error — restoring the global stub
    globalThis.fetch = undefined;
  });

  /** A fake server that deletes `invoice` and answers the next list read with what is left. */
  const serverThatDeletes = (id: string) =>
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE' && String(url).endsWith(`/${id}`)) {
        registry.byUrl[URL] = ok({ data: [welcome] });
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

  it('shows the templates that are still there instead of "No templates yet"', async () => {
    registry.byUrl = { [URL]: ok({ data: [welcome, invoice] }) };
    // @ts-expect-error — test stub
    globalThis.fetch = serverThatDeletes('et-2');
    render(tree(<EmailTemplatesPage />));

    fireEvent.click(screen.getByRole('button', { name: 'billing' }));
    expect(screen.getByText('Invoice reminder')).toBeTruthy();
    expect(screen.queryByText('Welcome sequence')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(screen.getByText('Welcome sequence')).toBeTruthy());
    expect(screen.queryByText('No templates yet'), 'the header counts one template; the body said there were none').toBeNull();
    expect(screen.queryByText('Create your first template')).toBeNull();
    expect(screen.getByText('1 template')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('leaves no chip highlighted that the list no longer contains', async () => {
    registry.byUrl = { [URL]: ok({ data: [welcome, invoice] }) };
    // @ts-expect-error — test stub
    globalThis.fetch = serverThatDeletes('et-2');
    render(tree(<EmailTemplatesPage />));

    fireEvent.click(screen.getByRole('button', { name: 'billing' }));
    expect(selectedChip()).toEqual(['billing']);

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(screen.getByText('Welcome sequence')).toBeTruthy());
    // 'billing' is gone from the chip row, so it cannot be the selection either
    expect(screen.queryByRole('button', { name: 'billing' })).toBeNull();
    expect(selectedChip(), 'the highlighted chip has to be the filter actually in effect').toEqual(['all']);
  });

  it('keeps filtering when the category still has templates', () => {
    registry.byUrl = { [URL]: ok({ data: [welcome, invoice] }) };
    render(tree(<EmailTemplatesPage />));
    fireEvent.click(screen.getByRole('button', { name: 'onboarding' }));
    expect(screen.getByText('Welcome sequence')).toBeTruthy();
    expect(screen.queryByText('Invoice reminder')).toBeNull();
    expect(screen.getByText('2 templates')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says "No templates yet" to a workspace that really has none', () => {
    registry.byUrl = { [URL]: ok({ data: [] }) };
    render(tree(<EmailTemplatesPage />));
    expect(screen.getByText('No templates yet')).toBeTruthy();
    expect(screen.getByText('Create your first template')).toBeTruthy();
    expect(screen.getByText('0 templates')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('and still banners a failed read rather than the empty state', () => {
    registry.byUrl = { [URL]: { data: undefined, error: new Error('Request failed (500)'), isLoading: false, refetch: vi.fn() } };
    render(tree(<EmailTemplatesPage />));
    expect(alerts()).toMatch(/email templates/i);
    expect(screen.queryByText('No templates yet')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('the source keeps the selection tied to the list', () => {
  const ROOT = process.cwd();

  it('derives the filter in effect from the categories it just read', () => {
    const src = readFileSync(join(ROOT, 'app/tenant/email-templates/page.tsx'), 'utf8');
    expect(src, 'the render must not trust `filter` on its own again').toMatch(
      /const activeFilter = categories\.includes\(filter\) \? filter : 'all';/,
    );
    expect(src).toMatch(/activeFilter === 'all' \? templates : templates\.filter\(t => t\.category === activeFilter\)/);
  });
});
