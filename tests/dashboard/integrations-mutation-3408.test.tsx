// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — integration toggle/delete used bare fetch with no status check and
 * no onError: a refused delete still showed "Removed".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  integrations: [{ id: 'I1', type: 'webhook', name: 'Zapier feed', created_at: '2026-11-18T00:00:00Z', is_active: false }],
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: () => ({
    data: { data: data.integrations }, error: null, isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import IntegrationsPage from '@/app/tenant/settings/integrations/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<IntegrationsPage />, { wrapper });
}

function clickDelete() {
  const icon = document.querySelector('.lucide-trash-2');
  if (!icon) throw new Error('delete button icon not rendered');
  (icon.closest('button') as HTMLButtonElement).click();
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: integration mutations surface failures', () => {
  it('a refused delete shows the server error, not "Removed"', async () => {
    mount(resp({ error: 'integration in use' }, false, 409));
    await waitFor(() => expect(document.querySelector('.lucide-trash-2')).toBeTruthy());
    clickDelete();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('integration in use'));
    expect(toast.success).not.toHaveBeenCalledWith('Removed');
  });

  it('a refused toggle shows the server error', async () => {
    mount(resp({ error: 'cannot activate' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inactive' })).toBeTruthy());
    screen.getByRole('button', { name: 'Inactive' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('cannot activate'));
  });

  it('a successful delete still shows "Removed"', async () => {
    mount(resp({ deleted: true }));
    await waitFor(() => expect(document.querySelector('.lucide-trash-2')).toBeTruthy());
    clickDelete();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
