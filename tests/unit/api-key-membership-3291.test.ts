/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 ask 1 — an API key outlives the person it belongs to.
 *
 * `tryApiKeyAuth` matched a key on `keyHash` + `isActive` + optional expiry and
 * nothing else, while `lib/api/gateway.ts:77-85` returns from the key branch
 * immediately:
 *
 * ```ts
 * const apiKeyCtx = await tryApiKeyAuth(request);
 * if (apiKeyCtx) return { tenantId: apiKeyCtx.tenantId, …, source: 'api_key' };
 * ```
 *
 * The very next branch in that function (`:87-112`, `X-Tenant-ID`) does prove
 * membership, and `middleware.ts:158-170` re-checks it per cookie request — so
 * `PATCH /api/tenant/members {action:"remove"}` correctly kills sessions and
 * leaves a standing data-plane credential behind. The strongest credential in the
 * system had the weakest check.
 *
 * What is pinned here, in the order it has to happen:
 *
 *   1. no active `tenant_members` row for the key's tenant+user ⇒ `null`, and the
 *      usage trail is not written (a denied key must not look "last used" at 3am);
 *   2. the membership read runs AFTER `setTenantContext`, inside a transaction, so
 *      `tenant_isolation`/`tenant_members_self_read` can actually see the row —
 *      reading it inside the pre-auth `withAuthLookupContext` would match zero
 *      rows, which is the dead-on-arrival bug 0099 was written to fix;
 *   3. a soft-deleted owner cannot authenticate either;
 *   4. a membership read that throws denies rather than allows.
 *
 * The harness routes each read by the table handed to `.from()` rather than by
 * call order, so a read that moves places stays honest about which rows it saw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const apiKeys = {
    id: 'api_keys.id', tenantId: 'api_keys.tenant_id', userId: 'api_keys.user_id',
    keyHash: 'api_keys.key_hash', isActive: 'api_keys.is_active',
    expiresAt: 'api_keys.expires_at', scopes: 'api_keys.scopes',
    lastUsedAt: 'api_keys.last_used_at',
  };
  const apiKeyUsage = {
    id: 'api_key_usage.id', apiKeyId: 'api_key_usage.api_key_id',
    tenantId: 'api_key_usage.tenant_id',
  };
  const users = { id: 'users.id', isSuperAdmin: 'users.is_super_admin', deletedAt: 'users.deleted_at' };
  const tenantMembers = {
    id: 'tenant_members.id', tenantId: 'tenant_members.tenant_id',
    userId: 'tenant_members.user_id', status: 'tenant_members.status',
    deletedAt: 'tenant_members.deleted_at',
  };
  return {
    order: [] as string[],
    tables: { apiKeys, apiKeyUsage, users, tenantMembers },
    keyRows: [] as unknown[],
    membershipRows: [] as unknown[],
    membershipThrows: false,
    predicates: {} as Record<string, unknown[]>,
    kind: 'other' as string,
    inserted: 'other' as string,
  };
});

const chain = vi.hoisted(() => {
  const c: Record<string, unknown> = {};
  const which = (table: unknown) => {
    if (table === h.tables.apiKeys) return 'api_keys';
    if (table === h.tables.tenantMembers) return 'tenant_members';
    if (table === h.tables.apiKeyUsage) return 'api_key_usage';
    return 'other';
  };
  const rowsFor = (kind: string): unknown[] => {
    if (kind === 'tenant_members') {
      if (h.membershipThrows) throw new Error('connection reset by peer');
      return h.membershipRows;
    }
    if (kind === 'api_keys') return h.keyRows;
    return [];
  };
  c.select = vi.fn(() => c);
  c.from = vi.fn((table: unknown) => { h.kind = which(table); return c; });
  c.innerJoin = vi.fn(() => c);
  c.where = vi.fn((p: unknown) => {
    (h.predicates[h.kind] ??= []).push(p);
    return c;
  });
  // A drizzle query builder is thenable; without this, `await` on a read that has
  // no `.limit()` would hand back the builder itself and every caller would see
  // zero rows, which hides the very behaviour these tests are meant to observe.
  c.then = vi.fn((resolve: (v: unknown) => void) => resolve(rowsFor(h.kind)));
  c.limit = vi.fn(async (n: number) => {
    h.order.push(`${h.kind}:limit(${n})`);
    return rowsFor(h.kind);
  });
  c.update = vi.fn((table: unknown) => { h.kind = which(table); return c; });
  c.set = vi.fn(() => c);
  c.insert = vi.fn((table: unknown) => {
    h.inserted = h.kind = which(table);
    return c;
  });
  c.values = vi.fn(async () => { h.order.push(`insert:${h.inserted}`); return c; });
  c.transaction = vi.fn(async (cb: (tx: Record<string, unknown>) => unknown) => {
    h.order.push('tx');
    return cb(c);
  });
  return c;
});

vi.mock('@/drizzle/db', () => ({ db: chain }));
vi.mock('@/drizzle/schema', () => h.tables);
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  and: (...parts: unknown[]) => ['and', ...parts],
  isNull: (a: unknown) => ['isNull', a],
  sql: (s: unknown) => ['sql', s],
  gt: (a: unknown, b: unknown) => ['gt', a, b],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  desc: (a: unknown) => ['desc', a],
  asc: (a: unknown) => ['asc', a],
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    h.order.push('auth-lookup');
    return await fn(chain);
  }),
  setTenantContext: vi.fn(async (tenantId: string, userId: string) => {
    h.order.push(`set-tenant(${tenantId},${userId})`);
  }),
}));

function request(key: string) {
  return {
    headers: { get: (name: string) => (name === 'authorization' ? `Bearer ${key}` : null) },
    nextUrl: { pathname: '/api/v1/contacts' },
    method: 'GET',
  } as unknown as import('next/server').NextRequest;
}

