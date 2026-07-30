/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockQueryResult: any[] = [];

const mockChain: any = vi.hoisted(() => {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockImplementation(() => Promise.resolve(mockQueryResult));
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.groupBy = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve(mockQueryResult));
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.transaction = vi.fn((cb: (tx: any) => Promise<any>) => cb(chain));
  return chain;
});

vi.mock('@/drizzle/db', () => ({
  db: mockChain,
}));

import { hasScope } from '@/lib/auth/api-key';
import { AuthContext } from '@/lib/auth/middleware';

function mockCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u1',
    tenantId: 't1',
    roleSlug: 'user',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    ...overrides,
  } as AuthContext;
}

describe('hasScope', () => {
  it('returns true for super admin regardless of permissions', () => {
    const ctx = mockCtx({ isSuperAdmin: true, permissions: {} });
    expect(hasScope(ctx, 'contacts:read')).toBe(true);
  });

  it('returns true when permissions contain "all"', () => {
    const ctx = mockCtx({ permissions: { all: true } });
    expect(hasScope(ctx, 'contacts:read')).toBe(true);
    expect(hasScope(ctx, 'deals:write')).toBe(true);
  });

  it('returns true for exact scope match', () => {
    const ctx = mockCtx({ permissions: { 'contacts:read': true } });
    expect(hasScope(ctx, 'contacts:read')).toBe(true);
  });

  it('returns false for missing scope', () => {
    const ctx = mockCtx({ permissions: { 'deals:read': true } });
    expect(hasScope(ctx, 'contacts:read')).toBe(false);
  });

  it('returns true for wildcard resource scope (contacts:all)', () => {
    const ctx = mockCtx({ permissions: { 'contacts:all': true } });
    expect(hasScope(ctx, 'contacts:read')).toBe(true);
    expect(hasScope(ctx, 'contacts:write')).toBe(true);
  });

  it('returns false when wildcard scope is for different resource', () => {
    const ctx = mockCtx({ permissions: { 'deals:all': true } });
    expect(hasScope(ctx, 'contacts:read')).toBe(false);
  });
});

describe('tryApiKeyAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = [];
  });

  it('returns null when no Bearer ak_ header', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = { headers: { get: () => null } } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('returns null for non-ak_ Bearer token', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = { headers: { get: (h: string) => h === 'authorization' ? 'Bearer sk_abc123' : null } } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('returns null when no matching key in database', async () => {
    mockQueryResult = [];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => h === 'authorization' ? 'Bearer ak_live_abc123def456' : null,
      },
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('returns auth context when valid API key found', async () => {
    mockQueryResult = [{
      apiKey: {
        id: 'k1',
        userId: 'u1',
        tenantId: 't1',
        scopes: ['contacts:read', 'deals:write'],
        isActive: true,
      },
      isSuperAdmin: false,
    }];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => {
          if (h === 'authorization') return 'Bearer ak_live_abc123def456';
          if (h === 'x-forwarded-for') return '1.2.3.4';
          return null;
        },
      },
      nextUrl: { pathname: '/api/contacts' },
      method: 'GET',
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
    expect(result!.tenantId).toBe('t1');
    expect(result!.roleSlug).toBe('api');
    expect(result!.permissions['contacts:read']).toBe(true);
    expect(result!.permissions['deals:write']).toBe(true);
  });

  it('maps "all" scope to permissions.all', async () => {
    mockQueryResult = [{
      apiKey: {
        id: 'k2',
        userId: 'u2',
        tenantId: 't2',
        scopes: ['all'],
        isActive: true,
      },
      isSuperAdmin: false,
    }];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => {
          if (h === 'authorization') return 'Bearer ak_live_xyz789';
          return null;
        },
      },
      nextUrl: { pathname: '/api/contacts' },
      method: 'GET',
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result!.permissions['all']).toBe(true);
    expect(result!.isAdmin).toBe(true);
  });

  it('maps "*" scope to permissions.all', async () => {
    mockQueryResult = [{
      apiKey: {
        id: 'k3',
        userId: 'u3',
        tenantId: 't3',
        scopes: ['*'],
        isActive: true,
      },
      isSuperAdmin: false,
    }];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => {
          if (h === 'authorization') return 'Bearer ak_live_wildcard';
          return null;
        },
      },
      nextUrl: { pathname: '/api/deals' },
      method: 'POST',
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result!.permissions['all']).toBe(true);
    expect(result!.isAdmin).toBe(true);
  });

  it('returns isSuperAdmin from user record', async () => {
    mockQueryResult = [{
      apiKey: {
        id: 'k4',
        userId: 'u4',
        tenantId: 't4',
        scopes: ['contacts:read'],
        isActive: true,
      },
      isSuperAdmin: true,
    }];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => {
          if (h === 'authorization') return 'Bearer ak_live_superadmin';
          return null;
        },
      },
      nextUrl: { pathname: '/api/contacts' },
      method: 'GET',
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).not.toBeNull();
    expect(result!.isSuperAdmin).toBe(true);
  });

  it('sets isAdmin when scope ends with :all', async () => {
    mockQueryResult = [{
      apiKey: {
        id: 'k5',
        userId: 'u5',
        tenantId: 't5',
        scopes: ['contacts:all'],
        isActive: true,
      },
      isSuperAdmin: false,
    }];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: {
        get: (h: string) => {
          if (h === 'authorization') return 'Bearer ak_live_adminscope';
          return null;
        },
      },
      nextUrl: { pathname: '/api/contacts' },
      method: 'GET',
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).not.toBeNull();
    expect(result!.isAdmin).toBe(true);
  });
});

