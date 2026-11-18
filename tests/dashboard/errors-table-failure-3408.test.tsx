// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed error-log refresh used to set errors=[], total=0, and the
 * empty state declared "All systems operational" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ErrorsDataTable from '@/components/superadmin/errors-data-table';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const anError = {
  id: 'E1', level: 'error', message: 'something broke', code: 'X1', service: 'api',
  stack_trace: null, user_email: null, tenant_name: null, resolved: false,
  resolved_at: null, resolved_by: null, created_at: '2026-11-18T00:00:00Z',
};

function mount(initialErrors: typeof anError[], unresolved = 1) {
  render(<ErrorsDataTable
    initialErrors={initialErrors}
    summary={{ total: initialErrors.length, unresolved, fatal: 0, error: 0, warning: 0, info: 0 }}
  />);
}

async function triggerReload() {
  fireEvent.change(screen.getByPlaceholderText('Search errors by message or code...'), {
    target: { value: 'needle' },
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: error log distinguishes a failed refresh from an all-clear', () => {
  it('a failed refresh shows an error banner and keeps the previous rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'log offline' }, false, 500)));
    mount([anError]);
    await triggerReload();
    await waitFor(() => expect(screen.getByText(/Could not load the error log/)).toBeTruthy());
    // The failed read must not flip the table into its all-clear empty state.
    expect(screen.queryByText('All systems operational')).toBeNull();
  });

  it('a failed refresh over an empty log does not claim all systems operational', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'log offline' }, false, 500)));
    mount([], 0);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('Error log unavailable')).toBeTruthy());
    expect(screen.queryByText('All systems operational')).toBeNull();
  });

  it('a genuine empty log still shows the all-clear', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ errors: [], summary: { total: 0, unresolved: 0 } })));
    mount([], 0);
    await triggerReload();
    await waitFor(() => expect(screen.getByText('All systems operational')).toBeTruthy());
    expect(screen.queryByText(/Could not load the error log/)).toBeNull();
  });
});
