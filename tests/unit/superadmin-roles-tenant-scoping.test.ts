/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// #29: /superadmin/tenants/[id]/roles used to read /api/tenant/roles, which
// resolves the caller's OWN tenant — so the console listed and edited the super
// admin's tenant instead of the one in the URL, and its create/delete buttons
// posted to routes that did not exist. These tests pin the two things that make
// the fix real: every statement runs in the PATH tenant's context, and a PATCH
// that only carries permissions cannot wipe the fields it never mentioned.

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const ROLE = 'b2222222-2222-4222-8222-222222222222';
const NON_UUID = 'not-a-uuid';

const harness = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    insertRows: [] as unknown[],
    setPayloads: [] as Record<string, unknown>[],
    updateCount: 0,
    insertCount: 0,
    contextTenant: '',
    contextUser: '',
  };
  const chain = (resolve: () => Promise<unknown>) => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.groupBy = () => c;
    c.limit = () => resolve();
    c.returning = () => resolve();
    c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => resolve().then(ok, err);
    return c;
  };
  const tx = {
    select: vi.fn(() => chain(() => Promise.resolve(state.rows))),
    update: vi.fn(() => {
      state.updateCount += 1;
      const c: Record<string, unknown> = {};
      c.set = (payload: Record<string, unknown>) => {
        state.setPayloads.push(payload);
        return c;
      };
      c.where = () => chain(() => Promise.resolve(state.rows));
      return c;
    }),
    insert: vi.fn(() => {
      state.insertCount += 1;
      const c: Record<string, unknown> = {};
      c.values = () => c;
      c.returning = () => chain(() => Promise.resolve(state.insertRows));
      return c;
    }),
  };
  return { state, tx };
});

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

// roles has tenant_isolation with no super-admin branch, so the only way the
// console can touch a tenant's rows is a transaction carrying THAT tenant.
vi.mock('@/lib/db/rls', () => ({
  withTenantContext: vi.fn((tenantId: string, userId: string, fn: (tx: unknown) => Promise<unknown>) => {
    harness.state.contextTenant = tenantId;
    harness.state.contextUser = userId;
    return fn(harness.tx);
  }),
}));

const auth = vi.hoisted(() => ({
  ctx: {
    tenantId: 'console-tenant',
    userId: 'console-user',
    isAdmin: true,
    isSuperAdmin: true,
    user: { email: 'sa@example.com' },
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.ctx),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/cache/sessions', () => ({ invalidateUserContexts: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/drizzle/db', () => ({ db: {} }));

import { withTenantContext } from '@/lib/db/rls';
import { logSuperAdminAction } from '@/lib/audit/super-admin';

async function call(
  mod: 'collection' | 'item',
  verb: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<Response> {
  const path =
    mod === 'collection'
      ? '@/app/api/superadmin/tenants/[id]/roles/route'
      : '@/app/api/superadmin/tenants/[id]/roles/[roleId]/route';
  const route = (await import(path)) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>;
  const init =
    verb === 'GET' || verb === 'DELETE'
      ? { method: verb }
      : { method: verb, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  const req = new Request(`http://localhost:3000/api/superadmin/tenants/${TENANT}/roles`, init);
  const params = mod === 'collection' ? { id: TENANT } : { id: TENANT, roleId: ROLE };
  return route[verb](req as unknown as NextRequest, { params: Promise.resolve(params) });
}

describe('superadmin tenant roles (#29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.rows = [];
    harness.state.insertRows = [];
    harness.state.setPayloads = [];
    harness.state.updateCount = 0;
    harness.state.insertCount = 0;
    harness.state.contextTenant = '';
    harness.state.contextUser = '';
    auth.ctx.isSuperAdmin = true;
    auth.ctx.tenantId = 'console-tenant';
  });

  it('runs every read and write in the tenant from the PATH, not the console account', async () => {
    harness.state.rows = [{ id: ROLE, name: 'Admin', slug: 'admin', is_system: true }];
    const res = await call('collection', 'GET');
    expect(res.status).toBe(200);
    expect(harness.state.contextTenant).toBe(TENANT);
    // The console account's own tenant id must never reach withTenantContext.
    expect(harness.state.contextTenant).not.toBe(auth.ctx.tenantId);
    expect(harness.state.contextUser).toBe('console-user');
  });

  it('rejects a non-super-admin before touching any tenant', async () => {
    auth.ctx.isSuperAdmin = false;
    const res = await call('collection', 'GET');
    expect(res.status).toBe(403);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid tenant segment with 400 instead of a 500', async () => {
    const route = await import('@/app/api/superadmin/tenants/[id]/roles/route');
    const req = new Request(`http://localhost:3000/api/superadmin/tenants/${NON_UUID}/roles`) as unknown as NextRequest;
    const res = await route.GET(req, { params: Promise.resolve({ id: NON_UUID }) });
    expect(res.status).toBe(400);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it('creates a role in the target tenant and audits it', async () => {
    harness.state.insertRows = [{ id: ROLE, tenantId: TENANT, name: 'Support', slug: 'support' }];
    const res = await call('collection', 'POST', { name: 'Support', description: 'Front line', permissions: { deals: true } });
    expect(res.status).toBe(201);
    expect(harness.state.contextTenant).toBe(TENANT);
    expect(harness.state.insertCount).toBe(1);
    expect(logSuperAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.created', targetId: TENANT })
    );
  });

  it('answers 409 when the slug is already taken', async () => {
    harness.state.rows = [{ id: ROLE }];
    const res = await call('collection', 'POST', { name: 'Support' });
    expect(res.status).toBe(409);
    expect(harness.state.insertCount).toBe(0);
  });

  it('PATCH with only permissions leaves name and description alone', async () => {
    harness.state.rows = [{ id: ROLE, name: 'Support' }];
    const res = await call('item', 'PATCH', { permissions: { deals: true } });
    expect(res.status).toBe(200);
    expect(harness.state.setPayloads).toHaveLength(1);
    const payload = harness.state.setPayloads[0];
    expect(Object.keys(payload).sort()).toEqual(['permissions', 'updatedAt']);
    expect(logSuperAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.updated', targetId: TENANT })
    );
  });

  it('PATCH with an empty body is refused rather than rewriting the row', async () => {
    const res = await call('item', 'PATCH', {});
    expect(res.status).toBe(400);
    expect(harness.state.updateCount).toBe(0);
  });

  it('refuses to delete a system role', async () => {
    harness.state.rows = [{ slug: 'admin', isSystem: true }];
    const res = await call('item', 'DELETE');
    expect(res.status).toBe(400);
    expect(harness.state.updateCount).toBe(0);
  });

  it('soft-deletes a custom role and audits it', async () => {
    harness.state.rows = [{ id: ROLE }];
    const res = await call('item', 'DELETE');
    expect(res.status).toBe(200);
    expect(harness.state.updateCount).toBe(1);
    expect(harness.state.setPayloads[0]).toHaveProperty('deletedAt');
    expect(logSuperAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.deleted', targetId: TENANT })
    );
  });
});
