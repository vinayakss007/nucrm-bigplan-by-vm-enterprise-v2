/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3294 — the custom-entity DEFINITION mutators and the workspace currency setter were
 * open to any authenticated member.
 *
 * Both are schema/config that every user of the workspace shares: `POST
 * /api/tenant/custom-entities` and `PATCH`/`DELETE /api/tenant/custom-entities/[id]`
 * create, reshape and tombstone an entity type, and `POST /api/tenant/currency`
 * rewrites `tenants.settings->default_currency`, which is what quotes and invoices
 * are denominated in afterwards. Their closest sibling — the custom-field definition
 * routes — already requires `settings.manage` (#3001, `custom-fields-gate-3001.test.ts`),
 * so this is the same gate, in the same shape, on the four statements that were missed.
 *
 * WHAT IS DELIBERATELY LEFT OPEN
 * ------------------------------
 * The three GETs, and the per-record routes (`custom-entities/[id]/rows`,
 * `.../rows/[rowId]`), stay member-open: reading the data model and writing a value
 * into a record are not the same privilege as changing the model. The tests below
 * pin that boundary as firmly as they pin the gate, because a fix that reaches
 * "protect everything" breaks the workspace's day-to-day use, and a fix that gates
 * the writes but not the reads is the behaviour this issue asked for.
 *
 * The assertion that matters is not the 403, it is the counter next to it: a refusal
 * that has already run its INSERT/UPDATE is a refusal that changed the workspace.
 * Every 403 below therefore demands the handler wrote nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn(async (): unknown => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  isAdmin: false,
  isSuperAdmin: false,
  permissions: {},
}));

