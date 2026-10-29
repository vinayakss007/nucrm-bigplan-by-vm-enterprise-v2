/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3295 needs a budget that is not keyed on the caller's address: an anonymous
 * existence-check has to ration one *workspace* against the flood aimed at it,
 * and `checkRateLimit` could only ever build `v1_rate:${action}:${ip}`.
 *
 * The option has to be added without weakening the two things the file is
 * actually load-bearing for: #2630's fail-closed refusal when an auth-scoped
 * action cannot resolve a client address, and #1834's fail-closed deny when the
 * counter store is unavailable. A caller that passes a scope is still subject to
 * both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const H = vi.hoisted(() => ({ keys: [] as string[] }));

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
      __store: store,
    },
  };
});

vi.mock('@/lib/client-ip', () => ({
  getClientIp: (request: Request) =>
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
}));

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
      query: { systemSettings: { findFirst: async () => undefined } },
      execute: async () => ({ rows: [] }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  };
});

function req(ip = '203.0.113.9'): NextRequest {
  return new NextRequest('http://localhost/api/anything', { headers: { 'x-forwarded-for': ip } });
}

const { checkRateLimit } = await import('@/lib/rate-limit');
const { cache } = await import('@/lib/cache/index');

describe('a rate-limit budget keyed on something other than the address (#3295)', () => {
  beforeEach(() => {
    (cache as unknown as { __reset: () => void }).__reset();
  });

  it('gives two scopes two budgets', async () => {
    const opts = { action: 'lead_exists-tenant', max: 3, windowMinutes: 60 };
    for (let i = 0; i < 3; i++) expect(await checkRateLimit(req(), { ...opts, scopeKey: 'tenant-A' })).toBeNull();
    expect((await checkRateLimit(req(), { ...opts, scopeKey: 'tenant-A' }))?.status, 'A is spent').toBe(429);
    expect(await checkRateLimit(req(), { ...opts, scopeKey: 'tenant-B' }), 'B never asked for A').toBeNull();
  });

  it('still keys on the caller when no scope is given', async () => {
    const opts = { action: 'plain', max: 2, windowMinutes: 60 };
    expect(await checkRateLimit(req('192.0.2.1'), opts)).toBeNull();
    expect(await checkRateLimit(req('192.0.2.2'), opts), 'a second address has its own budget').toBeNull();
    expect(await checkRateLimit(req('192.0.2.1'), opts)).toBeNull();
    expect((await checkRateLimit(req('192.0.2.1'), opts))?.status, 'the third from .1 is over a max of 2').toBe(429);
    expect((await checkRateLimit(req('192.0.2.2'), opts))?.status, 'and .2 is not yet').toBeUndefined();
  });

  it('does not let a scope become a way to skip the #2630 fail-closed refusal', async () => {
    // `login` is auth-scoped: without a resolvable client address the bucket
    // would be shared by every caller on the internet, and naming a scope does
    // not change that.
    const noIp = new NextRequest('http://localhost/api/auth/login');
    const res = await checkRateLimit(noIp, { action: 'login', max: 5, windowMinutes: 5, scopeKey: 'tenant-A' });
    expect(res?.status, 'a scope is an addition to the address check, not a replacement').toBe(503);
  });

  it('never lets the scope add a segment to the key it builds', async () => {
    const evil = 'abc\nrate:injected:*';
    await checkRateLimit(req(), { action: 'scoped', max: 5, windowMinutes: 60, scopeKey: evil });
    const key = H.keys.at(-1) ?? '';
    expect(key).not.toMatch(/[\n\r]/);
    // `v1_rate:<action>:<scope>` — a scope that could smuggle separators would
    // spend someone else's bucket, or name a bucket no operator can see.
    expect(key.split(':').length, `key shape leaked the scope: ${key}`).toBe(4);
  });

  it('bounds the key it builds, however long the scope is', async () => {
    const long = 'z'.repeat(5000);
    await checkRateLimit(req(), { action: 'scoped', max: 5, windowMinutes: 60, scopeKey: long });
    const key = H.keys.at(-1) ?? '';
    expect(key.length, 'a Redis key must not be sized by a query parameter').toBeLessThan(200);
  });

  it('is deterministic, so the same scope keeps spending the same budget', async () => {
    const opts = { action: 'scoped', max: 4, windowMinutes: 60, scopeKey: 'tenant-A' };
    await checkRateLimit(req(), opts);
    const first = H.keys.at(-1);
    await checkRateLimit(req(), opts);
    expect(H.keys.at(-1)).toBe(first);
  });
});
