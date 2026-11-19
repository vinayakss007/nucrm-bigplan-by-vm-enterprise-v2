// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed article read logged to the console and left `article` null,
 * rendering a completely blank page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'A1' }),
  useRouter: () => ({ push: router.push }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/errors-client', () => ({ logError: vi.fn() }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => {} }));

import KBArticlePage from '@/app/tenant/kb/[id]/kb-article-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: KB article distinguishes a failed read from a missing article', () => {
  it('a 5xx read shows an error instead of a blank page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<KBArticlePage />);
    await waitFor(() => expect(screen.getByText(/This article could not be loaded/)).toBeTruthy());
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a 404 still redirects to the KB index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'missing' }, false, 404)));
    render(<KBArticlePage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/tenant/kb'));
  });

  it('a successful read still renders the article', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: { id: 'A1', title: 'Reset your password', content: 'Steps' } })));
    render(<KBArticlePage />);
    await waitFor(() => expect(screen.getByText('Reset your password')).toBeTruthy());
    expect(screen.queryByText(/This article could not be loaded/)).toBeNull();
  });
});
