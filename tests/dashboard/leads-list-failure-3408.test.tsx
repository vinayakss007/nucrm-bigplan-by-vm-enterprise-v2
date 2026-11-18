// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — a failed leads load only logged to console and rendered the normal
 * "No leads yet / Start building your pipeline" empty state over an outage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/leads',
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LeadsClientNew from '@/components/tenant/leads-client-new';

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

function mount(leadResponse: Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) =>
    String(input).includes('/api/tenant/leads?') ? leadResponse : resp({ data: [] })));
  render(<LeadsClientNew
    permissions={{ canCreate: true, canEdit: true, canDelete: true }}
    teamMembers={[]} companies={[]} contacts={[]} stats={[]} sources={[]}
    tenantId="t1" userId="u1"
  />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('#3408: leads list distinguishes a failed load from an empty pipeline', () => {
  it('a refused load shows an explicit error, not the empty pipeline prompt', async () => {
    mount(resp({ error: 'leads offline' }, false, 500));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Could not load leads');
    expect(screen.queryByText('Start building your pipeline')).toBeNull();
  });

  it('a genuine empty pipeline still shows the normal prompt', async () => {
    mount(resp({ data: [], total: 0 }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('No leads yet')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
