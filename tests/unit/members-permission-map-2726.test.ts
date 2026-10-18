/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2726 — GET /api/tenant/members publishes every member's permission map to
 * any signed-in session, and nothing reads it.
 *
 * `app/api/tenant/members/route.ts:136-181` is the only verb on that path
 * without a gate: POST (`:36`) and PATCH (`:189`) both stop at
 * `if (!ctx.isAdmin) return … 403`, while the GET hands the roster to anyone
 * with a session — including the projection `permissions: roles.permissions`
 * at `:153`. So a caller who cannot open the team page learns, per named human
 * being, which role they hold and every boolean that role grants: who may
 * delete contacts, who holds `billing.manage`, who is the second admin.
 *
 * The roster itself is legitimately broad — `out-of-office/page.tsx:45-55`
 * needs it (and only `userId` / `fullName` / `email`) to pick a delegate, and
 * `bulk-transfer/page.tsx:48` needs it for the same kind of picker. The
 * permission map has no consumer: the four files that fetch this endpoint are
 * `settings/admin/page.tsx:53`, `settings/bulk-transfer/page.tsx:48`,
 * `settings/out-of-office/page.tsx:45` and `settings/team-client.tsx:165`, and
 * not one of them reads a `permissions` field off the response — the only
 * occurrence in any of them is a static label (`team-client.tsx:378`) — and the
 * `TeamMember` interface the team page types the payload with
 * (`team-client.tsx:38-45`) does not name it. The role editor does read
 * `role.permissions`, but from a different endpoint entirely
 * (`settings/roles/page.tsx:33` against `GET /api/tenant/roles`).
 *
 * The db double builds each fake row FROM the projection object the route
 * passes to `db.select` — so a field that is no longer projected cannot be
 * produced by the mock, and the assertion grades the route's own column list
 * rather than a canned payload.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

/** What roles.permissions actually holds (lib/permissions/definitions.ts) — the
 * payload a caller must NOT be able to read every member's copy of. */
const PERMISSION_MAP = { 'contacts.delete': true, 'billing.manage': true, 'team.manage_roles': true };

const TENANT = '11111111-1111-4111-8111-111111111111';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COLLEAGUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';


function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
    builder[m] = chain;
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

/**
 * Fake rows carry a sentinel per projected key (`leak-<key>`), derived from the
 * projection the route actually passed. `db.select()` with no argument means
 * "whole table", which the invitations query uses.
 */
function fakeRows(keys: string[] | null): Record<string, unknown>[] {
  const who = [ME, COLLEAGUE];
  return who.map((userId, i) => {
    if (!keys) {
      return { id: `inv-${i}`, tenantId: TENANT, email: `invited${i}@example.test`, roleSlug: 'member' };
    }
    const row: Record<string, unknown> = {};
    for (const key of keys) {
      row[key] = key === 'permissions' ? PERMISSION_MAP
        : key === 'userId' ? userId
        : key === 'tenantId' ? TENANT
        : key === 'email' ? `${who[i].slice(0, 8)}@example.test`
        : `leak-${key}`;
    }
    return row;
  });
}

const mockDb: Record<string, unknown> = {
  select: vi.fn((projection?: Record<string, unknown>) => {
    return makeBuilder(fakeRows(projection ? Object.keys(projection) : null));
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ hashPassword: vi.fn() }));
vi.mock('@/lib/cache/sessions', () => ({ deleteUserSessions: vi.fn() }));
vi.mock('@/lib/db/rls', () => ({ withSecurityContext: <T>(fn: () => Promise<T>) => fn() }));
vi.mock('server-only', () => ({}));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/members/route');

function ctx(admin: boolean): AuthContext {
  return {
    userId: ME, tenantId: TENANT, roleSlug: admin ? 'admin' : 'member',
    permissions: admin ? { all: true } : { 'contacts.view': true },
    isAdmin: admin, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function list(admin = false) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx(admin));
  const res = await (route.GET as (r: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('http://localhost:3000/api/tenant/members'), {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, unknown> };
}

describe('the roster no longer carries each member\'s permission map (#2726)', () => {
  it('the roster payload has no permissions key for any member', async () => {
    const { json, text } = await list();
    const rows = json['data'] as Record<string, unknown>[];
    expect(rows.length, text).toBe(2);
    for (const row of rows) expect(row, JSON.stringify(row)).not.toHaveProperty('permissions');
  });

  it('the response body carries no permission vocabulary at all', async () => {
    const { text } = await list();
    expect(text).not.toContain('contacts.delete');
    expect(text).not.toContain('billing.manage');
    expect(text).not.toContain('team.manage_roles');
    expect(text).not.toContain('leak-permissions');
  });
});

describe('the roster the pickers actually need is untouched (#2726)', () => {
  it('a non-admin still gets the member list it needs for a delegate picker', async () => {
    const { res, json, text } = await list(false);
    expect(res.status, text).toBe(200);
    const rows = json['data'] as Record<string, unknown>[];
    expect(rows.map(r => r['userId'])).toEqual([ME, COLLEAGUE]);
    expect(rows[0]).toHaveProperty('fullName', 'leak-fullName');
    expect(rows[0]).toHaveProperty('email');
  });

  it('role name, status and workload counts stay in the payload', async () => {
    const { json } = await list(false);
    const row = (json['data'] as Record<string, unknown>[])[0];
    for (const key of ['roleName', 'roleSlug', 'status', 'contactCount', 'dealCount', 'taskCount', 'joinedAt']) {
      expect(row, JSON.stringify(row)).toHaveProperty(key);
    }
  });

  it('the admin badge field the team page reads stays in the payload', async () => {
    const { json } = await list(true);
    const row = (json['data'] as Record<string, unknown>[])[0];
    expect(row, JSON.stringify(row)).toHaveProperty('emailVerified', 'leak-emailVerified');
  });

  it('pending invitations are still returned alongside the roster', async () => {
    const { res, json, text } = await list(false);
    expect(res.status, text).toBe(200);
    expect(Array.isArray(json['invitations'])).toBe(true);
    expect(json['tenantId']).toBe(TENANT);
  });
});
