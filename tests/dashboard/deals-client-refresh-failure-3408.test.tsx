// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed deals refresh was silently ignored, and an empty list would
 * render "Your pipeline is empty" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const reloadState = vi.hoisted(() => ({ reload: (async () => {}) as () => Promise<void> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/use-delete-with-undo', () => ({
  useDeleteWithUndo: (_entity: string, reload: () => Promise<void>) => {
    reloadState.reload = reload;
    return { deleteEntity: vi.fn() };
  },
}));

import TenantDealsClient from '@/components/tenant/deals-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aDeal = { id: 'D1', title: 'Big deal', value: 1000, stage: 'lead' };
const mount = (initialDeals = [aDeal]) => render(
  <TenantDealsClient
    initialDeals={initialDeals} contacts={[]} companies={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
  />,
);

function switchToListView() {
  const listButton = screen.getAllByRole('button').find(b => b.querySelector('.lucide-list'));
  if (listButton) fireEvent.click(listButton);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: deals client distinguishes a failed refresh from an empty pipeline', () => {
  it('a failed refresh shows an error, not "Your pipeline is empty"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    switchToListView();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText(/Could not refresh deals/)).toBeTruthy());
    expect(screen.queryByText('Your pipeline is empty')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount([]);
    switchToListView();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('Your pipeline is empty')).toBeTruthy());
    expect(screen.queryByText(/Could not refresh deals/)).toBeNull();
  });

  it('a successful refresh renders the new deal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [{ id: 'D2', title: 'New deal', value: 50, stage: 'lead' }] })));
    mount();
    switchToListView();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('New deal')).toBeTruthy());
    expect(screen.queryByText(/Could not refresh deals/)).toBeNull();
  });
});
