/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — the bulk note writer needed a role gate per entity.
 *
 * `POST /api/tenant/notes/bulk` narrowed *which rows* it would write via
 * `ownerScope`, but never asked whether the caller's role may edit the entity.
 * A `sales_rep` without `deals.edit` could attach notes to deals it happened to
 * own while every single-deal PATCH refused it. The real `requirePerm` runs here
 * (only `requireAuth` is stubbed), and the DB counters prove the gate is before
 * the id-resolution read and the insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENTITY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const harness = vi.hoisted(() => ({ selects: 0, inserts: 0 }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      harness.selects += 1;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'offset']) builder[m] = chain;
      builder['then'] = (resolve: (v: unknown) => void) => resolve([{ id: ENTITY_ID }]);
      return builder;
    },
    insert: () => {
      harness.inserts += 1;
      return { values: () => Promise.resolve([{ id: 'note-1' }]) };
    },
  },
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(fn: T): T => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const bulkRoute = await import('@/app/api/tenant/notes/bulk/route');

function ctxWith(permissions: Record<string, boolean>, roleSlug = 'member'): AuthContext {
  return {
    userId: USER, tenantId: TENANT, roleSlug, permissions,
    isAdmin: roleSlug === 'admin', isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function run(ctx: AuthContext, entity_type: string): Promise<Response> {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return (bulkRoute.POST as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('/api/tenant/notes/bulk', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity_type, entity_ids: [ENTITY_ID], content: 'a note' }),
    }),
  );
}

const ENTITIES: [string, string][] = [
  ['contact', 'contacts.edit'],
  ['deal', 'deals.edit'],
  ['lead', 'leads.edit'],
  ['company', 'companies.edit'],
  ['task', 'tasks.edit'],
];

beforeEach(() => {
  vi.clearAllMocks();
  harness.selects = harness.inserts = 0;
});

describe('bulk notes require the entity edit permission (#3402)', () => {
  it.each(ENTITIES)('refuses a caller without %s.edit before touching the DB', async (entity, perm) => {
    const res = await run(ctxWith({}), entity);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(perm);
    expect(harness.selects).toBe(0);
    expect(harness.inserts).toBe(0);
  });

  it.each(ENTITIES)('a caller holding %s.edit may attach notes', async (entity, perm) => {
    const res = await run(ctxWith({ [perm]: true }), entity);
    expect(res.status).toBe(200);
    expect(harness.inserts).toBe(1);
  });

  it('lets an admin through without an explicit grant', async () => {
    expect((await run(ctxWith({}, 'admin'), 'deal')).status).toBe(200);
  });

  it('keeps the existing 400 for an unknown entity_type', async () => {
    expect((await run(ctxWith({}), 'invoice')).status).toBe(400);
    expect(harness.selects).toBe(0);
  });
});
