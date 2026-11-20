// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed progress read used to render "0/5 steps completed" with a
 * 0% bar and every step unchecked: a claim about the tenant derived from a
 * request that never answered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import OnboardingChecklist from '@/components/tenant/onboarding-checklist';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: onboarding checklist distinguishes a failed progress read from no progress', () => {
  it('a failed read shows an error, not "0/5 steps completed"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<OnboardingChecklist />);
    await waitFor(() => expect(screen.getByText(/Progress could not be loaded/)).toBeTruthy());
    expect(screen.queryByText(/0\/5 steps completed/)).toBeNull();
  });

  it('a genuine zero-progress result still shows the normal count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ completed: [] })));
    render(<OnboardingChecklist />);
    await waitFor(() => expect(screen.getByText('0/5 steps completed')).toBeTruthy());
    expect(screen.queryByText(/Progress could not be loaded/)).toBeNull();
  });

  it('a successful read still shows the real count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ completed: ['contact', 'deal'] })));
    render(<OnboardingChecklist />);
    await waitFor(() => expect(screen.getByText('2/5 steps completed')).toBeTruthy());
    expect(screen.queryByText(/Progress could not be loaded/)).toBeNull();
  });
});
