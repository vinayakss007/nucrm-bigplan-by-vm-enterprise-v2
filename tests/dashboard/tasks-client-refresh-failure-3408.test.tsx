// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed tasks refresh was silently ignored, rendering "All caught
 * up!" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const reloadState = vi.hoisted(() => ({ reload: (async () => {}) as () => Promise<void> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/undo', () => ({ showUndoToast: vi.fn() }));
vi.mock('@/lib/use-delete-with-undo', () => ({
  useDeleteWithUndo: (_entity: string, reload: () => Promise<void>) => {
    reloadState.reload = reload;
    return { deleteEntity: vi.fn() };
  },
}));

import TenantTasksClient from '@/components/tenant/tasks-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aTask = { id: 'T1', title: 'Buy milk', completed: false, priority: 'medium' };
const mount = (initialTasks = [aTask]) => render(
  <TenantTasksClient
    initialTasks={initialTasks} contacts={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true, canAssign: true }}
  />,
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: tasks client distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an error, not "All caught up!"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    mount();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText(/Could not refresh tasks/)).toBeTruthy());
    expect(screen.queryByText('All caught up!')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    mount([]);
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('All caught up!')).toBeTruthy());
    expect(screen.queryByText(/Could not refresh tasks/)).toBeNull();
  });

  it('a successful refresh renders the new task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [{ id: 'T2', title: 'New task', completed: false, priority: 'low' }] })));
    mount();
    await act(async () => { await reloadState.reload(); });
    await waitFor(() => expect(screen.getByText('New task')).toBeTruthy());
    expect(screen.queryByText(/Could not refresh tasks/)).toBeNull();
  });
});
