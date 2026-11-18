/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A2 — `record_permissions` had zero production readers: an admin could
 * grant "share this deal with finance" and every list/detail handler ignored
 * it. This pins the typed helper that folds the allow-list into `view_all`
 * ownership checks, including access levels and expiry.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deals } from '@/drizzle/schema';
import type { AuthContext } from '@/lib/auth/middleware';

const ROLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL = '33333333-3333-4333-8333-333333333333';
// Unique tenant per test: resolveRoleId caches by tenant:slug, so reusing one
// would skip the role lookup and desync the mock's response queue.
let tenant = '';
let seq = 0;
const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({
  /** One response queue entry per `.limit()` call: role lookup, then grant lookup. */
  responses: [] as unknown[][],
  where: [] as { sql: string; params: unknown[] }[],
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = (p: unknown) => {
        const q = dialect.sqlToQuery(p as never);
        h.where.push({ sql: q.sql, params: q.params as unknown[] });
        return b;
      };
      b.limit = () => Promise.resolve(h.responses.shift() ?? []);
      return b;
    },
  },
}));

import { getRecordGrantCondition, hasRecordGrant } from '@/lib/rbac/record-scope';

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: '44444444-4444-4444-8444-444444444444',
  tenantId: tenant,
  roleSlug: 'rep',
  permissions: {},
  isAdmin: false,
  isSuperAdmin: false,
  ...over,
} as AuthContext);

beforeEach(() => {
  seq += 1;
  tenant = `22222222-2222-4222-8222-${String(seq).padStart(12, '0')}`;
  h.responses = [];
  h.where = [];
});

describe('getRecordGrantCondition (#2597 A2)', () => {
  it('adds nothing for an admin or superadmin', async () => {
    expect(await getRecordGrantCondition(ctx({ isAdmin: true }), 'deals', deals.id)).toBeNull();
    expect(await getRecordGrantCondition(ctx({ isSuperAdmin: true }), 'deals', deals.id)).toBeNull();
    expect(h.where).toHaveLength(0);
  });

  it('adds nothing when the role cannot be resolved in this tenant', async () => {
    h.responses = [[]];
    expect(await getRecordGrantCondition(ctx(), 'deals', deals.id)).toBeNull();
    expect(h.where[0]!.params).toContain(tenant);
  });

  it('adds nothing when the role has no live grants for the entity', async () => {
    h.responses = [[{ id: ROLE }], []];
    expect(await getRecordGrantCondition(ctx(), 'deals', deals.id)).toBeNull();
  });

  it('returns a correlated EXISTS scoped to tenant, role, entity, live row and level', async () => {
    h.responses = [[{ id: ROLE }], [{ id: DEAL }]];
    const cond = await getRecordGrantCondition(ctx(), 'deals', deals.id);
    expect(cond).not.toBeNull();
    const q = dialect.sqlToQuery(cond as never);
    for (const fragment of ['record_permissions', 'tenant_id', 'role_id', 'entity_type', 'entity_id', 'deleted_at', 'expires_at', 'access_level']) {
      expect(q.sql, `missing ${fragment}`).toContain(fragment);
    }
    // The correlated id column is the caller's Drizzle column, not a string
    // identifier — so a joined table cannot shadow it.
    expect(q.sql).toContain('"deals"."id"');
    expect(q.params).toContain(tenant);
    expect(q.params).toContain(ROLE);
    expect(q.params).toContain('deals');
  });
});

describe('hasRecordGrant (#2597 A2)', () => {
  it('returns false for an unknown role', async () => {
    h.responses = [[]];
    expect(await hasRecordGrant(ctx(), 'deals', DEAL)).toBe(false);
  });

  it('passes through admins without a lookup', async () => {
    expect(await hasRecordGrant(ctx({ isAdmin: true }), 'deals', DEAL, 'admin')).toBe(true);
    expect(h.where).toHaveLength(0);
  });

  it('accepts a matching read grant', async () => {
    h.responses = [[{ id: ROLE }], [{ id: DEAL }]];
    expect(await hasRecordGrant(ctx(), 'deals', DEAL, 'read')).toBe(true);
    expect(h.where[1]!.params).toContain(DEAL);
  });

  it('refuses a write when the grant is read-only (levels are enforced in SQL)', async () => {
    h.responses = [[{ id: ROLE }], []];
    expect(await hasRecordGrant(ctx(), 'deals', DEAL, 'write')).toBe(false);
    expect(h.where[1]!.sql).toContain('access_level');
    expect(h.where[1]!.params).toContain('write');
    expect(h.where[1]!.params).toContain('admin');
  });

  it('refuses a delete when the grant is write-only', async () => {
    h.responses = [[{ id: ROLE }], []];
    expect(await hasRecordGrant(ctx(), 'deals', DEAL, 'admin')).toBe(false);
    expect(h.where[1]!.params).not.toContain('write');
  });
});

describe('#2597 A2 anti-rot', () => {
  const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

  it('the deals list handler ORs a per-record grant into its ownership filter', () => {
    expect(read('app/api/tenant/deals/route.ts')).toMatch(/getRecordGrantCondition\(ctx, 'deals', deals\.id\)/);
  });

  it('the deals detail GET/PATCH/DELETE all consult the grant at their level', () => {
    const src = read('app/api/tenant/deals/[id]/route.ts');
    expect(src).toMatch(/hasRecordGrant\(ctx, 'deals', row\.id, 'read'\)/);
    expect(src).toMatch(/hasRecordGrant\(ctx, 'deals', dealId, 'write'\)/);
    expect(src).toMatch(/hasRecordGrant\(ctx, 'deals', dealId, 'admin'\)/);
  });
});