/** Writes the fake db actually executed, so a refusal can be proven to have touched nothing. */
const H = vi.hoisted(() => ({ insert: 0, update: 0 }));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(h: T) => h,
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: (request: NextRequest) => mockRequireAuth(request),
    // Mirrors the real can()/requirePerm semantics in lib/auth/middleware.ts.
    requirePerm: (ctx: { isAdmin?: boolean; isSuperAdmin?: boolean; permissions?: Record<string, boolean> }, perm: string) =>
      (ctx.isSuperAdmin || ctx.isAdmin || ctx.permissions?.['all'] === true || ctx.permissions?.[perm] === true)
        ? null
        : NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 }),
  };
});

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock('@/drizzle/db', () => {
  /**
   * A query builder that answers from every direction the three routes use
   * (`await chain`, `.limit(n)`, `.returning()`), so the shape of a drizzle chain is
   * not what is under test here.
   */
  const chainable = (result: unknown): any => ({
    from: () => chainable(result),
    where: () => chainable(result),
    orderBy: () => chainable(result),
    limit: () => chainable(result),
    offset: () => chainable(result),
    returning: () => chainable(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  });
  return {
    db: {
      select: () => chainable([{ id: 'ce-1', tenantId: 'tenant-1', name: 'Widget', settings: {} }]),
      insert: () => {
        H.insert += 1;
        return { values: () => chainable([{ id: 'ce-1' }]) };
      },
      update: () => {
        H.update += 1;
        return { set: () => chainable([{ id: 'ce-1' }]) };
      },
    },
  };
});

function request(path: string, body?: unknown, method = 'POST'): NextRequest {
  return new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest;
}

const PARAMS = { params: Promise.resolve({ id: 'ce-1' }) } as { params: Promise<{ id: string }> };

const MEMBER = { tenantId: 'tenant-1', userId: 'user-1', isAdmin: false, isSuperAdmin: false, permissions: {} };
const ADMIN = { tenantId: 'tenant-1', userId: 'user-1', isAdmin: true, isSuperAdmin: false, permissions: {} };

const CREATE_BODY = {
  slug: 'widgets', name: 'Widgets',
  fields: [{ name: 'size', type: 'text', required: false }],
  settings: {},
};

describe('custom-entity definitions and the workspace currency require settings.manage (#3294)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.insert = 0;
    H.update = 0;
    mockRequireAuth.mockResolvedValue(MEMBER);
  });

  it('POST /api/tenant/custom-entities: 403 for a member, and no row inserted', async () => {
    const { POST } = await import('@/app/api/tenant/custom-entities/route');

    const res = await POST(request('/api/tenant/custom-entities', CREATE_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('settings.manage');
    expect(H.insert, 'a refused create must not have defined an entity type').toBe(0);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await POST(request('/api/tenant/custom-entities', CREATE_BODY));
    expect(adminRes.status).toBe(201);
    expect(H.insert).toBe(1);
  });

  it('PATCH /api/tenant/custom-entities/[id]: 403 for a member, and no reshape', async () => {
    const { PATCH } = await import('@/app/api/tenant/custom-entities/[id]/route');

    const res = await PATCH(request('/api/tenant/custom-entities/ce-1', { name: 'Reshaped' }, 'PATCH'), PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('settings.manage');
    expect(H.update, 'a refused patch must not have rewritten the field list').toBe(0);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await PATCH(request('/api/tenant/custom-entities/ce-1', { name: 'Reshaped' }, 'PATCH'), PARAMS);
    expect(adminRes.status).toBe(200);
    expect(H.update).toBe(1);
  });

  it('DELETE /api/tenant/custom-entities/[id]: 403 for a member, and no tombstone', async () => {
    const { DELETE } = await import('@/app/api/tenant/custom-entities/[id]/route');

    const res = await DELETE(request('/api/tenant/custom-entities/ce-1', undefined, 'DELETE'), PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('settings.manage');
    // DELETE is a soft delete: the route UPDATEs deletedAt. Zero UPDATE calls is the
    // only proof that the tombstone did not land.
    expect(H.update, 'a member must not be able to tombstone a shared entity type').toBe(0);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await DELETE(request('/api/tenant/custom-entities/ce-1', undefined, 'DELETE'), PARAMS);
    expect(adminRes.status).toBe(200);
    expect(H.update).toBe(1);
  });

  it('POST /api/tenant/currency: 403 for a member, and tenants.settings untouched', async () => {
    const { POST } = await import('@/app/api/tenant/currency/route');

    const res = await POST(request('/api/tenant/currency', { currency: 'eur' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('settings.manage');
    expect(H.update, 'the default currency rewrites what every later invoice is denominated in').toBe(0);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await POST(request('/api/tenant/currency', { currency: 'eur' }));
    expect(adminRes.status).toBe(200);
    expect(H.update).toBe(1);
  });

  // ── the boundary the fix must not widen ──────────────────────────────

  it('the definition READS stay member-open', async () => {
    const collection = await import('@/app/api/tenant/custom-entities/route');
    const detail = await import('@/app/api/tenant/custom-entities/[id]/route');

    expect((await collection.GET(request('/api/tenant/custom-entities', undefined, 'GET'))).status).toBe(200);
    expect((await detail.GET(request('/api/tenant/custom-entities/ce-1', undefined, 'GET'), PARAMS)).status).toBe(200);
  });

  it('the currency GET stays member-open', async () => {
    const { GET } = await import('@/app/api/tenant/currency/route');
    const res = await GET(request('/api/tenant/currency', undefined, 'GET'));
    expect(res.status).toBe(200);
  });

  it('an unauthenticated caller is refused by requireAuth, before the permission check matters', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Session expired' }, { status: 401 }) as unknown as never,
    );
    const { POST } = await import('@/app/api/tenant/custom-entities/route');
    const res = await POST(request('/api/tenant/custom-entities', CREATE_BODY));
    expect(res.status).toBe(401);
    expect(H.insert).toBe(0);
  });

  it('a member holding settings.manage is enough — the gate is the permission, not isAdmin', async () => {
    mockRequireAuth.mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1', isAdmin: false, isSuperAdmin: false,
      permissions: { 'settings.manage': true },
    });
    const { POST } = await import('@/app/api/tenant/custom-entities/route');
    const res = await POST(request('/api/tenant/custom-entities', CREATE_BODY));
    expect(res.status).toBe(201);
  });
});
