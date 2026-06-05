import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB with controllable return values
let dbReturnValue: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => dbReturnValue),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn() })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    query: {},
  },
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: {
    id: 'id',
    customDomain: 'custom_domain',
    subdomain: 'subdomain',
    settings: 'settings',
  },
  apiKeys: {
    id: 'id',
    tenantId: 'tenant_id',
    keyHash: 'key_hash',
    isActive: 'is_active',
    expiresAt: 'expires_at',
    userId: 'user_id',
    scopes: 'scopes',
    lastUsedAt: 'last_used_at',
    prefix: 'prefix',
  },
  apiKeyUsage: {
    apiKeyId: 'api_key_id',
    tenantId: 'tenant_id',
    endpoint: 'endpoint',
    method: 'method',
    ipAddress: 'ip_address',
  },
  users: {
    id: 'id',
    isSuperAdmin: 'is_super_admin',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  gt: vi.fn((...args: unknown[]) => ({ type: 'gt', args })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

describe('API Gateway', () => {
  beforeEach(() => {
    vi.resetModules();
    dbReturnValue = [];
  });

  describe('extractApiVersion', () => {
    it('extracts v2 from /api/v2/contacts', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/v2/contacts')).toBe('v2');
    });

    it('extracts v3 from /api/v3/deals/123', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/v3/deals/123')).toBe('v3');
    });

    it('returns null for non-versioned paths', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/tenant/contacts')).toBeNull();
    });

    it('returns null for root path', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/')).toBeNull();
    });

    it('returns null for paths without trailing slash after version', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/v2')).toBeNull();
    });
  });

  describe('resolveGatewayTenant', () => {
    it('returns null when no tenant can be resolved', async () => {
      const { resolveGatewayTenant } = await import('@/lib/api/gateway');

      const request = new Request('http://localhost:3000/api/v2/contacts', {
        headers: { host: 'localhost:3000' },
      });

      // Cast to NextRequest-like for the test
      const nextReq = Object.assign(request, {
        nextUrl: new URL('http://localhost:3000/api/v2/contacts'),
        cookies: { get: () => undefined },
      });

      const result = await resolveGatewayTenant(nextReq as any);
      expect(result).toBeNull();
    });

    it('resolves tenant from X-Tenant-ID header', async () => {
      const { resolveGatewayTenant } = await import('@/lib/api/gateway');

      const request = new Request('http://localhost:3000/api/v2/contacts', {
        headers: {
          host: 'localhost:3000',
          'x-tenant-id': 'tenant-abc-123',
          'authorization': 'Bearer some-token',
        },
      });

      const nextReq = Object.assign(request, {
        nextUrl: new URL('http://localhost:3000/api/v2/contacts'),
        cookies: { get: () => undefined },
      });

      const result = await resolveGatewayTenant(nextReq as any);
      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe('tenant-abc-123');
      expect(result!.source).toBe('header');
      expect(result!.authContext).toBeNull();
    });

    it('rejects X-Tenant-ID header without authentication', async () => {
      const { resolveGatewayTenant } = await import('@/lib/api/gateway');

      const request = new Request('http://localhost:3000/api/v2/contacts', {
        headers: {
          host: 'localhost:3000',
          'x-tenant-id': 'tenant-abc-123',
        },
      });

      const nextReq = Object.assign(request, {
        nextUrl: new URL('http://localhost:3000/api/v2/contacts'),
        cookies: { get: () => undefined },
      });

      const result = await resolveGatewayTenant(nextReq as any);
      expect(result).toBeNull();
    });
  });

  describe('validateCORS', () => {
    it('returns true when origin is null (same-origin)', async () => {
      const { validateCORS } = await import('@/lib/api/gateway');
      const result = await validateCORS(null, 'tenant-123');
      expect(result).toBe(true);
    });

    it('returns false when tenant not found', async () => {
      const { validateCORS } = await import('@/lib/api/gateway');
      // mockLimit returns [] (empty array - no tenant found)
      const result = await validateCORS('https://evil.com', 'nonexistent');
      expect(result).toBe(false);
    });

    it('returns true when no allowedOrigins configured (open API)', async () => {
      dbReturnValue = [{ settings: {} }];

      const { validateCORS } = await import('@/lib/api/gateway');
      const result = await validateCORS('https://example.com', 'tenant-123');
      expect(result).toBe(true);
    });

    it('returns true when origin matches allowed origins', async () => {
      dbReturnValue = [{
        settings: { allowedOrigins: ['https://myapp.com', 'https://other.com'] },
      }];

      const { validateCORS } = await import('@/lib/api/gateway');
      const result = await validateCORS('https://myapp.com', 'tenant-123');
      expect(result).toBe(true);
    });

    it('returns false when origin not in allowed list', async () => {
      dbReturnValue = [{
        settings: { allowedOrigins: ['https://myapp.com'] },
      }];

      const { validateCORS } = await import('@/lib/api/gateway');
      const result = await validateCORS('https://evil.com', 'tenant-123');
      expect(result).toBe(false);
    });

    it('returns true when wildcard * is in allowed origins', async () => {
      dbReturnValue = [{
        settings: { allowedOrigins: ['*'] },
      }];

      const { validateCORS } = await import('@/lib/api/gateway');
      const result = await validateCORS('https://anything.com', 'tenant-123');
      expect(result).toBe(true);
    });
  });
});
