// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a refused custom-field delete used to be treated as a success: the
 * list reloaded as if the field were gone and no error was shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  fields: [{ id: 'F1', field_label: 'Tier', field_key: 'tier', field_type: 'text',
    is_required: false, is_searchable: false, is_calculated: false, display_order: 1 }],
  featuresError: null as Error | null,
  refetchFeatures: null as ReturnType<typeof vi.fn> | null,
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) => {
    const features = String(url).includes('features');
    const refetch = vi.fn();
    if (features) data.refetchFeatures = refetch;
    return {
      data: features ? { features: [] } : { fields: data.fields },
      error: features ? data.featuresError : null,
      isLoading: false,
      refetch,
    };
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));

import CustomFieldsPage from '@/app/tenant/settings/custom-fields/page';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(deleteResult: Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    if (init?.method === 'DELETE') return deleteResult;
    return resp({});
  }));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<CustomFieldsPage />, { wrapper });
}

beforeEach(() => { vi.clearAllMocks(); data.featuresError = null; data.refetchFeatures = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: custom-field mutations surface failures', () => {
  it('a refused delete shows the server error instead of silently succeeding', async () => {
    mount(resp({ error: 'Field is referenced by automation rules' }, false, 409));
    await waitFor(() => expect(screen.getByTitle('Delete')).toBeTruthy());
    screen.getByTitle('Delete').click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Field is referenced by automation rules'));
  });

  it('a successful delete shows no error', async () => {
    mount(resp({ deleted: true }));
    await waitFor(() => expect(screen.getByTitle('Delete')).toBeTruthy());
    screen.getByTitle('Delete').click();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      c => String(c[0]).includes('custom-fields?fieldId=F1'),
    )).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('#3408: custom-fields features panel distinguishes a failed read from no features', () => {
  it('names the failed read instead of silently hiding the panel', async () => {
    data.featuresError = new Error('Request failed (503)');
    mount(resp({}));
    await waitFor(() => expect(screen.getByText(/Active Features could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('Active Features (auto-registered)')).toBeNull();
  });

  it('re-runs the features read from the retry button', async () => {
    data.featuresError = new Error('Request failed (503)');
    mount(resp({}));
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
    screen.getByRole('button', { name: /try again/i }).click();
    expect(data.refetchFeatures).toHaveBeenCalled();
  });

  it('a healthy empty read shows no alert', async () => {
    mount(resp({}));
    await waitFor(() => expect(screen.getByTitle('Delete')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
