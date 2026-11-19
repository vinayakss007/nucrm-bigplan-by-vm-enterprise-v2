// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — after creating a deal, a refused board refresh used to do
 * `setDeals(refreshData.data ?? [])`, wiping the board to "0 deals" and making
 * the just-created deal (and all existing ones) vanish.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-open-create-param', () => ({ useOpenCreateParam: () => {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import DealsKanban from '@/components/tenant/deals-kanban';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aDeal = {
  id: 'D1', title: 'Existing deal', amount: 1000, stageId: 'lead', stage_name: 'lead',
  close_date: null, contact_id: null, company_id: null, first_name: null, last_name: null,
  company_name: null, assigned_to: null, created_at: '2026-11-18T00:00:00Z',
};
const stage = { id: 'lead', name: 'Lead', order: 1, pipelineId: 'P1' };
const mount = () => render(
  <DealsKanban
    initialDeals={[aDeal]} stages={[stage]} contacts={[]} companies={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
  />,
);

async function createDeal() {
  fireEvent.click(screen.getByRole('button', { name: /Add Deal/i }));
  fireEvent.change(screen.getByPlaceholderText('e.g., Enterprise Deal - Acme Inc'), {
    target: { value: 'New deal' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Create Deal' }).closest('form')!);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: deals board distinguishes a failed refresh from an empty board', () => {
  it('a failed post-create refresh shows an error and keeps the existing deals', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(resp({ data: { id: 'D2' } }))
      .mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await createDeal();
    await waitFor(() => expect(screen.getByText(/Could not refresh deals/)).toBeTruthy());
    expect(screen.getAllByText('Existing deal').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 deals ·/)).toBeTruthy();
  });

  it('a successful refresh updates the board without an error', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(resp({ data: { id: 'D2' } }))
      .mockResolvedValue(resp({ data: [] })));
    mount();
    await createDeal();
    await waitFor(() => expect(screen.queryByText(/Could not refresh deals/)).toBeNull());
    expect(screen.getByText(/0 deals ·/)).toBeTruthy();
  });
});
