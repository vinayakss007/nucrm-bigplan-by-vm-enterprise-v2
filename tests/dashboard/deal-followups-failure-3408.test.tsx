// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — the deal detail page swallowed a refused follow-ups read with
 * `.catch(() => [])`, so a dead pool or an RLS refusal rendered the panel as
 * "No follow-ups scheduled". An unread page may not state a fact about the
 * tenant's data. The server now passes an explicit `followUpsLoadFailed` flag,
 * and the panel must show a failure affordance instead of the false empty.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/client-logger', () => ({ clientLogError: vi.fn() }));
vi.mock('@/components/documents/documents-panel', () => ({ default: () => null }));
vi.mock('@/components/tenant/deal-related-panel', () => ({ default: () => null }));
vi.mock('@/components/tenant/deal-timeline', () => ({ default: () => null }));
vi.mock('@/components/tenant/deal-forecast', () => ({ default: () => null }));

import DealDetailClient from '@/components/tenant/deal-detail-client';

const baseProps = {
  deal: { id: 'D1', title: 'Renewal' },
  tasks: [],
  activities: [],
  permissions: { canEdit: true, canDelete: false, canViewValue: true },
  tenantId: 'T1',
  userId: 'U1',
};

const mount = (extra: Record<string, unknown> = {}) =>
  render(<DealDetailClient {...baseProps} {...extra} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
});
afterEach(() => vi.restoreAllMocks());

describe('#3408: deal follow-ups distinguish a failed read from an empty list', () => {
  it('a refused read shows an alert, not "No follow-ups scheduled"', () => {
    mount({ followUps: [], followUpsLoadFailed: true });
    expect(screen.getByRole('alert').textContent).toMatch(/Follow-ups could not be loaded/);
    expect(screen.queryByText('No follow-ups scheduled')).toBeNull();
    // The "(0 open)" count is also a false fact when the read failed.
    expect(screen.queryByText('(0 open)')).toBeNull();
  });

  it('the retry re-runs the server read', () => {
    mount({ followUps: [], followUpsLoadFailed: true });
    screen.getByRole('button', { name: /Retry/i }).click();
    expect(refresh).toHaveBeenCalled();
  });

  it('a genuinely empty list still shows the normal empty state', () => {
    mount({ followUps: [], followUpsLoadFailed: false });
    expect(screen.getByText('No follow-ups scheduled')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a successful read still renders its follow-ups', () => {
    mount({
      followUpsLoadFailed: false,
      followUps: [{ id: 'F1', title: 'Send quote', status: 'pending', due_date: '2026-12-01T00:00:00Z' }],
    });
    expect(screen.getByText('Send quote')).toBeTruthy();
    expect(screen.queryByText('No follow-ups scheduled')).toBeNull();
  });
});
