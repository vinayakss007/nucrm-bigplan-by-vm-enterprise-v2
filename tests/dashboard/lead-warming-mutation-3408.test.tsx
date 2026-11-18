// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — lead-warming campaign toggle/archive used bare fetch with no status
 * check and no onError, so a refused write refreshed as if it had landed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  campaigns: [{
    id: 'C1', name: 'Welcome series', description: null, status: 'paused',
    enableEmail: true, enableWhatsapp: false, enableSms: false,
    aiGenerateMessages: false, aiTone: 'friendly', totalSent: 0, totalReplies: 0,
    totalPositiveIntent: 0, createdAt: '2026-11-18T00:00:00Z',
  }],
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) => ({
    data: String(url).includes('campaigns')
      ? { data: data.campaigns }
      : (String(url).includes('stats') ? {
          campaigns: { total: 1, active: 0 },
          messages: { total: 0, sent: 0, queued: 0, failed: 0, emailCount: 0, whatsappCount: 0 },
          replies: { total: 0, interested: 0, notInterested: 0, askLater: 0, question: 0,
            positiveSocial: 0, unsubscribe: 0, replyRate: 0, positiveRate: 0 },
        } : { data: [] }),
    error: null, isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import LeadWarmingPage from '@/app/tenant/ai/lead-warming/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<LeadWarmingPage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: lead-warming mutations surface failures', () => {
  it('a refused toggle shows the server error', async () => {
    mount(resp({ error: 'cannot activate' }, false, 500));
    await waitFor(() => expect(document.querySelector('[title="Activate"]')).toBeTruthy());
    (document.querySelector('[title="Activate"]') as HTMLButtonElement).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('cannot activate'));
  });

  it('a refused archive shows the server error', async () => {
    mount(resp({ error: 'archive refused' }, false, 500));
    await waitFor(() => expect(document.querySelector('[title="Archive"]')).toBeTruthy());
    (document.querySelector('[title="Archive"]') as HTMLButtonElement).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('archive refused'));
  });

  it('a successful toggle does not show an error', async () => {
    mount(resp({ ok: true }));
    await waitFor(() => expect(document.querySelector('[title="Activate"]')).toBeTruthy());
    (document.querySelector('[title="Activate"]') as HTMLButtonElement).click();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
