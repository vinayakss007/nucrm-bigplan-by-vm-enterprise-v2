// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed tasks refresh used to render "No tasks yet" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/tasks',
}));
vi.mock('@/hooks/use-open-create-param', () => ({ useOpenCreateParam: () => {} }));

import TasksDataTable from '@/components/tenant/tasks-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aTask = {
  id: 'TK1', title: 'Follow up', description: null, priority: 'high', due_date: null,
  completed: false, completed_at: null, first_name: 'Ada', last_name: 'L',
  deal_title: null, assignee_name: null, created_at: '2026-11-18T00:00:00Z',
};

function mount(initialTasks: typeof aTask[]) {
  render(<TasksDataTable
    initialTasks={initialTasks} contacts={[]} deals={[]} teamMembers={[]}
    permissions={{ canCreate: true, canEdit: true, canDelete: true, canAssign: true }}
  />);
}

function stubByUrl(overrides: Record<string, Response>) {
  const mock = vi.fn().mockImplementation(async (input: string) => {
    const match = Object.keys(overrides).find(k => String(input).includes(k));
    return match ? overrides[match] : resp({ data: [], total: 0, fields: [] });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function triggerReload() {
  fireEvent.change(screen.getByPlaceholderText('Search tasks by title, contact, or deal...'), {
    target: { value: 'needle' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: tasks list distinguishes a failed refresh from an empty list', () => {
  it('a failed refresh shows an explicit error, not "No tasks yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'tasks offline' }, false, 500)));
    mount([aTask]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load tasks/)).toBeTruthy());
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [], total: 0 })));
    mount([]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('No tasks yet')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('#3408: tasks bulk-action options distinguish a failed read from an empty one', () => {
  it('names the failed segments read instead of silently hiding the action', async () => {
    stubByUrl({ '/api/tenant/segments': resp({ error: 'offline' }, false, 500) });
    mount([aTask]);
    await waitFor(() => expect(screen.getByText(/Bulk action options could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/segments/)).toBeTruthy();
  });

  it('names the failed custom-fields read', async () => {
    stubByUrl({ '/api/tenant/custom-fields': resp({ error: 'forbidden' }, false, 403) });
    mount([aTask]);
    await waitFor(() => expect(screen.getByText(/Bulk action options could not be loaded/)).toBeTruthy());
    expect(screen.getByText(/custom fields/)).toBeTruthy();
  });

  it('re-runs the failed option read from the retry button', async () => {
    const mock = stubByUrl({ '/api/tenant/segments': resp({ error: 'offline' }, false, 500) });
    mount([aTask]);
    await waitFor(() => expect(screen.getByText(/Bulk action options could not be loaded/)).toBeTruthy());
    const before = mock.mock.calls.filter(([url]) => String(url).includes('/segments')).length;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => {
      const after = mock.mock.calls.filter(([url]) => String(url).includes('/segments')).length;
      expect(after).toBe(before + 1);
    });
  });

  it('shows no option alert when both reads answer empty', async () => {
    const mock = stubByUrl({});
    mount([aTask]);
    await waitFor(() => expect(mock.mock.calls.filter(([url]) => String(url).includes('/custom-fields')).length).toBe(1));
    expect(screen.queryByText(/Bulk action options could not be loaded/)).toBeNull();
  });
});
