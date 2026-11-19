// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed audit-log fetch used to clear `logs` and `total` to 0,
 * rendering "No audit events match your filters" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AuditLogClient from '@/components/tenant/settings/audit-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aLog = {
  id: 'L1', action: 'create', resource_type: 'deal', resource_id: 'D1',
  created_at: '2026-11-18T00:00:00Z', ip_address: null, old_data: null,
  new_data: null, full_name: 'Audit Tester', email: 'audit@test.io', user_id: 'U1',
  field_changes: [],
};
const renderClient = () => render(<AuditLogClient />);

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: audit log distinguishes a failed fetch from an empty result', () => {
  it('a failed fetch shows an error, not "No audit events match your filters"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    renderClient();
    await waitFor(() => expect(screen.getByText(/Could not load audit events/)).toBeTruthy());
    expect(screen.queryByText('No audit events match your filters')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ logs: [], total: 0, limit: 50, offset: 0 })));
    renderClient();
    await waitFor(() => expect(screen.getByText('No audit events match your filters')).toBeTruthy());
    expect(screen.queryByText(/Could not load audit events/)).toBeNull();
  });

  it('a successful fetch still renders the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ logs: [aLog], total: 1, limit: 50, offset: 0 })));
    renderClient();
    await waitFor(() => expect(screen.getByText('Audit Tester')).toBeTruthy());
    expect(screen.queryByText(/Could not load audit events/)).toBeNull();
  });
});
