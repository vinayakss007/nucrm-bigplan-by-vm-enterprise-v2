// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed assignment-rules load used to call `setRules([])` in the
 * catch, rendering the same "No assignment rules configured" as a tenant with
 * none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AssignmentConfig from '@/components/tenant/assignment-config';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aRule = {
  id: 'R1', name: 'Round robin leads', type: 'round_robin', config: {},
  isActive: true, priority: 1, entityType: 'lead',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: assignment config distinguishes a failed load from an empty list', () => {
  it('a failed load shows an error, not "No assignment rules configured"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<AssignmentConfig teamMembers={[]} />);
    await waitFor(() => expect(screen.getByText(/Could not load assignment rules/)).toBeTruthy());
    expect(screen.queryByText('No assignment rules configured')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    render(<AssignmentConfig teamMembers={[]} />);
    await waitFor(() => expect(screen.getByText('No assignment rules configured')).toBeTruthy());
    expect(screen.queryByText(/Could not load assignment rules/)).toBeNull();
  });

  it('a successful load still renders the rule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [aRule] })));
    render(<AssignmentConfig teamMembers={[]} />);
    await waitFor(() => expect(screen.getByText('Round robin leads')).toBeTruthy());
    expect(screen.queryByText(/Could not load assignment rules/)).toBeNull();
  });
});
