/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 ask 4 (behaviour half) — the OTHER two resolvers of `apiKeys.keyHash`.
 *
 * `tryApiKeyAuth` was not the only credential lookup that accepted a key hash and
 * a `isActive` flag and called that authentication. The screen added with this
 * issue walks the tree for anything that reads `apiKeys.keyHash`; these are the
 * three files it finds, so the invariant is not decoration:
 *
 *   - lib/auth/api-key.ts          `tryApiKeyAuth`     (pinned in
 *                                                       api-key-membership-3291.test.ts)
 *   - lib/webhooks/inbound-auth.ts `resolveApiKey`     — inbound webhook delivery
 *                                                       for an `ak_` key
 *   - app/api/tenant/visitors/track `x-api-key`        — a PUBLIC beacon that
 *                                                       resolves the tenant from
 *                                                       the key and then writes
 *                                                       page_views/visitors into it
 *
 * Both of the latter two therefore have to prove the key's owner is still an
 * active member before the credential buys anything: `resolveApiKey` must not
 * bump `last_used_at`/`call_count` for a refused key, and the tracker must answer
 * 401 rather than accept writes into a removed member's workspace.
 *
 * The membership proof is mocked here, as a collaborator with the documented
 * contract (live only for a non-null owner whose tenant proves out). What the
 * predicate itself means is pinned in api-key-membership-3291.test.ts and
 * lib/auth/api-key-membership.ts — this file pins that the resolvers consult it,
 * in the right order, and deny when it says no.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = 'a1111111-1111-4111-8111-111111111111';
const VALID_VISITOR = 'b2222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  live: true,
  proofs: [] as [string, string | null | undefined][],
  order: [] as string[],
  writes: [] as unknown[],
  keyRow: undefined as unknown,
}));

/**
 * Mirror of the real contract: no owner ⇒ nothing to prove ⇒ not live. Keeping
 * that rule here is what makes the ownerless-key test below mean something even
 * though the helper itself is stubbed.
 */
vi.mock('@/lib/auth/api-key-membership', () => ({
  keyOwnerIsLive: async (tenantId: string, userId: string | null | undefined) => {
    h.order.push('proof');
    h.proofs.push([tenantId, userId]);
    return h.live && userId != null;
  },
  hasActiveMembership: async (_tx: unknown, tenantId: string, userId: string | null | undefined) => {
    h.order.push('proof');
    h.proofs.push([tenantId, userId]);
    return h.live && userId != null;
  },
}));

const db = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(async (n: number) => {
    h.order.push(`limit(${n})`);
    return chain._rows ?? (Array.isArray(h.keyRow) ? h.keyRow : [h.keyRow]);
  });
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(chain._rows ?? (Array.isArray(h.keyRow) ? h.keyRow : [h.keyRow])),
  );
  chain.set = vi.fn(() => chain);
  chain.update = vi.fn(() => { h.order.push('key-write'); return chain; });
  chain.insert = vi.fn(() => { h.order.push('insert'); return chain; });
  chain.values = vi.fn((v: unknown) => { h.writes.push(v); return chain; });
  chain.onConflictDoUpdate = vi.fn(async () => undefined);
  chain.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
    h.order.push('tx');
    return cb(chain);
  });
  chain.query = {
    apiKeys: {
      findFirst: vi.fn(async () => {
        h.order.push('key-read');
        return h.keyRow ?? null;
      }),
    },
  };
  return chain;
});

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/db/rls', () => ({
  withAuthLookupContext: vi.fn(async (fn: (tx: unknown) => unknown) => {
    h.order.push('auth-lookup');
    return fn(db);
  }),
  setTenantContext: vi.fn(async (tenantId: string) => { h.order.push(`set-tenant(${tenantId})`); }),
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/rate-limit-simple', () => ({ checkPublicRateLimit: vi.fn(() => undefined) }));
vi.mock('@/lib/visitor-tracking', () => ({ scorePageUrl: vi.fn(() => 5) }));

