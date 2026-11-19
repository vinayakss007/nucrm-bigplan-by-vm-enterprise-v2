// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed superadmin audit fetch used to clear `logs` and `total`
 * to 0, rendering "No audit events match your filters" over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AuditLogClient from '@/components/superadmin/audit-log-client';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aLog = {
  id: 'L1', action: 'tenant.created', target_type: 'tenant', target_id: 'T1',
  created_at: '2026-11-18T00:00:00Z', user_name: 'Super Admin', details: null,
};
const empty = { data: [], total: 0, limit: 50, offset: 0 };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: superadmin audit log distinguishes a failed fetch from an empty result', () => {
  it('a failed fetch shows an error, not "No audit events match your filters"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<AuditLogClient />);
    await waitFor(() => expect(screen.getByText(/Could not load audit events/)).toBeTruthy());
    expect(screen.queryByText('No audit events match your filters')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(empty)));
    render(<AuditLogClient />);
    await waitFor(() => expect(screen.getByText('No audit events match your filters')).toBeTruthy());
    expect(screen.queryByText(/Could not load audit events/)).toBeNull();
  });

  it('a successful fetch still renders the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ ...empty, data: [aLog], total: 1 })));
    render(<AuditLogClient />);
    await waitFor(() => expect(screen.getAllByText('tenant.created').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Could not load audit events/)).toBeNull();
  });
});
