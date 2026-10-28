/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 ask 2 — revocation must be a consequence of the membership write.
 *
 * `PATCH /api/tenant/members` already does the right thing for the JWT path
 * (`deleteUserSessions`) and nothing for the key path:
 *
 * ```ts
 * await tx.update(tenantMembers).set({ status: 'removed' }).where(eq(tenantMembers.id, memberId));
 * ```
 *
 * `api_keys` is never touched, so an offboarded member keeps `/api/v1/**`
 * read/write for the tenant. Two halves are pinned:
 *
 *   A. `revokeUserApiKeys` — scoped by tenant AND user (one admin removing one
 *      member must not deactivate another tenant's keys, or this tenant's other
 *      members'), restricted to rows that are still live, and honest about the
 *      row count instead of the unconditional `return true` that #2562/#3079 keep
 *      finding elsewhere;
 *   B. the members route calls it for `remove` and `suspend`, inside the same
 *      transaction as the membership write, audits the count, and does NOT call
 *      it for `reactivate` (re-activating a membership must not hand back a
 *      credential the tenant deliberately revoked) or `change_role`.
 *
 * The api-key module is wrapped, not replaced: the route assertions observe the
 * real UPDATE the helper issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  events: [] as string[],
  txDepth: 0,
  updates: [] as { table: string; set: Record<string, unknown>; where: unknown; depth: number }[],
  selects: [] as unknown[][],
  updateRows: [] as unknown[],
  revoked: [] as { tenantId: string; userId: string; depth: number }[],
  audits: [] as Record<string, unknown>[],
  killedSessions: [] as string[],
}));

/** Real drizzle SQL nodes need a walker, not `String(node)`. */
function predicateText(predicate: unknown): string {
  const walk = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join(' ');
    const holder = node as { queryChunks?: unknown[]; value?: unknown; name?: unknown };
    if (Array.isArray(holder.queryChunks)) return holder.queryChunks.map(walk).join(' ');
    if (holder.value !== undefined) return String(holder.value);
    return typeof holder.name === 'string' ? holder.name : '';
  };
  return walk(predicate);
}

const tableName = (table: unknown) => String((table as { name?: string })?.name ?? table);

type Fake = Record<string, any>;

function mkQuery(kind: 'select' | 'update' | 'insert', table: string): Fake {
  const q: Fake = { _rows: undefined };
  const record = (set: unknown, where: unknown) => {
    if (kind !== 'update') return;
    h.events.push(`update:${table}@${h.txDepth}`);
    h.updates.push({ table, set: set as Record<string, unknown>, where, depth: h.txDepth });
  };
  const self: Fake = new Proxy({} as Fake, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve(q._rows ?? (kind === 'select' ? [] : h.updateRows));
      }
      if (prop === 'from' || prop === 'innerJoin' || prop === 'leftJoin' || prop === 'orderBy') {
        return () => self;
      }
      if (prop === 'where') {
        return (p: unknown) => { q._where = p; record(q._set, p); return self; };
      }
      if (prop === 'set') {
        return (obj: Record<string, unknown>) => { q._set = obj; return self; };
      }
      if (prop === 'values') {
        return (v: unknown) => { q._values = v; return self; };
      }
      if (prop === 'returning') {
        return () => self;
      }
      if (prop === 'limit') {
        return async () => {
          q._rows = kind === 'select' ? h.selects.shift() ?? [] : [];
          return q._rows;
        };
      }
      return self;
    },
  });
  return self;
}

vi.mock('@/drizzle/db', () => {
  const db: Fake = {};
  db.select = () => mkQuery('select', 'select');
  db.update = (table: unknown) => mkQuery('update', tableName(table));
  db.insert = (table: unknown) => mkQuery('insert', tableName(table));
  db.transaction = async (cb: (tx: Fake) => unknown) => {
    h.txDepth += 1;
    h.events.push('tx:start');
    try {
      return await cb(db);
    } finally {
      h.events.push('tx:end');
      h.txDepth -= 1;
    }
  };
  return { db };
});
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: 'user-admin', tenantId: 'tenant-1', email: 'a@b.com',
    isAdmin: true, isSuperAdmin: false,
  }),
  can: () => true,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/cache/sessions', () => ({
  deleteUserSessions: (userId: string) => { h.killedSessions.push(userId); return Promise.resolve(); },
}));
vi.mock('@/lib/audit', () => ({
  logAudit: (rec: Record<string, unknown>) => { h.audits.push(rec); return Promise.resolve(); },
}));
vi.mock('@/lib/notifications', () => ({ createNotification: () => Promise.resolve() }));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve() }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));
vi.mock('@/lib/auth/api-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/api-key')>();
  return {
    ...actual,
    revokeUserApiKeys: async (tx: never, tenantId: string, userId: string) => {
      h.revoked.push({ tenantId, userId, depth: h.txDepth });
      h.events.push(`revoke:${tenantId}/${userId}@${h.txDepth}`);
      return actual.revokeUserApiKeys(tx, tenantId, userId);
    },
  };
});

