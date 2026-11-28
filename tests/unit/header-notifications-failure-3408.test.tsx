// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the header's notification chrome must not claim "All caught up!" on
 * a failed load, nor mark items read locally when the server refused the write.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), pathname: '/tenant' }),
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/components/shared/bug-report-button', () => ({ default: () => null }));
vi.mock('@/lib/use-notifications', () => ({
  useNotifications: () => ({ unreadCount: 2, connected: true, transport: 'socket' }),
}));
vi.mock('@/lib/i18n/provider', () => ({
  useTranslation: () => ({ locale: 'en', setLocale: vi.fn(), locales: { en: 'English' }, t: (k: string) => k }),
}));

import TenantHeader from '@/components/tenant/layout/header';
import type { TenantInfo, ProfileInfo } from '@/components/tenant/layout/types';

const tenant = { primary_color: '#7c3aed' } as unknown as TenantInfo;
const profile = { full_name: 'Test User', email: 't@t.com' } as unknown as ProfileInfo;
const notification = { id: 'n1', type: 'alert', title: 'Test notice', createdAt: '2026-11-18T00:00:00Z' };

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(handlers: { unread?: () => Promise<unknown>; list?: () => Promise<unknown>; patch?: () => Promise<unknown> } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') return (handlers.patch?.() ?? Promise.resolve(resp({ ok: true }))) as Promise<Response>;
    if (url.includes('/unread')) return (handlers.unread?.() ?? Promise.resolve(resp({ count: 2 }))) as Promise<Response>;
    return (handlers.list?.() ?? Promise.resolve(resp({ data: [notification] }))) as Promise<Response>;
  }));
  render(<TenantHeader tenant={tenant} profile={profile} roleSlug="admin" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('#3408: header notifications distinguish failure from empty', () => {
  it('a failed load shows an error instead of "All caught up!"', async () => {
    mount({
      unread: async () => resp({ error: 'notifications offline' }, false, 500),
      list: async () => resp({ error: 'notifications offline' }, false, 500),
    });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not refresh notifications'));
    expect(screen.queryByText('All caught up!')).toBeNull();
  });

  it('a refused mark-all-read keeps the unread badge and shows an error', async () => {
    mount({ patch: async () => resp({ error: 'write refused' }, false, 500) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not mark all read'));
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy();
  });

  it('a successful mark-all-read still clears the badge', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