const ROW = {
  apiKey: { id: 'k1', tenantId: 't1', userId: 'u1', scopes: ['contacts:read'], expiresAt: null },
  isSuperAdmin: false,
};

async function auth(key = 'ak_live_' + 'a'.repeat(48)) {
  const { tryApiKeyAuth } = await import('@/lib/auth/api-key');
  return tryApiKeyAuth(request(key));
}

/** The FIRST predicate recorded for that table: a later usage-trail write reuses
 * the same kind, and the auth-lookup read is the one under test. */
const pred = (kind: string) => JSON.stringify(h.predicates[kind]?.[0] ?? null);

beforeEach(() => {
  vi.clearAllMocks();
  h.order = [];
  h.predicates = {};
  h.membershipRows = [{ id: 'tm-1' }];
  h.membershipThrows = false;
  h.keyRows = [ROW];
  h.kind = 'other';
  h.inserted = 'other';
});

describe('a key is only as live as its owner’s membership (#3291 ask 1)', () => {
  it('refuses a key whose owner has no active membership row', async () => {
    h.membershipRows = [];
    expect(await auth()).toBeNull();
  });

  it('does not write the usage trail for a refused key', async () => {
    // A removed user's key must not keep looking alive in `last_used_at`, or the
    // tenant's own key audit reads a credential that is being abused as used.
    h.membershipRows = [];
    await auth();
    expect(pred('api_keys')).not.toBeNull(); // the key WAS recognised, then refused
    expect(chain.values).not.toHaveBeenCalled();
    expect(h.order).not.toContain('insert:api_key_usage');
  });

  it('authenticates when the membership is active, with the same context shape', async () => {
    const ctx = await auth();
    expect(ctx).toMatchObject({ userId: 'u1', tenantId: 't1', roleSlug: 'api', isSuperAdmin: false });
    expect(ctx!.permissions).toEqual({ 'contacts:read': true });
  });

  it('asks for status = active and a live membership row, not merely for a row', async () => {
    await auth();
    const text = pred('tenant_members');
    expect(text).toContain('tenant_members.status');
    expect(text).toContain('active');
    expect(text).toContain('tenant_members.tenant_id');
    expect(text).toContain('tenant_members.user_id');
    expect(text).toContain('tenant_members.deleted_at');
  });

  it('reads the membership after adopting the key tenant, not inside the pre-auth lookup', async () => {
    // 0099's whole point: `app.current_tenant` is empty during the auth-lookup
    // read, so a tenant-isolated `tenant_members` read there matches zero rows and
    // every minted key would answer 401 — the feature dead on arrival.
    await auth();
    expect(h.order.indexOf('auth-lookup')).toBeLessThan(h.order.indexOf('set-tenant(t1,u1)'));
    expect(h.order.indexOf('set-tenant(t1,u1)')).toBeLessThan(h.order.indexOf('tenant_members:limit(1)'));
  });

  it('runs the membership read inside a transaction, so the GUC survives PgBouncer', async () => {
    // lib/db/rls.ts:82-90 — session GUCs do not survive transaction pooling;
    // `db.transaction` is what re-applies the carrier (PP-027).
    await auth();
    const txAt = h.order.indexOf('tx');
    const readAt = h.order.indexOf('tenant_members:limit(1)');
    expect(txAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(txAt);
  });

  it('denies rather than allows when the membership read throws', async () => {
    h.membershipThrows = true;
    expect(await auth()).toBeNull();
  });

  it('excludes a soft-deleted owner in the key lookup itself', async () => {
    await auth();
    expect(pred('api_keys')).toContain('users.deleted_at');
  });

  it('still refuses a key the lookup does not recognise, without reading membership', async () => {
    h.keyRows = [];
    expect(await auth()).toBeNull();
    expect(h.order).not.toContain('tenant_members:limit(1)');
  });

  it('leaves the expiry rule alone', async () => {
    h.keyRows = [{ ...ROW, apiKey: { ...ROW.apiKey, expiresAt: new Date(Date.now() - 1000) } }];
    expect(await auth()).toBeNull();
    expect(h.order).not.toContain('tenant_members:limit(1)');
  });
});

describe('hasActiveMembership, called directly as a resolvable predicate (#3291 ask 4)', () => {
  // All three resolvers reach the proof through keyOwnerIsLive, which short-circuits
  // a missing owner first. The exported form is the one a caller that already holds a
  // transaction uses — scripts/check-key-resolver-membership.mjs accepts either name —
  // so its own two arms are tested rather than inherited from the wrapper.
  async function prove(tenantId: string, userId: string | null | undefined) {
    const { hasActiveMembership } = await import('@/lib/auth/api-key-membership');
    return hasActiveMembership(chain as unknown as import('@/drizzle/db').DbClient, tenantId, userId);
  }

  it('is false for an ownerless key and asks the database nothing', async () => {
    expect(await prove('t1', null)).toBe(false);
    expect(await prove('t1', undefined)).toBe(false);
    expect(h.order.filter((o) => o.startsWith('tenant_members'))).toEqual([]);
  });

  it('is true only for a row matching all four predicates', async () => {
    expect(await prove('t1', 'u1')).toBe(true);
    const text = pred('tenant_members');
    for (const part of ['tenant_members.tenant_id', 'tenant_members.user_id',
      'tenant_members.status', 'active', 'isNull', 'tenant_members.deleted_at']) {
      expect(text).toContain(part);
    }
  });

  it('is false when no row matches', async () => {
    h.membershipRows = [];
    expect(await prove('t1', 'u1')).toBe(false);
  });
});
