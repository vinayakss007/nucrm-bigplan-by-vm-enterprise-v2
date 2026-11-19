// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed offerings load used to leave the superadmin plan panel
 * blank, indistinguishable from a plan with no module offerings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import PlanOfferingsPanel from '@/components/superadmin/plan-offerings-panel';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const anOffering = {
  module_id: 'M1', name: 'CRM', category: 'sales', icon: 'C',
  description: 'Contacts', enabled: true, price: 10, is_overridden: false,
};
const renderPanel = () => render(
  <PlanOfferingsPanel planId="P1" planName="Pro" onClose={vi.fn()} />,
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: plan offerings panel surfaces a failed load', () => {
  it('a failed load shows an explicit error instead of a blank panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Could not load module offerings/)).toBeTruthy());
    expect(screen.getByText('Module offerings could not be loaded.')).toBeTruthy();
  });

  it('a genuine empty result does not show the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ offerings: [] })));
    renderPanel();
    await waitFor(() => expect(screen.queryByText(/Could not load module offerings/)).toBeNull());
  });

  it('a successful load still renders the offerings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ offerings: [anOffering] })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('CRM')).toBeTruthy());
    expect(screen.queryByText(/Could not load module offerings/)).toBeNull();
  });
});
