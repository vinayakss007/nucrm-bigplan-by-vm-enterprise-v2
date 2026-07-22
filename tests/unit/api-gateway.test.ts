import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock('@/lib/auth/api-key', () => ({
  tryApiKeyAuth: vi.fn(),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  sessions: {},
  tenantMembers: {},
  tenants: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => args),
  and: vi.fn((...args) => args),
  gt: vi.fn((...args) => args),
}));

describe('API Gateway', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('extractApiVersion', () => {
    it('extracts version from pathname', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/v2/contacts')).toBe('v2');
      expect(extractApiVersion('/api/v1/deals')).toBe('v1');
    });

    it('returns null for path without version', async () => {
      const { extractApiVersion } = await import('@/lib/api/gateway');
      expect(extractApiVersion('/api/contacts')).toBeNull();
      expect(extractApiVersion('/tenant/dashboard')).toBeNull();
    });
  });

  describe('validateCORS', () => {
    it('returns true for no origin header', async () => {
      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS(null, 't1')).toBe(true);
    });

    it('returns false when tenant not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://example.com', 't1')).toBe(false);
    });

    it('returns false when allowedOrigins is empty', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ settings: {} }])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://example.com', 't1')).toBe(false);
    });

    it('returns true for exact match origin', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ settings: { allowedOrigins: ['https://app.example.com'] } }])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://app.example.com', 't1')).toBe(true);
    });

    it('allows wildcard in dev mode', async () => {
      process.env.NODE_ENV = 'development';
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ settings: { allowedOrigins: ['*'] } }])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://any-origin.com', 't1')).toBe(true);
    });

    it('denies wildcard in production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ settings: { allowedOrigins: ['*'] } }])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://evil.com', 't1')).toBe(false);
      process.env.NODE_ENV = origEnv;
    });

    it('matches wildcard subdomain patterns', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ settings: { allowedOrigins: ['*.example.com'] } }])),
          })),
        })),
      });

      const { validateCORS } = await import('@/lib/api/gateway');
      expect(await validateCORS('https://sub.example.com', 't1')).toBe(true);
      expect(await validateCORS('https://other.example.com', 't1')).toBe(true);
      expect(await validateCORS('https://evil.com', 't1')).toBe(false);
    });
  });

  describe('resolveGatewayTenant', () => {
    it('resolves via API key', async () => {
      const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
      (tryApiKeyAuth as ReturnType<typeof vi.fn>).mockResolvedValue({ tenantId: 't1' });

      const mockRequest = {
        headers: { get: vi.fn(() => null) },
        cookies: { get: vi.fn(() => undefined) },
      };

      const { resolveGatewayTenant } = await import('@/lib/api/gateway');
      const result = await resolveGatewayTenant(mockRequest as unknown as Request);
      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe('t1');
      expect(result!.source).toBe('api_key');
    });
  });
});
