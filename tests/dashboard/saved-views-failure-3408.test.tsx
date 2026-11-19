// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed saved-views load used to call `setViews([])` in the catch,
 * rendering the same "No saved views yet" text as a tenant with none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Radix internals aren't under test — render the content so its state is visible.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { SavedViews } from '@/components/tenant/saved-views';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aView = {
  id: 'V1', name: 'My pipeline', entityType: 'contact', filters: {}, isShared: false,
  isDefault: false, userId: 'U1',
};
const renderViews = () => render(
  <SavedViews entityType="contact" currentFilters={{ status: 'open' }} currentQuery="" onApplyView={vi.fn()} />,
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: saved views distinguishes a failed load from an empty list', () => {
  it('a failed load shows an error, not "No saved views yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    renderViews();
    await waitFor(() => expect(screen.getByText('Saved views could not be loaded.')).toBeTruthy());
    expect(screen.queryByText('No saved views yet')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    renderViews();
    await waitFor(() => expect(screen.getByText('No saved views yet')).toBeTruthy());
    expect(screen.queryByText('Saved views could not be loaded.')).toBeNull();
  });

  it('a successful load still renders the saved views', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [aView] })));
    renderViews();
    await waitFor(() => expect(screen.getByText('My pipeline')).toBeTruthy());
    expect(screen.queryByText('Saved views could not be loaded.')).toBeNull();
  });
});
