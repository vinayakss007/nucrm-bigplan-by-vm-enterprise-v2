// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a refused forecast read used to render "No forecast for this deal
 * yet", the same text as a deal that genuinely has no forecast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import DealForecast from '@/components/tenant/deal-forecast';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aForecast = {
  id: 'F1', predictedCloseDate: '2026-12-01', winProbability: '75',
  predictedValue: '50000', confidenceLevel: 'high',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: deal forecast distinguishes a failed read from no forecast', () => {
  it('a failed read shows an error, not "No forecast for this deal yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<DealForecast dealId="D1" />);
    await waitFor(() => expect(screen.getByText(/Forecast could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No forecast for this deal yet')).toBeNull();
  });

  it('a genuine null forecast still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: null })));
    render(<DealForecast dealId="D1" />);
    await waitFor(() => expect(screen.getByText('No forecast for this deal yet')).toBeTruthy());
    expect(screen.queryByText(/Forecast could not be loaded/)).toBeNull();
  });

  it('a successful read still renders the forecast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: aForecast })));
    render(<DealForecast dealId="D1" />);
    await waitFor(() => expect(screen.getByText('75%')).toBeTruthy());
    expect(screen.queryByText(/Forecast could not be loaded/)).toBeNull();
  });
});
