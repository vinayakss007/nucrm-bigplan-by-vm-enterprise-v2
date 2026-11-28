// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed pipelines read was rewritten to `{ data: [] }`, so the
 * convert dialog silently offered no pipeline choices.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LeadDetailClient from '@/components/tenant/lead-detail-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const lead = { id: 'L1', first_name: 'Ada', last_name: 'Lovelace', lead_status: 'new' };
const mount = () => render(
  <LeadDetailClient lead={lead} activities={[]} relatedContacts={[]} teamMembers={[]} tenantId="T1" userId="U1" />,
);
async function openConvert() {
  fireEvent.click(screen.getByRole('button', { name: /Convert/ }));
  await waitFor(() => expect(screen.getByText('Convert lead to contact')).toBeTruthy());
  fireEvent.click(screen.getByLabelText('Create a deal from this lead'));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: lead convert dialog surfaces a failed pipelines read', () => {
  it('a failed read says the options could not be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await openConvert();
    await waitFor(() => expect(screen.getByText(/Pipeline options could not be loaded/)).toBeTruthy());
  });

  it('a genuine empty result does not show the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount();
    await openConvert();
    await waitFor(() => expect(screen.queryByText(/Pipeline options could not be loaded/)).toBeNull());
  });

  it('a successful read still renders the pipeline options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [{ id: 'P1', name: 'Sales' }] })));
    mount();
    await openConvert();
    await waitFor(() => expect(screen.getByText('Sales')).toBeTruthy());
    expect(screen.queryByText(/Pipeline options could not be loaded/)).toBeNull();
  });
});

describe('#3408: lead detail follow-ups distinguish a failed read from an empty list', () => {
  const mountWith = (failed: boolean) => render(
    <LeadDetailClient lead={lead} activities={[]} relatedContacts={[]} teamMembers={[]}
      followUps={[]} followUpsLoadFailed={failed} tenantId="T1" userId="U1" />,
  );

  it('a failed read says so instead of "No follow-ups scheduled" and a "(0 open)" count', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({})));
    mountWith(true);
    expect(screen.getByRole('alert').textContent).toMatch(/Follow-ups could not be loaded/);
    expect(screen.queryByText('No follow-ups scheduled for this lead.')).toBeNull();
    expect(screen.queryByText(/\(0 open\)/)).toBeNull();
  });

  it('a genuine empty list still shows the normal empty state', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({})));
    mountWith(false);
    expect(screen.getByText('No follow-ups scheduled for this lead.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
