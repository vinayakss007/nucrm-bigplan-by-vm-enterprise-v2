/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3045 — trial-check counted `expired`/`warned` before the send and wrote the
 * 4-day dedup marker even when the provider rejected the email, so one
 * rejection silently un-warned a trialing tenant for the whole window.
 * sendEmail never throws (it resolves {success:false}), so the old .catch()
 * was dead code. These tests pin the corrected behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CRON_SECRET = 'unit-test-cron-secret-3045';
process.env.CRON_SECRET = CRON_SECRET;

const justExpiredRows: unknown[] = [
  { id: 't-1', name: 'Acme', billingEmail: 'billing@acme.test', ownerId: 'u-1' },
];
const expiringSoonRows: unknown[] = [
  {
    id: 't-2', name: 'Beta', billingEmail: 'ops@beta.test',
    trialEndsAt: new Date(Date.now() + 2 * 86_400_000),
    ownerEmail: null, ownerName: null, ownerId: 'u-2',
  },
];
const ownersRows = [{ id: 't-1', ownerEmail: 'owner@acme.test', ownerName: 'Ada' }];

const mockTxInsert = vi.fn();

vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/cron/cron-lock', () => ({
  refuseIfCronLockHeld: vi.fn(async () => null),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn() }));

const selectChain = (rows: unknown[]) => {
  const b: Record<string, unknown> = {};
  b.from = () => b;
  b.leftJoin = () => b;
  b.where = async () => rows;
  return b;
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => selectChain(ownersRows)),
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withSecurityContext: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
    select: () => selectChain(expiringSoonRows),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => justExpiredRows }) }),
    }),
    insert: () => ({ values: (v: unknown) => { mockTxInsert(v); return Promise.resolve([]); } }),
  })),
}));

import { POST } from '@/app/api/cron/trial-check/route';
import { sendEmail } from '@/lib/email/service';

const mockedSend = vi.mocked(sendEmail);

function request() {
  return new Request('http://localhost/api/cron/trial-check', {
    method: 'POST',
    headers: { 'x-cron-secret': CRON_SECRET },
  }) as never;
}

describe('trial-check honors sendEmail result (#3045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxInsert.mockClear();
  });

  it('does not count or mark when the provider rejects every send', async () => {
    mockedSend.mockResolvedValue({ success: false, error: '403 forbidden' });

    const res = await POST(request());
    const body = await res.json() as { ok: boolean; expired: number; warned: number };

    expect(body.expired).toBe(0);
    expect(body.warned).toBe(0);
    // The dedup marker must NOT be written on rejection — that marker is what
    // suppressed retries for 4 days and permanently un-warned tenants.
    expect(mockTxInsert).not.toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledTimes(2);
  });

  it('counts and marks when sends are accepted', async () => {
    mockedSend.mockResolvedValue({ success: true, provider: 'resend' });

    const res = await POST(request());
    const body = await res.json() as { ok: boolean; expired: number; warned: number };

    expect(body.expired).toBe(1);
    expect(body.warned).toBe(1);
    expect(mockTxInsert).toHaveBeenCalledTimes(1);
  });
});
