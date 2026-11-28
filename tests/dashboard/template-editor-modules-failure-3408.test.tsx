// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const registry = vi.hoisted(() => ({
  modulesError: null as Error | null,
  refetchModules: vi.fn(),
}));

const template = {
  id: 'tpl-1', name: 'Onboarding', description: '', icon: 'zap', status: 'active',
  modules: [], custom_fields: [], pipelines: [], automations: [],
};

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) => String(url).includes('/modules')
    ? { data: { data: [] }, error: registry.modulesError, isLoading: false, refetch: registry.refetchModules }
    : { data: { data: template }, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, use: () => ({ id: 'tpl-1' }) };
});

import TemplateEditorPage from '@/app/superadmin/templates/[id]/page';

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div>Loading…</div>}>
        <TemplateEditorPage params={Promise.resolve({ id: 'tpl-1' })} />
      </Suspense>
    </QueryClientProvider>,
  );
};

beforeEach(() => { vi.clearAllMocks(); registry.modulesError = null; });
afterEach(() => vi.restoreAllMocks());

describe('#3408: template module picker distinguishes a failed read from no modules', () => {
  it('announces the failed read and offers a retry', async () => {
    registry.modulesError = new Error('Request failed (503)');
    mount();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Module options could not be loaded/));
    screen.getByRole('button', { name: /try again/i }).click();
    expect(registry.refetchModules).toHaveBeenCalledTimes(1);
  });

  it('a healthy empty read shows no alert', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Modules')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
