// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the notifications page used bare fetch with no status check, so a
 * refused PATCH/DELETE still fired onSuccess ("All marked as read"/"Cleared").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  notifications: [{ id: 'N1', type: 'alert', title: 'Hello', created_at: '2026-11-18T00:00:00Z' }],
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: () => ({
    data: { data: data.notifications, total: 1 },
    error: null, isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import NotificationsPage from '@/app/tenant/notifications/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<NotificationsPage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: notification mutations surface failures', () => {
  it('a refused mark-all-read does not claim success', async () => {
    mount(resp({ error: 'update refused' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all read' })).toBeTruthy());
    screen.getByRole('button', { name: 'Mark all read' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('update refused'));
    expect(toast.success).not.toHaveBeenCalledWith('All marked as read');
  });

  it('a refused clear-all does not claim the list was cleared', async () => {
    mount(resp({ error: 'delete refused' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy());
    screen.getByRole('button', { name: 'Clear all' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('delete refused'));
    expect(toast.success).not.toHaveBeenCalledWith('Cleared');
  });

  it('a successful clear-all still shows its success toast', async () => {
    mount(resp({ deleted: 1 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy());
    screen.getByRole('button', { name: 'Clear all' }).click();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Cleared'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
