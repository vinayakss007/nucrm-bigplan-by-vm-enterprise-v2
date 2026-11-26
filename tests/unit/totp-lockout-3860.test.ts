/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { mockGet, mockIncr, mockDel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockIncr: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({ cache: { get: mockGet, incr: mockIncr, del: mockDel } }));

import { check2faLockout, record2faFailure, clear2faFailures } from '@/lib/auth/totp-lockout';

describe('per-account 2FA failure lockout (#3860)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows verification while the failure count is below the ceiling', async () => {
    mockGet.mockResolvedValue(4);
    await expect(check2faLockout('user-1')).resolves.toBeNull();
    expect(mockGet).toHaveBeenCalledWith('v1_2fa_fail:user-1');
  });

  it('answers 429 after five failed attempts', async () => {
    mockGet.mockResolvedValue(5);
    const res = await check2faLockout('user-1');
    expect(res?.status).toBe(429);
  });

  it('counts failures in a 15-minute sliding window', async () => {
    mockIncr.mockResolvedValue(3);
    await record2faFailure('user-1');
    expect(mockIncr).toHaveBeenCalledWith('v1_2fa_fail:user-1', 900);
  });

  it('fails closed when the failure counter backend is unavailable', async () => {
    mockIncr.mockResolvedValue(0);
    await expect(record2faFailure('user-1')).rejects.toThrow(/unavailable/);
  });

  it('clears the counter after a successful verification', async () => {
    await clear2faFailures('user-1');
    expect(mockDel).toHaveBeenCalledWith('v1_2fa_fail:user-1');
  });
});

describe('sensitive POST routes are throttled (#3860)', () => {
  const root = process.cwd();
  const routes = [
    ['app/api/tenant/2fa/verify/route.ts', "'twoFactor', 'post'"],
    ['app/api/tenant/invite/send/route.ts', "'invites', 'post'"],
    ['app/api/tenant/custom-entities/[id]/rows/route.ts', "'customFields', 'post'"],
    ['app/api/tenant/forms/[id]/analytics/route.ts', "'forms', 'post'"],
  ] as const;

  it.each(routes)('%s calls rateLimitMutating', (file, call) => {
    const src = readFileSync(path.join(root, file), 'utf8').replace(/\s+/g, ' ');
    expect(src.includes(`rateLimitMutating(request, ${call}`) || src.includes(`rateLimitMutating(req, ${call}`)).toBe(true);
  });
});
