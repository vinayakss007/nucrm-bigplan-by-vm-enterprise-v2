// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed tenant-modules load used to render the same
 * "No active modules with configurable features" text as a genuinely empty
 * tenant, hiding an outage behind an empty state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import TenantFeaturesPanel from '@/components/superadmin/tenant-features-panel';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aModule = {
  id: 'M1', name: 'CRM', description: 'Contacts', category: 'sales', icon: 'C',
  features: ['create'], status: 'active', forceEnabled: false,
  enabledFeatures: ['create'], planAllowed: true, installedAt: null,
};
const renderPanel = () => render(
  <TenantFeaturesPanel tenantId="T1" tenantName="Acme" plan="pro" onClose={vi.fn()} />,
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: tenant features panel distinguishes a failed load from an empty list', () => {
  it('a failed load shows an error, not "No active modules"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Could not load tenant modules/)).toBeTruthy());
    expect(screen.queryByText('No active modules with configurable features')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('No active modules with configurable features')).toBeTruthy());
    expect(screen.queryByText(/Could not load tenant modules/)).toBeNull();
  });

  it('a successful load renders the modules', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [aModule] })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('CRM')).toBeTruthy());
    expect(screen.queryByText(/Could not load tenant modules/)).toBeNull();
  });
});
