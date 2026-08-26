import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('client-ip (#1249)', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TRUST_PROXY;
  });
  afterEach(() => { process.env = { ...ENV }; });

  it('returns unknown when TRUST_PROXY is not enabled', async () => {
    const { getClientIp } = await import('@/lib/client-ip');
    const req = { headers: { get: () => '1.2.3.4, 5.6.7.8' } } as unknown as Request;
    expect(getClientIp(req)).toBe('unknown');
  });

  it('uses first x-forwarded-for entry when TRUST_PROXY=true', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await import('@/lib/client-ip');
    const req = { headers: { get: (k: string) => (k === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null) } } as unknown as Request;
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip then unknown', async () => {
    process.env.TRUST_PROXY = 'true';
    const { getClientIp } = await import('@/lib/client-ip');
    const realOnly = { headers: { get: (k: string) => (k === 'x-real-ip' ? '9.9.9.9' : null) } } as unknown as Request;
    expect(getClientIp(realOnly)).toBe('9.9.9.9');
    expect(getClientIp({ headers: { get: () => null } } as unknown as Request)).toBe('unknown');
  });
});

describe('oauth state signing (#1175)', () => {
  const ENV = { ...process.env };
  beforeEach(() => { vi.resetModules(); process.env.SESSION_SECRET = 'test-secret-123'; });
  afterEach(() => { process.env = { ...ENV }; });

  it('round-trips a signed payload', async () => {
    const mod = await import('@/lib/calendar-sync/state');
    const payload = JSON.stringify({ tenantId: 't1', userId: 'u1' });
    const signed = mod.signOAuthState(payload);
    expect(signed).toContain('.');
    expect(mod.verifyOAuthState(signed)).toBe(true);
  });

  it('rejects tampered and unsigned payloads', async () => {
    const mod = await import('@/lib/calendar-sync/state');
    const signed = mod.signOAuthState(JSON.stringify({ tenantId: 't1' }));
    const [payload] = signed.split('.');
    expect(mod.verifyOAuthState(`${payload}.deadbeef`)).toBe(false);
    expect(mod.verifyOAuthState(payload)).toBe(false); // unsigned
  });
});
