// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the mobile settings picker silently hid admin-only settings when
 * the /me admin check failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/tenant/settings/general' }));

import SettingsMobilePicker from '@/components/tenant/settings/settings-mobile-picker';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy());
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: mobile settings picker distinguishes a failed admin read from a non-admin', () => {
  it('a failed read warns that admin-only settings may be hidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<SettingsMobilePicker />);
    await openSheet();
    await waitFor(() => expect(screen.getByText(/Admin status could not be read/)).toBeTruthy());
  });

  it('a successful non-admin read does not show the warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ is_admin: false })));
    render(<SettingsMobilePicker />);
    await openSheet();
    await waitFor(() => expect(screen.queryByText(/Admin status could not be read/)).toBeNull());
  });
});
