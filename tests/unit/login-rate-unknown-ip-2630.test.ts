/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #2630 — when TRUST_PROXY!=true, `getClientIp` returns the constant
// 'unknown', and `checkRateLimit` slotted it into the Redis key
// `nucrm:rate:v1_rate:<action>:unknown`. Every anonymous login attempt then
// shared one bucket: hammer login once and every user globally sees a 429.
// The fix fails closed for auth-scope actions when the client IP cannot be
// resolved, so misconfiguration surfaces as 503 instead of silent global
// lockout.
describe('checkRateLimit — auth actions must NOT key on unknown IP (#2630)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('503s for action=login when TRUST_PROXY=false', async () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const req = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const res = await checkRateLimit(req, { action: 'login' });
    expect(res?.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toMatch(/Rate limiter misconfigured/i);
  });

  it('503s for action=password_reset when TRUST_PROXY is unset', async () => {
    // no stub -> env defaults to unset, getClientIp still returns 'unknown'
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const req = new Request('http://localhost/api/auth/reset');
    const res = await checkRateLimit(req, { action: 'password_reset' });
    expect(res?.status).toBe(503);
  });

  it('does NOT 503 for a non-auth action even when ip is unknown (bucket-safe)', async () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const req = new Request('http://localhost/api/test');
    // Non-auth action falls through to the limiter; either null (allowed) or
    // 429 (over limit) is fine — 503 is not.
    const res = await checkRateLimit(req, { action: 'some_other_endpoint', max: 500, windowMinutes: 60 });
    expect(res?.status ?? 200).not.toBe(503);
  });

  it('does NOT 503 when TRUST_PROXY=true + XFF is present (real IP known)', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    const { checkRateLimit } = await import('@/lib/rate-limit');
    const req = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const res = await checkRateLimit(req, { action: 'login', max: 500, windowMinutes: 60 });
    expect(res?.status ?? 200).not.toBe(503);
  });
});
