import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

// In-memory cache backing the RateLimiter (mirrors rate-limit-coverage.test.ts).
vi.mock('@/lib/cache/index', () => {
  const store = new Map<string, number>();
  return {
    cache: {
      incr: vi.fn(async (key: string, _ttl?: number) => {
        const current = (store.get(key) || 0) + 1;
        store.set(key, current);
        return current;
      }),
      get: vi.fn(async (key: string) => store.get(key) || 0),
      del: vi.fn(async (key: string) => { store.delete(key); }),
      set: vi.fn(async () => {}),
      __store: store,
    },
  };
});

// Drizzle db mock: the SCIM POST handler resolves membership, may insert a
// user + membership, and re-selects the created user. Return empty lookups so
// the "create new user" path is exercised when the handler runs.
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      systemSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      plans: { findFirst: vi.fn().mockResolvedValue(null) },
      users: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [{ id: 'user-1', email: 'new@example.com', fullName: 'New User', createdAt: new Date(), updatedAt: new Date() }]),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => []),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'user-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  users: { id: 'id', email: 'email', fullName: 'full_name', createdAt: 'created_at', updatedAt: 'updated_at' },
  tenantMembers: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', status: 'status', roleId: 'role_id', roleSlug: 'role_slug' },
  roles: { id: 'id', tenantId: 'tenant_id', slug: 'slug', sortOrder: 'sort_order' },
  plans: {},
  systemSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  relations: vi.fn(() => ({})),
}));

const TENANT = 'tenant-scim-rl';

function makeToken(tenantId: string): string {
  const secret = process.env['SCIM_SECRET'] as string;
  const expiryMs = Date.now() + 3600_000;
  const hmac = createHmac('sha256', secret).update(`${tenantId}:${expiryMs}`).digest('hex');
  return `${tenantId}:${expiryMs}:${hmac}`;
}

function scimPostRequest(tenantId: string, email: string): NextRequest {
  return new NextRequest('http://localhost/api/scim/v2/Users', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${makeToken(tenantId)}`,
      'content-type': 'application/scim+json',
    },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: email,
      emails: [{ value: email, primary: true }],
      active: true,
    }),
  });
}

describe('SCIM provisioning rate limit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env['SCIM_SECRET'] = 'test-secret-key';
    const { cache } = await import('@/lib/cache/index');
    (cache as unknown as { __store: Map<string, number> }).__store.clear();
  });

  afterEach(() => {
    delete process.env['SCIM_SECRET'];
  });

  describe('RateLimiter tenant-scoped key', () => {
    it('allows the first `max` calls and denies the (max+1)th for a tenant key', async () => {
      const { RateLimiter } = await import('@/lib/rate-limit');
      const limiter = new RateLimiter({ max: 30, window: 60 });
      const key = `scim:provision:${TENANT}`;

      for (let i = 0; i < 30; i++) {
        const r = await limiter.check(key);
        expect(r.allowed).toBe(true);
      }
      const over = await limiter.check(key);
      expect(over.allowed).toBe(false);
      expect(over.remaining).toBe(0);
    });

    it('isolates tenants so one tenant hitting its cap does not affect another', async () => {
      const { RateLimiter } = await import('@/lib/rate-limit');
      const limiter = new RateLimiter({ max: 30, window: 60 });

      // Exhaust tenant A.
      for (let i = 0; i < 31; i++) {
        await limiter.check(`scim:provision:tenant-A`);
      }
      const a = await limiter.check(`scim:provision:tenant-A`);
      expect(a.allowed).toBe(false);

      // Tenant B is unaffected.
      const b = await limiter.check(`scim:provision:tenant-B`);
      expect(b.allowed).toBe(true);
    });
  });

  describe('POST handler', () => {
    it('returns a SCIM-formatted 429 once the tenant exceeds the provisioning limit', async () => {
      const { POST } = await import('@/app/api/scim/v2/Users/route');

      // 30 allowed calls per 60s window, then the 31st is rejected.
      let lastAllowed: Response | undefined;
      for (let i = 0; i < 30; i++) {
        lastAllowed = await POST(scimPostRequest(TENANT, `user${i}@example.com`));
      }
      // Under-limit responses are not 429.
      expect(lastAllowed).toBeDefined();
      expect(lastAllowed!.status).not.toBe(429);

      const overLimit = await POST(scimPostRequest(TENANT, 'over@example.com'));
      expect(overLimit.status).toBe(429);
      expect(overLimit.headers.get('content-type')).toContain('application/scim+json');

      const body = await overLimit.json();
      expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(body.status).toBe('429');
      expect(body.detail).toBe('Too many requests');
    });

    it('does not consume another tenant\'s budget (tenant isolation at the handler)', async () => {
      const { POST } = await import('@/app/api/scim/v2/Users/route');

      // Exhaust tenant-A's budget through the handler.
      for (let i = 0; i < 31; i++) {
        await POST(scimPostRequest('tenant-A', `a${i}@example.com`));
      }
      const aBlocked = await POST(scimPostRequest('tenant-A', 'a-final@example.com'));
      expect(aBlocked.status).toBe(429);

      // Tenant-B's first call must still be allowed (not 429).
      const bFirst = await POST(scimPostRequest('tenant-B', 'b0@example.com'));
      expect(bFirst.status).not.toBe(429);
    });
  });
});