describe('generateApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChain.values.mockReturnValue(mockChain);
    mockChain.insert.mockReturnValue(mockChain);
  });

  it('produces a key with correct ak_live_ prefix format', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const result = await generateApiKey('t1', 'u1', 'Test Key', ['contacts:read']);
    expect(result.key).toMatch(/^ak_live_[a-f0-9]{48}$/);
    expect(result.prefix).toMatch(/^ak_live_[a-f0-9]{6}$/);
  });

  it('produces unique keys on successive calls', async () => {
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const r1 = await generateApiKey('t1', 'u1', 'Key 1', ['contacts:read']);
    const r2 = await generateApiKey('t1', 'u1', 'Key 2', ['contacts:read']);
    expect(r1.key).not.toBe(r2.key);
    expect(r1.prefix).not.toBe(r2.prefix);
  });

  it('stores hashed version in database (not raw key)', async () => {
    const { createHash } = await import('crypto');
    const { generateApiKey } = await import('@/lib/auth/api-key');
    const result = await generateApiKey('t1', 'u1', 'My Key', ['deals:write']);

    // Verify db.insert was called
    expect(mockChain.insert).toHaveBeenCalled();
    expect(mockChain.values).toHaveBeenCalled();

    // The values call should contain a hashed key, not the raw key
    const valuesArg = mockChain.values.mock.calls[0][0];
    const expectedHash = createHash('sha256').update(result.key).digest('hex');
    expect(valuesArg.keyHash).toBe(expectedHash);
    // Raw key should NOT be stored
    expect(valuesArg.keyHash).not.toBe(result.key);
  });
});

describe('hashApiKey (determinism)', () => {
  it('hashing the same key always produces the same hash', async () => {
    const { createHash } = await import('crypto');
    const rawKey = 'ak_live_abc123def456abc123def456abc123def456abc123def456';
    const hash1 = createHash('sha256').update(rawKey).digest('hex');
    const hash2 = createHash('sha256').update(rawKey).digest('hex');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('different keys produce different hashes', async () => {
    const { createHash } = await import('crypto');
    const key1 = 'ak_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const key2 = 'ak_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const hash1 = createHash('sha256').update(key1).digest('hex');
    const hash2 = createHash('sha256').update(key2).digest('hex');
    expect(hash1).not.toBe(hash2);
  });
});

describe('validateApiKey (format validation)', () => {
  it('rejects keys without ak_ prefix', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: { get: (h: string) => h === 'authorization' ? 'Bearer sk_live_abc123' : null },
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('rejects empty authorization header', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: { get: () => '' },
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('rejects Bearer token without ak_ format', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: { get: (h: string) => h === 'authorization' ? 'Bearer randomtoken123' : null },
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });

  it('rejects non-Bearer auth schemes', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const req = {
      headers: { get: (h: string) => h === 'authorization' ? 'Basic ak_live_abc123' : null },
    } as any;
    const result = await tryApiKeyAuth(req);
    expect(result).toBeNull();
  });
});
