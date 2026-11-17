/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — advanced search's role gate.
 *
 * The Filters panel (`POST /api/tenant/search/advanced`) narrowed rows with
 * `ownerScope` and field permissions, but never asked whether the caller's role
 * may view the entity at all. That made a revoked `<entity>.view` ineffective
 * here while every list/detail route enforces it. The real `requirePerm` runs in
 * this spec — only `requireAuth` is stubbed — and the DB count proves the gate
 * fires before any query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const harness = vi.hoisted(() => ({ selects: 0 }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      harness.selects += 1;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'groupBy', 'limit', 'offset']) {
        builder[m] = chain;
      }
      builder['then'] = (resolve: (v: unknown) => void) => resolve([]);
      return builder;
    },
  },
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(fn: T): T => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const advanced = await import('@/app/api/tenant/search/advanced/route');

function ctxWith(permissions: Record<string, boolean>, roleSlug = 'member'): AuthContext {
  return {
    userId: USER,
    tenantId: TENANT,
    roleSlug,
    permissions,
    isAdmin: roleSlug === 'admin',
    isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function run(ctx: AuthContext, body: Record<string, unknown>): Promise<Response> {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return (advanced.POST as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('/api/tenant/search/advanced', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const ENTITIES: [string, string][] = [
  ['contacts', 'contacts.view'],
  ['leads', 'leads.view'],
  ['deals', 'deals.view'],
  ['companies', 'companies.view'],
  ['tasks', 'tasks.view'],
];

beforeEach(() => {
  vi.clearAllMocks();
  harness.selects = 0;
});

describe('advanced search requires the entity\'s view permission (#3402)', () => {
  it.each(ENTITIES)('a role without %s.view is refused before a query', async (type, perm) => {
    const res = await run(ctxWith({}), { type, query: 'acme' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(perm);
    expect(harness.selects).toBe(0);
  });

  it.each(ENTITIES)('a role holding %s.view can search that entity', async (type, perm) => {
    const res = await run(ctxWith({ [perm]: true }), { type });
    expect(res.status).toBe(200);
    expect(harness.selects).toBeGreaterThan(0);
  });

  it('an admin passes without an explicit grant', async () => {
    const res = await run(ctxWith({}, 'admin'), { type: 'deals' });
    expect(res.status).toBe(200);
  });

  it('an unknown type still takes the existing 400 branch, not a 403', async () => {
    const res = await run(ctxWith({}), { type: 'not-an-entity' });
    expect(res.status).toBe(400);
  });
});
