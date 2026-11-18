// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed projects refresh used to render "No projects yet" over an
 * outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/projects',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ProjectsDataTable from '@/components/tenant/projects-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aProject = {
  id: 'P1', name: 'Website', description: null, status: 'active',
  start_date: null, end_date: null, owner_id: null, owner_name: null,
  task_count: 2, completed_count: 1, created_at: '2026-11-18T00:00:00Z',
};

// More rows than one page so the next-page control is enabled and triggers a reload.
const manyProjects = Array.from({ length: 25 }, (_, i) => ({ ...aProject, id: `P${i}` }));

function mount() {
  render(<ProjectsDataTable
    initialProjects={manyProjects} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
  />);
}

async function triggerReload() {
  await waitFor(() => expect(screen.getByText('Go to next page')).toBeTruthy());
  fireEvent.click(screen.getByText('Go to next page'));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: projects list distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an explicit error, not "No projects yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'projects offline' }, false, 500)));
    mount();
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load projects/)).toBeTruthy());
    expect(screen.queryByText('No projects yet')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount();
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeTruthy());
    expect(screen.queryByText(/Could not load projects/)).toBeNull();
  });
});
