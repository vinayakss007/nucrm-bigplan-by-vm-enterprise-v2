/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/usage/tracker', () => ({
  getUsageReport: vi.fn(),
  recordViolation: vi.fn(),
}));
vi.mock('@/lib/usage/notifications', () => ({
  notifyLimitHit: vi.fn(() => Promise.resolve()),
}));
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: any, init?: any) => ({
      _body: body,
      _status: init?.status ?? 200,
      json: async () => body,
    })),
  },
}));

import { checkLimit } from '@/lib/usage/middleware';
import { getUsageReport, recordViolation } from '@/lib/usage/tracker';
import { notifyLimitHit } from '@/lib/usage/notifications';

function ctx(overrides: Partial<any> = {}) {
  return {
    userId: 'u1',
    tenantId: 't1',
    roleSlug: 'user',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply mock implementation for notifyLimitHit since clearAllMocks resets it
  vi.mocked(notifyLimitHit).mockImplementation(() => Promise.resolve());
});

describe('checkLimit', () => {
  it('returns null for super admins', async () => {
    const result = await checkLimit(ctx({ isSuperAdmin: true }), 'contacts');
    expect(result).toBeNull();
    expect(getUsageReport).not.toHaveBeenCalled();
  });

  it('returns null when tenantId is missing', async () => {
    const result = await checkLimit(ctx({ tenantId: undefined }), 'contacts');
    expect(result).toBeNull();
  });

  it('returns null when tenantId is __superadmin_no_tenant__', async () => {
    const result = await checkLimit(ctx({ tenantId: '__superadmin_no_tenant__' }), 'contacts');
    expect(result).toBeNull();
  });

  it('returns null when usage not exceeded', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'contacts',
      actual: 5,
      limit: 10,
      exceeded: false,
    });
    const result = await checkLimit(ctx(), 'contacts');
    expect(result).toBeNull();
  });

  it('returns null when limit is null (unlimited)', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'contacts',
      actual: 100,
      limit: null,
      exceeded: true,
    });
    const result = await checkLimit(ctx(), 'contacts');
    expect(result).toBeNull();
  });

  it('returns null when enforcement is off (default)', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'contacts',
      actual: 15,
      limit: 10,
      exceeded: true,
    });
    vi.mocked(recordViolation).mockResolvedValue({ created: false });
    const result = await checkLimit(ctx(), 'contacts');
    expect(result).toBeNull();
    expect(recordViolation).toHaveBeenCalledWith('t1', 'contacts', 10, 15);
  });

  it('returns 402 response when enforcement is on', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'contacts',
      actual: 15,
      limit: 10,
      exceeded: true,
    });
    vi.mocked(recordViolation).mockResolvedValue({ created: true });
    const result = await checkLimit(ctx(), 'contacts', { enforce: true });
    expect(result).not.toBeNull();
    expect(result._status).toBe(402);
    expect(result._body.error).toContain('contacts');
    expect(result._body.kind).toBe('contacts');
    expect(result._body.upgradeUrl).toBe('/tenant/settings/billing');
  });

  it('calls notifyLimitHit when violation is newly created', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'deals',
      actual: 20,
      limit: 15,
      exceeded: true,
    });
    vi.mocked(recordViolation).mockResolvedValue({ created: true });
    await checkLimit(ctx(), 'deals', { enforce: false });
    expect(notifyLimitHit).toHaveBeenCalledWith({
      tenantId: 't1',
      kind: 'deals',
      limit: 15,
      actual: 20,
    });
  });

  it('does not call notifyLimitHit when violation already exists', async () => {
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'deals',
      actual: 20,
      limit: 15,
      exceeded: true,
    });
    vi.mocked(recordViolation).mockResolvedValue({ created: false });
    await checkLimit(ctx(), 'deals', { enforce: true });
    expect(notifyLimitHit).not.toHaveBeenCalled();
  });

  it('opts.enforce overrides env USAGE_LIMITS', async () => {
    process.env['USAGE_LIMITS'] = 'on';
    vi.mocked(getUsageReport).mockResolvedValue({
      kind: 'contacts',
      actual: 15,
      limit: 10,
      exceeded: true,
    });
    vi.mocked(recordViolation).mockResolvedValue({ created: false });
    const result = await checkLimit(ctx(), 'contacts', { enforce: false });
    expect(result).toBeNull();
    delete process.env['USAGE_LIMITS'];
  });
});
