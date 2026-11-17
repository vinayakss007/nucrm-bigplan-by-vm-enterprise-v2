// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a refused DLQ mutation must show a failure toast, never the old
 * "No entry found" / "Retried 0 entries" success message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

vi.mock('@/lib/query/client', () => ({
  useApiQuery: () => ({
    data: {
      data: [{ id: 'd1', jobType: 'webhook:deliver', jobId: 'j1', queue: 'webhooks',
        payload: {}, errorMessage: 'HTTP 502', attempts: 3, maxAttempts: 3,
        status: 'failed', createdAt: '2026-03-04T10:00:00.000Z' }],
      total: 1,
    },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import DlqPage from '@/app/tenant/settings/webhooks/dlq/page';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<DlqPage />, { wrapper });
}

const failedResp = (message = 'Admin required') =>
  ({ ok: false, status: 403, json: async () => ({ error: message }) }) as Response;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: DLQ mutation failures reach the error toast', () => {
  it('a failed single retry says it failed, not "No entry found"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResp());
    renderPage();
    screen.getByRole('button', { name: 'Retry' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Retry failed: Admin required'));
    expect(toast.error).not.toHaveBeenCalledWith('No entry found');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a failed retry-all says it failed, not "Retried 0 entries"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResp('queue unavailable'));
    renderPage();
    screen.getByRole('button', { name: 'Retry All Pending' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Retry all failed: queue unavailable'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a failed purge says it failed instead of showing nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResp('purge refused'));
    renderPage();
    screen.getByRole('button', { name: 'Purge' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Purge failed: purge refused'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a genuine success still shows the success toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ succeeded: 1, failed: 0 }) } as Response,
    );
    renderPage();
    screen.getByRole('button', { name: 'Retry' }).click();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Retried successfully'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
