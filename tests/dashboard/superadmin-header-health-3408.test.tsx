// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the superadmin header used `stats?.open_errors ?? 0`, so a missing
 * stats payload rendered a green "All Systems OK" badge over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import SuperAdminHeader from '@/components/superadmin/header';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(stats: { open_errors?: number; active_tenants?: number; total_tenants?: number } | null) {
  render(<SuperAdminHeader
    profile={{ full_name: 'Admin', email: 'a@b.c' }}
    stats={stats as never}
    onToggleSidebar={() => {}}
  />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: superadmin header health badge', () => {
  it('a missing stats payload says health is unavailable, not "All Systems OK"', () => {
    mount(null);
    expect(screen.getByText('Health Unavailable')).toBeTruthy();
    expect(screen.queryByText('All Systems OK')).toBeNull();
  });

  it('a genuine zero-error payload still shows "All Systems OK"', () => {
    mount({ open_errors: 0, active_tenants: 2, total_tenants: 3 });
    expect(screen.getByText('All Systems OK')).toBeTruthy();
    expect(screen.queryByText('Health Unavailable')).toBeNull();
  });

  it('a real error count is still reported', () => {
    mount({ open_errors: 3, active_tenants: 2, total_tenants: 3 });
    expect(screen.getByText('3 Open Errors')).toBeTruthy();
  });

  it('a refused sign-out does not navigate as if it succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'session unchanged' }, false, 500)));
    mount(null);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('session unchanged'));
    expect(push).not.toHaveBeenCalledWith('/auth/login');
  });
});
