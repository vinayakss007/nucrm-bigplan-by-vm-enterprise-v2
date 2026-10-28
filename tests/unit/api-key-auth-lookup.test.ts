/**
 * `tryApiKeyAuth` used to read `api_keys` on the bare `db` handle. The only
 * policy on that table is `tenant_isolation`, which compares tenant_id to
 * app.current_tenant — a GUC that is, at that moment, empty, because finding the
 * tenant is exactly what the read is for. So the statement matched zero rows and
 * every key the settings page minted came back as 401 "Invalid or expired
 * token". These tests pin the two things that make the feature work, so a
 * refactor that drops either one fails here instead of silently shipping
 * dead-on-arrival credentials:
 *
 *   1. the lookup runs inside the auth-lookup privilege (migration 0099), and
 *   2. the key's tenant context is adopted *before* the usage trail is written,
 *      since api_key_usage is tenant-isolated too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];

const chain: Record<string, unknown> = vi.hoisted(() => {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.from = vi.fn(() => c);
  c.innerJoin = vi.fn(() => c);
  c.where = vi.fn(() => c);
  // A drizzle query builder is thenable; `where` has to hand the builder back so
  // the membership read (#3291) can chain `.limit()` on it.
  c.then = vi.fn((resolve: (v: unknown) => void) => resolve(c._rows));
  // #3291: the only read in this flow that asks for a limit is the membership
  // proof, so the fixture answers it with a live member. api-key-membership-3291
  // .test.ts is where the refusal is pinned.
  c.limit = vi.fn(async () => [{ id: 'tm-1' }]);
  c.update = vi.fn(() => c);
  c.set = vi.fn(() => c);
  c.insert = vi.fn(() => c);
  c.values = vi.fn(async () => { order.push('usage-insert'); return c; });
  c.transaction = vi.fn(async (cb: (tx: Record<string, unknown>) => unknown) => {
    order.push('tx');
    return cb(c);
  });
  return c;
});

let lookupRan = false;

vi.mock('@/drizzle/db', () => ({ db: chain }));
vi.mock('@/drizzle/schema', () => ({
  apiKeys: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', keyHash: 'key_hash',
    isActive: 'is_active', expiresAt: 'expires_at', scopes: 'scopes', name: 'name',
    lastUsedAt: 'last_used_at' },
  apiKeyUsage: { id: 'id', apiKeyId: 'api_key_id', tenantId: 'tenant_id' },
  users: { id: 'id', isSuperAdmin: 'is_super_admin', deletedAt: 'deleted_at' },
  tenantMembers: { id: 'id', tenantId: 'tenant_id', userId: 'user_id',
    status: 'status', deletedAt: 'deleted_at' },
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: vi.fn(async (fn: (tx: Record<string, unknown>) => unknown) => {
    lookupRan = true;
    order.push('auth-lookup');
    return fn(chain);
  }),
  setTenantContext: vi.fn(async (tenantId: string, userId: string) => {
    order.push(`set-tenant(${tenantId},${userId})`);
  }),
}));

function request(key: string) {
  return {
    headers: { get: (h: string) => (h === 'authorization' ? `Bearer ${key}` : null) },
    nextUrl: { pathname: '/api/tenant/leads' },
    method: 'GET',
  };
}

const ROW = {
  apiKey: { id: 'k1', tenantId: 't1', userId: 'u1', scopes: ['all'], expiresAt: null },
  isSuperAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  lookupRan = false;
  chain._rows = [ROW];
});

describe('tryApiKeyAuth pre-auth lookup', () => {
  it('reads the key through the auth-lookup privilege, not the bare db handle', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const ctx = await tryApiKeyAuth(request('ak_live_' + 'a'.repeat(48)));

    expect(lookupRan).toBe(true);
    expect(ctx?.tenantId).toBe('t1');
    expect(order[0]).toBe('auth-lookup');
  });

  it('adopts the key tenant before writing the usage trail', async () => {
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    await tryApiKeyAuth(request('ak_live_' + 'b'.repeat(48)));

    const tenantAt = order.findIndex((o) => o.startsWith('set-tenant'));
    // The INSERT is the usage trail; #3291 opened a transaction earlier than that
    // for the membership proof, so 'tx' is no longer a usable marker.
    const usageAt = order.findIndex((o) => o === 'usage-insert');
    expect(tenantAt).toBeGreaterThan(-1);
    expect(usageAt).toBeGreaterThan(-1);
    expect(order[tenantAt]).toBe('set-tenant(t1,u1)');
    expect(tenantAt).toBeLessThan(usageAt);
  });

  it('does not adopt a tenant for a key that does not exist', async () => {
    chain._rows = [];
    const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
    const ctx = await tryApiKeyAuth(request('ak_live_' + 'c'.repeat(48)));

    expect(ctx).toBeNull();
    expect(order).toEqual(['auth-lookup']);
  });
});
