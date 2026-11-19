// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed /me read left isAdmin false, silently hiding admin-only
 * settings with no indication that the read had failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/tenant/settings/general' }));
vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));

import SettingsNav from '@/components/tenant/settings/settings-nav';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: settings nav distinguishes a failed admin read from a non-admin', () => {
  it('a failed read warns that admin-only settings may be hidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<SettingsNav />);
    await waitFor(() => expect(screen.getByText(/Admin status could not be read/)).toBeTruthy());
  });

  it('a successful non-admin read does not show the warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ is_admin: false })));
    render(<SettingsNav />);
    await waitFor(() => expect(screen.queryByText(/Admin status could not be read/)).toBeNull());
  });

  it('a successful admin read does not show the warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ is_admin: true })));
    render(<SettingsNav />);
    await waitFor(() => expect(screen.queryByText(/Admin status could not be read/)).toBeNull());
  });
});
