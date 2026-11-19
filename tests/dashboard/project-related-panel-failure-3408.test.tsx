// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed related-records refresh used to render
 * "No leads, contacts, companies or deals linked yet." (the same text as a
 * genuinely empty project) over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ProjectRelatedPanel from '@/components/tenant/project-related-panel';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;
const aRecord = {
  linkId: 'L1', relation: 'lead', entityType: 'lead', entityId: 'LEAD1', label: 'Acme lead',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: project related-records panel distinguishes a failed load from an empty list', () => {
  it('a failed load shows an error instead of "No ... linked yet"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    render(<ProjectRelatedPanel projectId="P1" />);
    await waitFor(() => expect(screen.getByText(/Could not load related records/)).toBeTruthy());
    expect(screen.queryByText('No leads, contacts, companies or deals linked yet.')).toBeNull();
  });

  it('a failed load keeps a previously loaded list on screen', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(resp({ data: [aRecord] }))
      .mockResolvedValue(resp({ error: 'offline' }, false, 500)));
    const { rerender } = render(<ProjectRelatedPanel projectId="P1" />);
    await waitFor(() => expect(screen.getByText('Acme lead')).toBeTruthy());
    // a changed id triggers a later refresh whose request is refused
    rerender(<ProjectRelatedPanel projectId="P2" />);
    await waitFor(() => expect(screen.getByText(/Could not load related records/)).toBeTruthy());
    expect(screen.queryByText('No leads, contacts, companies or deals linked yet.')).toBeNull();
  });

  it('a genuine empty result still shows the normal empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ data: [] })));
    render(<ProjectRelatedPanel projectId="P1" />);
    await waitFor(() => expect(screen.getByText('No leads, contacts, companies or deals linked yet.')).toBeTruthy());
    expect(screen.queryByText(/Could not load related records/)).toBeNull();
  });
});
