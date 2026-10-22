/**
 * #3079 — PATCH /api/tenant/members action=change_role.
 * The 409 concurrency guard used to `return stale` from inside the
 * db.transaction callback, which merely resolved the transaction: the
 * response object was discarded, sessions were killed and the client got
 * {ok:true} for an UPDATE that matched zero rows. The guard must now reach
 * the caller, and the session invalidation must not run on a stale write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updateReturning: [] as unknown[][],
  deleteSessions: [] as string[],
  audits: [] as unknown[],
}));

vi.mock('@/drizzle/db', () => {
  const mkSelect = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => h.selects.shift() ?? [],
    };
    return chain;
  };
  const db: Record<string, unknown> = {
    select: mkSelect,
    update: () => {
      const chain: Record<string, unknown> = {
        set: () => chain,
        where: () => chain,
        returning: async () => h.updateReturning.shift() ?? [],
      };
      return chain;
    },
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  };
  return { db };
});
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: 'user-self',
    tenantId: 'tenant-1',
    email: 'a@b.com',
    isAdmin: true,
    isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/cache/sessions', () => ({
  deleteUserSessions: (userId: string) => { h.deleteSessions.push(userId); return Promise.resolve(); },
}));
vi.mock('@/lib/audit', () => ({
  logAudit: (rec: unknown) => { h.audits.push(rec); return Promise.resolve(); },
}));
vi.mock('@/lib/notifications', () => ({ createNotification: () => Promise.resolve() }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

function patchReq(body: unknown) {
  return new Request('http://localhost/api/tenant/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const TARGET = [{ userId: 'user-target', roleSlug: 'sales_rep', fullName: 'T', email: 't@b.com' }];

beforeEach(() => {
  vi.clearAllMocks();
  h.selects = [];
  h.updateReturning = [];
  h.deleteSessions = [];
  h.audits = [];
});

describe('PATCH members change_role stale guard (#3079)', () => {
  it('answers 409 when the guarded UPDATE matches zero rows and does NOT kill sessions', async () => {
    h.selects = [TARGET, []]; // target lookup, role lookup
    h.updateReturning = [[]]; // stale: RETURNING empty
    const { PATCH } = await import('@/app/api/tenant/members/route');
    const res = await PATCH(patchReq({
      memberId: 'm-1',
      action: 'change_role',
      role_slug: 'manager',
      expectedUpdatedAt: 1,
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Stale data') });
    expect(h.deleteSessions).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it('answers ok:true, audits and invalidates sessions on a fresh update', async () => {
    h.selects = [TARGET, []];
    h.updateReturning = [[{ id: 'm-1', roleSlug: 'manager' }]];
    const { PATCH } = await import('@/app/api/tenant/members/route');
    const res = await PATCH(patchReq({ memberId: 'm-1', action: 'change_role', role_slug: 'manager' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.deleteSessions).toEqual(['user-target']);
    expect(h.audits).toHaveLength(1);
  });
});
