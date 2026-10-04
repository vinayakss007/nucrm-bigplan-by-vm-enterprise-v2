import { describe, it, expect, vi, beforeEach } from 'vitest';

// getTenantWhitelist reads through the transaction it is handed, so the fake tx
// is where the whitelist row comes from.
let currentRows: { value: unknown }[] = [];
let lookupThrows = false;
const tx = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (lookupThrows) throw new Error('row-level security');
          return currentRows;
        }),
      })),
    })),
  })),
};

const withTenantContext = vi.fn(async (_t: string, _u: string, fn: (tx: unknown) => Promise<unknown>) =>
  await fn(tx));

vi.mock('@/drizzle/db', () => ({ db: { select: vi.fn() } }));
vi.mock('@/drizzle/schema', () => ({
  platformSettings: { id: 'id', tenantId: 'tenant_id', key: 'key', value: 'value' },
}));
vi.mock('drizzle-orm', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  eq: vi.fn((...args: any[]) => ['eq', ...args]),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  and: vi.fn((...args: any[]) => ['and', ...args]),
}));
vi.mock('@/lib/db/rls', () => ({
  withTenantContext: (...args: unknown[]) => withTenantContext(...(args as [string, string, (t: unknown) => Promise<unknown>])),
}));

async function gate(ip: string, tenantId = 'tenant-1') {
  const { checkLoginIpAllowed } = await import('@/lib/ip-whitelist');
  return await checkLoginIpAllowed(tenantId, 'user-1', ip);
}

// The gate caches per tenant for a few seconds (#76), so every case starts from
// a cold cache — otherwise a test inherits the previous test's whitelist.
async function resetCache() {
  const { invalidateIpWhitelistCache } = await import('@/lib/ip-whitelist');
  invalidateIpWhitelistCache();
}

describe('checkLoginIpAllowed', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currentRows = [];
    lookupThrows = false;
    await resetCache();
  });

  it('reads the whitelist inside the tenant context, not on a bare connection', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    await gate('10.0.0.1');
    expect(withTenantContext).toHaveBeenCalledWith('tenant-1', 'user-1', expect.any(Function));
  });

  it('allows when no whitelist is configured', async () => {
    currentRows = [];
    expect(await gate('10.0.0.1')).toEqual({ allowed: true, reason: 'no-whitelist' });
    await resetCache();
    currentRows = [{ value: '[]' }];
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('no-whitelist');
  });

  it('allows an IP on the list and blocks one that is not', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1', '10.0.0.2']) }];
    expect(await gate('10.0.0.2')).toEqual({ allowed: true, reason: 'matched' });
    expect(await gate('10.0.0.99')).toEqual({ allowed: false, reason: 'not-matched' });
  });

  it('matches CIDR ranges and rejects addresses outside them', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.0/24']) }];
    expect(await gate('10.0.0.50').then((r) => r.reason)).toBe('matched');
    expect(await gate('10.0.1.1').then((r) => r.reason)).toBe('not-matched');
  });

  it('matches across the high octets, where the first octet would sign the mask', async () => {
    currentRows = [{ value: JSON.stringify(['203.0.113.0/24']) }];
    expect(await gate('203.0.113.77').then((r) => r.reason)).toBe('matched');
    expect(await gate('203.0.114.77').then((r) => r.reason)).toBe('not-matched');
  });

  it('does not evaluate when the client IP is not an IPv4 address', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('unknown')).toEqual({ allowed: true, reason: 'unknown-client-ip' });
    expect(await gate('2001:db8::1').then((r) => r.reason)).toBe('unknown-client-ip');
  });

  it('fails open, not closed, when the row cannot be read', async () => {
    lookupThrows = true;
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('lookup-failed');
  });

  it('treats an unreadable whitelist value as no restriction', async () => {
    currentRows = [{ value: 'not-json' }];
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('no-whitelist');
  });

  it('skips the whole check when the account has no workspace yet', async () => {
    expect(await gate('10.0.0.1', '')).toEqual({ allowed: true, reason: 'no-tenant' });
    expect(withTenantContext).not.toHaveBeenCalled();
  });
});

// #76: the read is a 4-statement RLS transaction and every statement in
// pre-prod costs a flat ~200 ms (PP-028), so un-cached it added ~830 ms to
// every sign-in — including for tenants that never configured a list.
describe('checkLoginIpAllowed — whitelist cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    currentRows = [];
    lookupThrows = false;
    await resetCache();
  });

  it('reads the row once per tenant and answers later sign-ins from the cache', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('matched');
    expect(await gate('10.0.0.99').then((r) => r.reason)).toBe('not-matched');
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('matched');
    expect(withTenantContext).toHaveBeenCalledTimes(1);
  });

  it('applies a list the tenant just saved, without waiting for the TTL', async () => {
    currentRows = [];
    expect(await gate('10.0.0.99').then((r) => r.reason)).toBe('no-whitelist');

    // Stale by design until the write invalidates: this is what a cache costs,
    // and the settings route pays it down immediately.
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('10.0.0.99').then((r) => r.reason)).toBe('no-whitelist');

    const { invalidateIpWhitelistCache } = await import('@/lib/ip-whitelist');
    invalidateIpWhitelistCache('tenant-1');
    expect(await gate('10.0.0.99')).toEqual({ allowed: false, reason: 'not-matched' });
    expect(withTenantContext).toHaveBeenCalledTimes(2);
  });

  it('does not cache a lookup that failed', async () => {
    lookupThrows = true;
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('lookup-failed');

    lookupThrows = false;
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('matched');
    expect(withTenantContext).toHaveBeenCalledTimes(2);
  });

  it('does not cache a row it could not decode', async () => {
    currentRows = [{ value: 'not-json' }];
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('no-whitelist');

    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('10.0.0.99').then((r) => r.reason)).toBe('not-matched');
    expect(withTenantContext).toHaveBeenCalledTimes(2);
  });

  it('keeps one tenant list from deciding another tenant sign-in', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    expect(await gate('10.0.0.99', 'tenant-a').then((r) => r.reason)).toBe('not-matched');
    expect(await gate('10.0.0.99', 'tenant-b').then((r) => r.reason)).toBe('not-matched');
    expect(withTenantContext).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the entry is older than the TTL', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    const started = Date.now();
    expect(await gate('10.0.0.1').then((r) => r.reason)).toBe('matched');

    // Only `Date.now` is faked, so the age check is exercised without a timer.
    const now = vi.spyOn(Date, 'now').mockReturnValue(started + 31_000);
    expect(await gate('10.0.0.99').then((r) => r.reason)).toBe('not-matched');
    expect(withTenantContext).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
