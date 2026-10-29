/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3295 — `GET /api/leads/public` answers one unauthenticated boolean,
 * "is this person an active contact of workspace X", with no limit of any kind.
 * `POST` in the same file calls `checkRateLimit(request, { action: 'public_lead',
 * max: 20, windowMinutes: 60 })` at :47-50; the GET had nothing, so the
 * enumeration cost per record is one cheap GET with no backoff. Measured on the
 * host: eight back-to-back unauthenticated requests, all `200 {"exists":false}`,
 * never a 429.
 *
 * These tests drive the REAL handler through the REAL `checkRateLimit`
 * (`lib/rate-limit.ts`) over an in-memory counter store, because the property
 * worth pinning is the budget and not the call shape: `expect(checkRateLimit).to
 * HaveBeenCalled()` stays green while the limit is set to a million, and deleting
 * a guard line has to turn one of these red instead.
 *
 * Two budgets, per the issue's ask 1 — a per-caller one and a per-`tenant_id`
 * one — so that flooding one workspace cannot spend the quota every other
 * visitor of that workspace depends on, and a different workspace's traffic is
 * untouched by it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT_A = '10000000-0000-4000-8000-000000000001';
const TENANT_B = '20000000-0000-4000-8000-000000000002';
const EMAIL = 'ada@example.com';

const H = vi.hoisted(() => ({
  /** one entry per withTenantContext entry: the workspace the caller named */
  contexts: [] as string[],
  /** when set, the workspace lookup answers "this contact exists" */
  contactRow: null as unknown,
  /** every counter key the limiter touched, in order */
  keys: [] as string[],
}));

// In-memory sliding-window store, so the limiter's own arithmetic is exercised.
vi.mock('@/lib/cache/index', () => {
  const store = new Map<string, number>();
  return {
    cache: {
      incr: vi.fn(async (key: string) => {
        const current = (store.get(key) ?? 0) + 1;
        store.set(key, current);
        H.keys.push(key);
        return current;
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? 0),
      set: vi.fn(async () => undefined),
      del: vi.fn(async (key: string) => { store.delete(key); }),
      __reset: () => {
        store.clear();
        H.keys.length = 0;
      },
    },
  };
});

// The client address, the way a forwarding proxy would hand it over.
vi.mock('@/lib/client-ip', () => ({
  getClientIp: (request: Request) =>
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
}));

// No DB behind these tests: every limit therefore comes from the caller's own
// `max`, which is what `getRateLimit` falls back to when the lookup answers 0.
vi.mock('@/drizzle/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'values', 'returning', 'set']) chain[m] = () => chain;
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve([]);
  return {
    db: {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
      query: {},
      execute: async () => ({ rows: [] }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  };
});

vi.mock('@/lib/db/rls', () => ({
  NO_USER_SENTINEL: '00000000-0000-0000-0000-000000000000',
  withTenantContext: vi.fn(async (tenantId: string, _userId: string, fn: (tx: unknown) => Promise<unknown>) => {
    H.contexts.push(tenantId);
    return fn({ query: { contacts: { findFirst: async () => H.contactRow } } });
  }),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));

async function get(tenantId: string, email = EMAIL, ip = '203.0.113.1'): Promise<Response> {
  const { GET } = await import('@/app/api/leads/public/route');
  const url =
    `http://localhost/api/leads/public?email=${encodeURIComponent(email)}` +
    `&tenant_id=${encodeURIComponent(tenantId)}`;
  return GET(new NextRequest(url, { headers: { 'x-forwarded-for': ip } }));
}

async function bareGet(): Promise<Response> {
  const { GET } = await import('@/app/api/leads/public/route');
  return GET(new NextRequest('http://localhost/api/leads/public'));
}

describe('GET /api/leads/public is a budgeted endpoint (#3295)', () => {
  beforeEach(async () => {
    const { cache } = (await import('@/lib/cache/index')) as unknown as { cache: { __reset: () => void } };
    cache.__reset();
    H.contexts.length = 0;
    H.contactRow = null;
  });

  it('refuses an enumeration run once the per-caller budget is spent', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await get(TENANT_A)).status);
    expect(codes.slice(0, 10)).toEqual(new Array(10).fill(200));
    expect(codes[10], 'the 11th probe from the same address must be refused').toBe(429);
  });

  it('does not look the caller up in a workspace it has already refused', async () => {
    for (let i = 0; i < 11; i++) await get(TENANT_A);
    H.contexts.length = 0;
    expect((await get(TENANT_A)).status).toBe(429);
    const refused = await get(TENANT_A);
    expect(refused.status).toBe(429);
    expect(H.contexts, 'a refused request must not spend a context or a round trip').toEqual([]);
  });

  it('gives each workspace its own budget, so one run cannot spend another', async () => {
    // 60 probes against A from 60 distinct addresses: every caller stays under
    // its own per-IP cap, so only a workspace-scoped counter can see this run.
    for (let i = 0; i < 60; i++) {
      expect((await get(TENANT_A, EMAIL, `198.51.100.${i + 1}`)).status).toBe(200);
    }
    const exhausted = await get(TENANT_A, EMAIL, '198.51.102.1');
    expect(exhausted.status, 'A has taken 60 probes across 60 addresses').toBe(429);
    expect((await get(TENANT_B, EMAIL, '198.51.101.1')).status, 'B was never flooded').toBe(200);
  });

  it('answers the same shape it always did, and confirms nothing more', async () => {
    H.contactRow = { id: 'c0000000-0000-4000-8000-000000000001' };
    expect(await (await get(TENANT_A)).json()).toEqual({ exists: true });
    H.contactRow = null;
    expect(await (await get(TENANT_A)).json()).toEqual({ exists: false });
  });

  it('keeps a malformed workspace id out of both the budget keys and the workspace', async () => {
    // tenant_id arrives from the query string and is used to name a counter key,
    // so `*`, a newline or a 4 KB blob must not reach either the store or a
    // withTenantContext call.
    const nasty = '*\n../../etc/passwd';
    const res = await get(TENANT_A + nasty);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
    expect(H.contexts).toEqual([]);
    expect(H.keys.every((k) => !k.includes(nasty)), H.keys.join(' | ')).toBe(true);
  });

  it('keeps the missing-parameter answer free of a workspace read', async () => {
    expect(await (await bareGet()).json()).toEqual({ exists: false });
    expect(H.contexts).toEqual([]);
  });
});
