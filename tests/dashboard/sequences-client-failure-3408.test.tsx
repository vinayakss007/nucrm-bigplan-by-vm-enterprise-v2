// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — after saving a sequence, a refused reload used to do
 * `setSequencesList(data.data || [])`, wiping the list into "No sequences yet".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/tenant/sequence-builder', () => ({
  SequenceBuilder: ({ onSave }: { onSave: (data: { name: string }) => Promise<void> }) => (
    <button onClick={() => { void onSave({ name: 'New sequence' }); }}>Save sequence</button>
  ),
}));

import SequencesClient from '@/components/tenant/sequences-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aSequence = {
  id: 'S1', name: 'Welcome flow', description: null, status: 'active', created_at: '2026-11-18T00:00:00Z',
};
const mount = () => render(
  <SequencesClient
    sequences={[aSequence]} recentEnrollments={[]}
    permissions={{ canView: true, canManage: true }} tenantId="T1" userId="U1"
  />,
);

function stubFetch(reloadResponse: Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') return resp({ data: { id: 'S2' } });
    return reloadResponse;
  });
}

async function saveSequence() {
  fireEvent.click(screen.getByRole('button', { name: 'New Sequence' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save sequence' }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('#3408: sequences list distinguishes a failed reload from an empty list', () => {
  it('a failed post-save reload shows an error and keeps the existing sequences', async () => {
    stubFetch(resp({ error: 'offline' }, false, 500));
    mount();
    await saveSequence();
    await waitFor(() => expect(screen.getByText(/Could not load sequences/)).toBeTruthy());
    expect(screen.getByText('Welcome flow')).toBeTruthy();
    expect(screen.queryByText('No sequences yet')).toBeNull();
  });

  it('a successful reload updates the list without an error', async () => {
    stubFetch(resp({ data: [] }));
    mount();
    await saveSequence();
    await waitFor(() => expect(screen.getByText('No sequences yet')).toBeTruthy());
    expect(screen.queryByText(/Could not load sequences/)).toBeNull();
  });
});
