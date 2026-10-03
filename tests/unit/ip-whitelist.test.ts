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

describe('checkLoginIpAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRows = [];
    lookupThrows = false;
  });

  it('reads the whitelist inside the tenant context, not on a bare connection', async () => {
    currentRows = [{ value: JSON.stringify(['10.0.0.1']) }];
    await gate('10.0.0.1');
    expect(withTenantContext).toHaveBeenCalledWith('tenant-1', 'user-1', expect.any(Function));
  });

  it('allows when no whitelist is configured', async () => {
    currentRows = [];
    expect(await gate('10.0.0.1')).toEqual({ allowed: true, reason: 'no-whitelist' });
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
