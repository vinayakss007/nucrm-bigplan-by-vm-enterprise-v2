import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  platformSettings: {
    id: 'id', tenantId: 'tenant_id', key: 'key', value: 'value',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ['eq', ...args]),
  and: vi.fn((...args: any[]) => ['and', ...args]),
}));

import { db } from '@/drizzle/db';

function mockRequest(ip: string | null): any {
  return {
    headers: { get: (name: string) => {
      if (name === 'x-forwarded-for') return ip;
      if (name === 'x-real-ip') return null;
      return null;
    }},
  };
}

describe('checkIpWhitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when whitelist is empty (no IP restriction)', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.1');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).toBeNull();
  });

  it('returns null when whitelist value is empty array', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: '[]' }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.1');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).toBeNull();
  });

  it('allows access when client IP is in whitelist', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.1', '10.0.0.2']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.1');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).toBeNull();
  });

  it('blocks access when client IP is not in whitelist', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.1', '10.0.0.2']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.99');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('returns 403 with error message for blocked IPs', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['192.168.1.1']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.5');
    const result = await checkIpWhitelist(req, 'tenant-1');

    const body = await result!.json();
    expect(body.error).toBe('Access denied from your IP address');
    expect(body.code).toBe('ERR_IP_NOT_ALLOWED');
  });

  it('supports CIDR notation in whitelist', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.0/24']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.50');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).toBeNull();
  });

  it('blocks CIDR range mismatches', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.0/24']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.1.1');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('falls back to unknown IP when no headers present', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.1']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = { headers: { get: () => null } };
    const result = await checkIpWhitelist(req as any, 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('handles malformed whitelist JSON gracefully returns empty array', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: 'not-json' }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = mockRequest('10.0.0.1');
    const result = await checkIpWhitelist(req, 'tenant-1');

    expect(result).toBeNull();
  });

  it('handles x-real-ip fallback when x-forwarded-for is missing', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['192.168.1.1']) }])),
        })),
      })),
    });

    const { checkIpWhitelist } = await import('@/lib/ip-whitelist');
    const req = { headers: { get: (name: string) => name === 'x-real-ip' ? '192.168.1.1' : null } };
    const result = await checkIpWhitelist(req as any, 'tenant-1');

    expect(result).toBeNull();
  });
});

describe('getIpWhitelistEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when no whitelist configured', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    });

    const { getIpWhitelistEnabled } = await import('@/lib/ip-whitelist');
    const result = await getIpWhitelistEnabled('tenant-1');

    expect(result).toBe(false);
  });

  it('returns true when whitelist has entries', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ value: JSON.stringify(['10.0.0.1']) }])),
        })),
      })),
    });

    const { getIpWhitelistEnabled } = await import('@/lib/ip-whitelist');
    const result = await getIpWhitelistEnabled('tenant-1');

    expect(result).toBe(true);
  });
});
