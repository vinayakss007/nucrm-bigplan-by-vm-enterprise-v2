// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed superadmin search used to set results=[], which rendered
 * as "no matches" instead of a failed request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/components/superadmin/use-dashboard-panels', () => ({
  useDashboardPanels: () => ({
    healthChecks: [], healthLoading: false, healthFailed: false,
    revenueData: null, usageData: null, activity: [], activityLoading: false,
  }),
}));

import SuperAdminDashboardClient from '@/components/superadmin/superadmin-dashboard-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(result: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => result));
  render(<SuperAdminDashboardClient
    stats={{}} recentTenants={[]} recentErrors={[]} expiringSoon={[]} userName="Admin" />);
}

async function search() {
  fireEvent.change(screen.getByPlaceholderText('Search tenants, users...'), { target: { value: 'acme' } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: superadmin search distinguishes failure from no matches', () => {
  it('a refused search shows an error affordance, not an empty dropdown', async () => {
    mount(resp({ error: 'search index offline' }, false, 500));
    await search();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Search failed: search index offline');
  });

  it('an HTML gateway error also surfaces a failure', async () => {
    mount({ ok: false, status: 502, json: async () => { throw new SyntaxError('<html>'); } } as unknown as Response);
    await search();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Search failed:');
  });

  it('a genuine zero-match search shows no error', async () => {
    mount(resp({ results: [] }));
    await search();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
