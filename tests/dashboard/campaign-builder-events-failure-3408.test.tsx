// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed events read was rewritten to `{ data: [] }`, rendering
 * "No events available. Create events first." during an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));

import { CampaignBuilder } from '@/components/lead-warming/campaign-builder';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const anEvent = { id: 'E1', name: 'Birthday', is_system: false };
const mount = () => render(<CampaignBuilder onCreated={vi.fn()} onClose={vi.fn()} />);

async function goToAudience() {
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  await waitFor(() => expect(screen.getByText('Events')).toBeTruthy());
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: campaign builder distinguishes a failed events read from none', () => {
  it('a failed read shows an error, not "No events available"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await goToAudience();
    await waitFor(() => expect(screen.getByText(/Events could not be loaded/)).toBeTruthy());
    expect(screen.queryByText('No events available. Create events first.')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount();
    await goToAudience();
    await waitFor(() => expect(screen.getByText('No events available. Create events first.')).toBeTruthy());
    expect(screen.queryByText(/Events could not be loaded/)).toBeNull();
  });

  it('a successful read still renders the events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [anEvent] })));
    mount();
    await goToAudience();
    await waitFor(() => expect(screen.getByText('Birthday')).toBeTruthy());
    expect(screen.queryByText(/Events could not be loaded/)).toBeNull();
  });
});
