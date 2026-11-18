// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a non-JSON gateway error on checkout made `res.json()` throw inside
 * the mutation with no onError: the upgrade button did nothing, silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) => ({
    data: String(url).includes('workspace')
      ? { data: { plan_id: 'starter', status: 'active', stripe_customer_id: 'cus_1', current_contacts: 1, current_users: 1 } }
      : { data: [{ id: 'pro', name: 'Pro', price_monthly: 49, max_contacts: 5000, max_users: 20 }] },
    error: null, isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import BillingPage from '@/app/tenant/settings/billing/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<BillingPage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: billing actions surface failures', () => {
  it('an HTML gateway error on checkout shows a failure toast', async () => {
    mount({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } } as unknown as Response);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy());
    screen.getByRole('button', { name: 'Upgrade to Pro' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Request failed with status 502.'));
  });

  it('a refused checkout keeps the "not configured" guidance', async () => {
    mount(resp({ error: 'Stripe is not configured yet' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy());
    screen.getByRole('button', { name: 'Upgrade to Pro' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Stripe is not configured yet. Contact support to upgrade.'));
  });

  it('a refused billing-portal open shows the server message', async () => {
    mount(resp({ error: 'portal unavailable' }, false, 500));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage Billing' })).toBeTruthy());
    screen.getByRole('button', { name: 'Manage Billing' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('portal unavailable'));
  });
});
