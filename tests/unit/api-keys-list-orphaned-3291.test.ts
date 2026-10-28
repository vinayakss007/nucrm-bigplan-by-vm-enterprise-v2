/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 ask 3 — an admin must be able to SEE the exposure.
 *
 * `GET /api/tenant/api-keys` listed `api_keys` columns only, so a key belonging
 * to a removed member looked exactly like a key belonging to the owner. The issue
 * puts it plainly: "Nothing in the app surfaces that a key belongs to a removed
 * person", which is how a standing credential ends up discovered in a
 * post-incident review instead of in the settings page.
 *
 * The list read now joins the owner's membership and reports `orphaned`, keyed on
 * the same predicate the auth path uses (`status = 'active'`, not soft-deleted),
 * so the two cannot drift apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { tenantMembers } from '@/drizzle/schema';

const TENANT_ID = '00000000-0000-0000-0000-00000000000t';
const h = vi.hoisted(() => ({
  projections: [] as Record<string, unknown>[],
  froms: [] as unknown[],
  joins: [] as { table: unknown; on: unknown }[],
  wheres: [] as unknown[],
  rows: [] as Record<string, unknown>[],
}));

function predicateText(predicate: unknown): string {
  const isColumn = (node: any) =>
    !!node && typeof node === 'object' && typeof node.name === 'string' &&
    typeof node.table?.name === 'string';
  const walk = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join(' ');
    const holder = node as any;
    if (isColumn(holder)) return `${holder.table.name}.${holder.name}`;
    if (Array.isArray(holder?.queryChunks)) return holder.queryChunks.map(walk).join(' ');
    if (holder?.value !== undefined) return String(holder.value);
    return typeof holder?.name === 'string' ? holder.name : '';
  };
  return walk(predicate);
}

vi.mock('@/drizzle/db', () => {
  const query = () => {
    const self: Record<string, unknown> = {};
    self.from = (table: unknown) => { h.froms.push(table); return self; };
    self.innerJoin = (table: unknown, on: unknown) => { h.joins.push({ table, on }); return self; };
    self.leftJoin = (table: unknown, on: unknown) => { h.joins.push({ table, on }); return self; };
    self.where = (p: unknown) => { h.wheres.push(p); return self; };
    self.orderBy = () => self;
    self.limit = async () => h.rows;
    self.then = (resolve: (v: unknown) => void) => resolve(h.rows);
    return self;
  };
  const db: Record<string, unknown> = {
    select: (projection?: Record<string, unknown>) => {
      if (projection) h.projections.push(projection);
      return query();
    },
  };
  return { db };
});
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: 'user-admin', tenantId: TENANT_ID, email: 'a@b.com',
    isAdmin: true, isSuperAdmin: false,
  }),
  can: () => true,
}));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

const KEY = {
  id: 'key-1', name: 'CI', key_prefix: 'ak_live_x', scopes: ['all'],
  is_active: true, expires_at: null, last_used_at: null, created_at: new Date('2026-01-01'),
};

async function get() {
  const { GET } = await import('@/app/api/tenant/api-keys/route');
  const res = await GET(new Request('http://localhost/api/tenant/api-keys', {
    method: 'GET',
  }) as unknown as NextRequest);
  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.projections = [];
  h.froms = [];
  h.joins = [];
  h.wheres = [];
  h.rows = [];
});

describe('GET /api/tenant/api-keys reports orphaned keys (#3291 ask 3)', () => {
  it('marks a key whose owner has no membership row orphaned', async () => {
    h.rows = [{ ...KEY, memberStatus: null, memberDeletedAt: null }];
    const { body } = await get();
    expect(body.data[0]).toMatchObject({ id: 'key-1', orphaned: true });
  });

  it('does not mark a key owned by an active member orphaned', async () => {
    h.rows = [{ ...KEY, memberStatus: 'active', memberDeletedAt: null }];
    const { body } = await get();
    expect(body.data[0]).toMatchObject({ orphaned: false });
  });

  it('treats a suspended or removed membership as orphaned, and a soft-deleted one too', async () => {
    for (const status of ['suspended', 'removed', 'inactive', 'pending']) {
      h.rows = [{ ...KEY, memberStatus: status, memberDeletedAt: null }];
      const { body } = await get();
      expect(body.data[0], status).toMatchObject({ orphaned: true });
    }
    h.rows = [{ ...KEY, memberStatus: 'active', memberDeletedAt: new Date('2026-02-02') }];
    const { body } = await get();
    expect(body.data[0]).toMatchObject({ orphaned: true });
  });

  it('joins the owner membership for the tenant it is listing, rather than per key', async () => {
    h.rows = [];
    await get();
    expect(h.projections).toHaveLength(1); // one round trip, not N membership probes
    // Identity, not a key name: what matters is that the listing reads the
    // membership column the auth path keys on.
    expect(Object.values(h.projections[0])).toContain(tenantMembers.status);
    expect(h.joins).toHaveLength(1);
    const on = predicateText(h.joins[0].on);
    expect(on).toContain('tenant_members.user_id');
    expect(on).toContain('api_keys.user_id');
    expect(on).toContain('tenant_members.tenant_id');
    // The listing itself stays inside the caller's workspace.
    expect(predicateText(h.wheres[0])).toContain(TENANT_ID);
  });

  it('does not leak the joined membership columns into the response', async () => {
    h.rows = [{ ...KEY, memberStatus: 'active', memberDeletedAt: null }];
    const { body } = await get();
    expect(body.data[0]).not.toHaveProperty('memberStatus');
    expect(body.data[0]).not.toHaveProperty('memberDeletedAt');
    expect(body.data[0]).toEqual(expect.objectContaining({ name: 'CI', key_prefix: 'ak_live_x' }));
  });

  it('keeps reporting is_active and the rest of the row untouched', async () => {
    h.rows = [{ ...KEY, memberStatus: 'active', memberDeletedAt: null }];
    const { body } = await get();
    expect(body.data[0]).toMatchObject({ is_active: true, scopes: ['all'] });
  });
});
