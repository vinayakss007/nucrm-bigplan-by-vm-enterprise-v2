// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the selective-restore wizard must not turn a refused step into a
 * valid-looking preview screen. These tests drive the real component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

const data = vi.hoisted(() => ({
  backup: {
    id: 'B1', file_name: 'dump.custom', file_size: 1024, file_size_formatted: '1 KB',
    backup_type: 'full', parse_status: 'completed', total_record_count: 5,
    tables_available: ['contacts'],
    tenants_included: [{ tenant_id: 'T1', tenant_name: 'Acme', total_records: 5,
      tables: ['contacts'], record_counts: { contacts: 5 } }],
    uploaded_at: '2026-11-18T00:00:00Z',
  },
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (key: readonly string[]) => ({
    data: key.includes('backups') ? { backups: [data.backup] } : { logs: [] },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('@/lib/errors-client', () => ({ logError: vi.fn() }));

import SelectiveRestorePage from '@/app/superadmin/selective-restore/page';

const resp = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;
const failBody = (message: string) => resp({ error: message }, false, 500);

function stub(handlers: Record<string, () => Promise<unknown>>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(handlers).find(k => url.includes(k));
    return (key ? handlers[key]() : Promise.resolve(resp({}))) as Promise<Response>;
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SelectiveRestorePage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: selective restore step failures are not rendered as previews', () => {
  it('a refused preview does not advance the wizard', async () => {
    stub({ '/preview': async () => failBody('backup not parsed') });
    renderPage();
    screen.getByRole('button', { name: 'Preview' }).click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Preview failed: backup not parsed'));
    expect(screen.queryByText('Backup: dump.custom')).toBeNull();
  });

  it('a refused tenant-user load says so instead of showing no users', async () => {
    stub({
      '/preview': async () => resp({ ok: true }),
      '/users': async () => failBody('tenant lookup failed'),
    });
    renderPage();
    screen.getByRole('button', { name: 'Preview' }).click();
    await waitFor(() => expect(screen.getByText('Backup: dump.custom')).toBeTruthy());
    screen.getByText('Acme').click();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Could not load tenant users — an empty list here would be a lie'));
  });

  it('a refused scope preview never shows a restore scope', async () => {
    stub({
      '/preview': async () => resp({ ok: true }),
      '/users': async () => resp({ users: [{ id: 'U1', fullName: 'Ada', email: 'ada@x.io', role: 'admin' }] }),
      '/scope': async () => failBody('scope refused'),
    });
    renderPage();
    screen.getByRole('button', { name: 'Preview' }).click();
    await waitFor(() => expect(screen.getByText('Backup: dump.custom')).toBeTruthy());
    screen.getByText('Acme').click();
    await waitFor(() => expect(screen.getByText('All Users (Full Tenant Restore)')).toBeTruthy());
    screen.getByText('All Users (Full Tenant Restore)').click();
    await waitFor(() => expect(screen.getByRole('button', { name: /contacts/ })).toBeTruthy());
    screen.getByRole('button', { name: /contacts/ }).click();
    // Wait for React to flush the selection before clicking the gated button.
    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Preview Scope' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    screen.getByRole('button', { name: 'Preview Scope' }).click();
    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith('Scope preview failed: scope refused'),
      { timeout: 5000 },
    );
    expect(screen.queryByText('Restore Scope Preview')).toBeNull();
  });
});