const TARGET = { userId: 'user-target', roleSlug: 'sales_rep', fullName: 'T', email: 't@b.com' };

function patchReq(body: unknown) {
  return new Request('http://localhost/api/tenant/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function patch(body: unknown) {
  h.selects = [[TARGET]];
  const { PATCH } = await import('@/app/api/tenant/members/route');
  return PATCH(patchReq(body));
}

const keysUpdate = () => h.updates.find((u) => u.table === 'api_keys');

beforeEach(() => {
  vi.clearAllMocks();
  h.events = [];
  h.txDepth = 0;
  h.updates = [];
  h.selects = [];
  h.updateRows = [{ id: 'm-1' }];
  h.revoked = [];
  h.audits = [];
  h.killedSessions = [];
});

describe('revokeUserApiKeys (#3291 ask 2)', () => {
  it('deactivates only that user’s live keys in that tenant, and reports how many', async () => {
    const captured: { set?: Record<string, unknown>; where?: unknown } = {};
    const tx = {
      update: () => ({
        set: (obj: Record<string, unknown>) => { captured.set = obj; return tx.update(); },
        where: (p: unknown) => {
          captured.where = p;
          return { returning: async () => [{ id: 'key-1' }] };
        },
      }),
    };
    const { revokeUserApiKeys } = await import('@/lib/auth/api-key');
    const revoked = await revokeUserApiKeys(tx as never, 'tenant-9', 'user-7');

    expect(revoked).toEqual(['key-1']);
    expect(captured.set).toMatchObject({ isActive: false });
    const text = predicateText(captured.where);
    expect(text).toContain('tenant-9');
    expect(text).toContain('user-7');
    expect(text).toContain('tenant_id');
    expect(text).toContain('user_id');
    // Only live rows: the count is the exposure an admin is told about, and a
    // re-revoke of an already-dead key must not inflate it.
    expect(text).toContain('is_active');
  });

  it('reports zero rather than claiming success when nothing matched', async () => {
    const tx = {
      update: () => ({
        set: () => tx.update(),
        where: () => ({ returning: async () => [] }),
      }),
    };
    const { revokeUserApiKeys } = await import('@/lib/auth/api-key');
    expect(await revokeUserApiKeys(tx as never, 'tenant-9', 'user-7')).toEqual([]);
  });
});

describe('member offboarding revokes keys (#3291 ask 2)', () => {
  it('revokes inside the removal transaction, for the target, and audits the count', async () => {
    const res = await patch({ memberId: 'm-1', action: 'remove', reason: 'left' });
    expect(res.status).toBe(200);

    expect(h.revoked).toEqual([{ tenantId: 'tenant-1', userId: 'user-target', depth: 1 }]);
    const membershipWrite = h.updates.find((u) => u.table === 'tenant_members');
    expect(membershipWrite?.set).toMatchObject({ status: 'removed' });
    expect(membershipWrite?.depth).toBe(1);
    expect(keysUpdate()?.set).toMatchObject({ isActive: false });

    const audit = h.audits.find((a) => a.action === 'api_keys_revoked');
    expect(audit).toBeTruthy();
    expect(audit).toMatchObject({ entityId: 'user-target', tenantId: 'tenant-1', userId: 'user-admin' });
  });

  it('revokes for a suspension too, not only for a removal', async () => {
    const res = await patch({ memberId: 'm-1', action: 'suspend' });
    expect(res.status).toBe(200);
    expect(h.revoked).toEqual([{ tenantId: 'tenant-1', userId: 'user-target', depth: 1 }]);
    const membershipWrite = h.updates.find((u) => u.table === 'tenant_members');
    expect(membershipWrite?.set).toMatchObject({ status: 'suspended' });
    expect(keysUpdate()?.set).toMatchObject({ isActive: false });
    expect(h.audits.some((a) => a.action === 'api_keys_revoked')).toBe(true);
  });

  it('does not resurrect revoked keys on reactivate', async () => {
    const res = await patch({ memberId: 'm-1', action: 'reactivate' });
    expect(res.status).toBe(200);
    expect(h.revoked).toHaveLength(0);
    expect(keysUpdate()).toBeUndefined();
  });

  it('does not revoke for a role change', async () => {
    const res = await patch({ memberId: 'm-1', action: 'change_role', role_slug: 'manager' });
    expect(res.status).toBe(200);
    expect(h.revoked).toHaveLength(0);
    expect(keysUpdate()).toBeUndefined();
  });

  it('does not revoke when the suspension matched zero rows', async () => {
    // #3079's discipline, restated for the new write: a stale guard must reach the
    // caller instead of resolving the transaction, and revocation must not run for
    // a membership that was never actually suspended.
    h.updateRows = [];
    const res = await patch({ memberId: 'm-1', action: 'suspend', expectedUpdatedAt: 1 });
    expect(res.status).toBe(409);
    expect(h.revoked).toHaveLength(0);
    expect(keysUpdate()).toBeUndefined();
    expect(h.killedSessions).toHaveLength(0);
  });
});
