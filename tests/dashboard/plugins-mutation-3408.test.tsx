// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — plugin toggle/delete threw a bare "Failed" with no onError, so a
 * refused write produced no feedback at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  plugins: [{
    id: 'P1', name: 'Zapier', description: 'Feed leads', baseUrl: 'https://hooks.example',
    authType: 'bearer', actions: [], status: 'disabled', createdAt: '2026-11-18T00:00:00Z',
  }],
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: () => ({
    data: { data: data.plugins }, error: null, isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import PluginsPage from '@/app/tenant/plugins/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<PluginsPage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: plugin mutations surface failures', () => {
  it('a refused toggle shows the server error, not nothing', async () => {
    mount(resp({ error: 'plugin is required by a workflow' }, false, 409));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable plugin' })).toBeTruthy());
    screen.getByRole('switch', { name: 'Enable plugin' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('plugin is required by a workflow'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a refused delete shows the server error, not "Plugin deleted"', async () => {
    mount(resp({ error: 'delete refused' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete plugin' })).toBeTruthy());
    screen.getByRole('button', { name: 'Delete plugin' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('delete refused'));
    expect(toast.success).not.toHaveBeenCalledWith('Plugin deleted');
  });

  it('a successful toggle still shows its success toast', async () => {
    mount(resp({ ok: true }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable plugin' })).toBeTruthy());
    screen.getByRole('switch', { name: 'Enable plugin' }).click();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Plugin enabled'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
