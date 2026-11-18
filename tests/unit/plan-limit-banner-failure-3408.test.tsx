// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed usage-status read used to render nothing, indistinguishable
 * from "no quota warnings apply".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PlanLimitBanner from '@/components/tenant/plan-limit-banner';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: plan-limit banner distinguishes a failed read', () => {
  it('a refused usage read shows an explicit warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'usage offline' }, false, 500)));
    render(<PlanLimitBanner />);
    await waitFor(() => expect(screen.getByText(/Could not verify your workspace usage/)).toBeTruthy());
  });

  it('a healthy response with no warnings still renders nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({
      data: { workspace_status: 'active', trial_days_left: null, max_contacts: 1000, current_contacts: 2 },
    })));
    render(<PlanLimitBanner />);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByText(/Could not verify your workspace usage/)).toBeNull();
    expect(screen.queryByText(/Contact limit/)).toBeNull();
  });

  it('a genuine quota warning still renders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({
      data: { workspace_status: 'active', trial_days_left: null, max_contacts: 10, current_contacts: 10 },
    })));
    render(<PlanLimitBanner />);
    await waitFor(() => expect(screen.getByText(/Contact limit reached/)).toBeTruthy());
    expect(screen.queryByText(/Could not verify your workspace usage/)).toBeNull();
  });
});