function trackRequest(body: unknown, apiKey = 'ak_live_tracking') {
  return new Request('http://localhost:3000/api/tenant/visitors/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.live = true;
  h.proofs = [];
  h.order = [];
  h.writes = [];
  h.keyRow = undefined;
  db._rows = undefined;
});

describe('resolveApiKey proves the owner before the credential buys anything (#3291)', () => {
  async function resolve(rawKey: string) {
    const { resolveApiKey } = await import('@/lib/webhooks/inbound-auth');
    return resolveApiKey(rawKey);
  }

  const INBOUND_ROW = {
    id: 'k1', tenantId: TENANT_ID, userId: 'u1', name: 'CI', prefix: 'ak_live_x',
  };

  it('refuses a key whose owner is no longer an active member', async () => {
    h.keyRow = INBOUND_ROW;
    h.live = false;
    expect(await resolve('ak_live_a')).toBeNull();
    // A refused key must not look alive in the usage columns either.
    expect(h.order).not.toContain('key-write');
    expect(h.order).not.toContain('tx');
  });

  it('resolves, and proves after adopting the tenant', async () => {
    h.keyRow = INBOUND_ROW;
    expect(await resolve('ak_live_b')).toMatchObject({ id: 'k1', tenantId: TENANT_ID });
    expect(h.proofs).toEqual([[TENANT_ID, 'u1']]);
    expect(h.order.indexOf('set-tenant(' + TENANT_ID + ')')).toBeLessThan(h.order.indexOf('proof'));
    expect(h.order.indexOf('proof')).toBeLessThan(h.order.indexOf('key-write'));
  });

  it('refuses an ownerless key: there is no membership to prove', async () => {
    h.keyRow = { ...INBOUND_ROW, userId: null };
    expect(await resolve('ak_live_c')).toBeNull();
    expect(h.proofs).toEqual([[TENANT_ID, null]]);
    expect(h.order).not.toContain('key-write');
  });

  it('still refuses a key the lookup does not find, without proving anything', async () => {
    h.keyRow = null;
    expect(await resolve('ak_live_d')).toBeNull();
    expect(h.proofs).toHaveLength(0);
  });

});

describe('the public visitor beacon proves the key owner (#3291)', () => {
  async function track(body: unknown) {
    const { POST } = await import('@/app/api/tenant/visitors/track/route');
    return POST(trackRequest(body));
  }

  const OK_BODY = { visitorId: VALID_VISITOR, url: 'https://customer.example/pricing' };

  it('answers 401 and writes nothing when the owner is no longer a member', async () => {
    db._rows = [{ tenantId: TENANT_ID, userId: 'u1' }];
    h.live = false;
    const res = await track(OK_BODY);
    expect(res.status).toBe(401);
    expect(h.writes).toHaveLength(0);
    expect(h.proofs).toEqual([[TENANT_ID, 'u1']]);
  });

  it('accepts the beacon when the owner is a live member', async () => {
    db._rows = [{ tenantId: TENANT_ID, userId: 'u1' }];
    const res = await track(OK_BODY);
    expect(res.status).toBe(200);
    expect(h.proofs).toEqual([[TENANT_ID, 'u1']]);
    expect(h.writes.length).toBeGreaterThan(0);
  });

  it('proves before the write transaction, not after', async () => {
    db._rows = [{ tenantId: TENANT_ID, userId: 'u1' }];
    await track(OK_BODY);
    expect(h.order.indexOf('proof')).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf('proof')).toBeLessThan(h.order.indexOf('tx'));
  });

  it('refuses an ownerless key', async () => {
    db._rows = [{ tenantId: TENANT_ID, userId: null }];
    const res = await track(OK_BODY);
    expect(res.status).toBe(401);
    expect(h.writes).toHaveLength(0);
  });

  it('still answers 401 for an unknown key without consulting membership', async () => {
    db._rows = [];
    const res = await track(OK_BODY);
    expect(res.status).toBe(401);
    expect(h.proofs).toHaveLength(0);
  });
});
