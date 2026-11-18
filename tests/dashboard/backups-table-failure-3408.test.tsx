// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed backup-catalog refresh used to render "No backups found"
 * (with a "Run Backup" prompt) over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BackupsDataTable from '@/components/superadmin/backups-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aBackup = {
  id: 'B1', type: 'full', status: 'completed', size_bytes: 1024, file_path: '/x.bak',
  storage_type: 'local', started_at: '2026-11-18T00:00:00Z', completed_at: '2026-11-18T00:01:00Z',
  error_message: null, created_by: 'admin',
};

function mount(initialBackups: typeof aBackup[]) {
  render(<BackupsDataTable initialBackups={initialBackups} />);
}

async function triggerReload() {
  fireEvent.change(screen.getByPlaceholderText('Search backups...'), { target: { value: 'needle' } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: backup catalog distinguishes a failed refresh from an empty catalog', () => {
  it('a failed refresh shows an error banner, not "No backups found"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'catalog offline' }, false, 500)));
    mount([aBackup]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load backups/)).toBeTruthy());
    expect(screen.queryByText('No backups found')).toBeNull();
  });

  it('a failed refresh over an empty catalog does not prompt to run a first backup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'catalog offline' }, false, 500)));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('Backup list unavailable')).toBeTruthy());
    expect(screen.queryByText('Run your first backup to get started')).toBeNull();
  });

  it('a genuine empty catalog still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No backups found')).toBeTruthy());
    expect(screen.queryByText(/Could not load backups/)).toBeNull();
  });
});
