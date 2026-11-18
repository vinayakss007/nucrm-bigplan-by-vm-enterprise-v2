// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed dashboard stats read used to become count=0, rendering the
 * "no contacts yet" onboarding screen over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardClient from '@/components/tenant/dashboard-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(stats: Response, layout: Response = resp({ layout: [] })) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    (String(input).includes('stats/contacts') ? stats : layout));
  render(<DashboardClient tenantId="t1" userId="u1" planName="pro" isAdmin={false} />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: dashboard distinguishes a failed stats read from an empty workspace', () => {
  it('a refused stats read shows an error, not "Add your first contact"', async () => {
    mount(resp({ error: 'stats offline' }, false, 500));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Could not load dashboard data');
    expect(screen.getByRole('alert').textContent).toContain('stats offline');
    expect(screen.queryByText('Add your first contact')).toBeNull();
  });

  it('a genuine zero still shows the onboarding empty state', async () => {
    mount(resp({ data: { count: 0, companyCount: 0 } }));
    await waitFor(() => expect(screen.getByText('Add your first contact')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a non-empty result still renders the widget grid', async () => {
    mount(resp({ data: { count: 2, companyCount: 1 } }));
    await waitFor(() => expect(screen.queryByText('Add your first contact')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
