/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The tenant-facing counterpart of the console routes pinned in
// superadmin-roles-tenant-scoping.test.ts. It had the two bugs that fix removed
// from the console path: an unconditional `permissions: permissions || {}` /
// `description: description || null` in the SET clause, and a DELETE that
// checked neither the is_system flag nor the soft-deleted rows, and left the
// former members' cached permissions pointing at a retired role.

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const ROLE = 'b2222222-2222-4222-8222-222222222222';

const harness = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectQueue: [] as unknown[][],
    setPayloads: [] as Record<string, unknown>[],
    updateCount: 0,
    invalidated: [] as string[],
  };
  const chain = (resolve: () => Promise<unknown>) => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => resolve();
    c.returning = () => resolve();
    c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => resolve().then(ok, err);
    return c;
  };
  const db = {
    select: vi.fn(() => {
      const next = state.selectQueue.shift();
      return chain(() => Promise.resolve(next ?? state.rows));
    }),
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
  };
  return { state, db };
});

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'member-1',
    isAdmin: true,
    isSuperAdmin: false,
    user: { email: 'admin@example.com' },
  })),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/cache/sessions', () => ({
  invalidateUserContexts: vi.fn(async (userId: string) => {
    harness.state.invalidated.push(userId);
  }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { invalidateUserContexts } from '@/lib/cache/sessions';
import * as route from '@/app/api/tenant/roles/[id]/route';

async function call(verb: 'PATCH' | 'DELETE', body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/tenant/roles/${ROLE}`, {
    method: verb,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest;
  return route[verb](request, { params: Promise.resolve({ id: ROLE }) });
}

const roleRow = (over: Record<string, unknown> = {}) => ({
  id: ROLE,
  tenantId: TENANT,
  slug: 'auditor',
  name: 'Auditor',
  description: 'Read-only',
  permissions: { 'deals.view': true },
  isSystem: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.rows = [];
  harness.state.selectQueue = [];
  harness.state.setPayloads = [];
  harness.state.updateCount = 0;
  harness.state.invalidated = [];
});

describe('tenant/roles/[id] PATCH', () => {
  it('writes only the permissions it was given, leaving name and description alone', async () => {
    harness.state.rows = [roleRow()];
    const res = await call('PATCH', { permissions: { 'deals.view': true, 'leads.view': true } });

    expect(res.status).toBe(200);
    expect(Object.keys(harness.state.setPayloads[0] ?? {}).sort()).toEqual(['permissions', 'updatedAt']);
  });

  it('does not strip every permission when the caller only renames the role', async () => {
    harness.state.rows = [roleRow()];
    const res = await call('PATCH', { name: 'Compliance' });

    expect(res.status).toBe(200);
    expect(Object.keys(harness.state.setPayloads[0] ?? {}).sort()).toEqual(['name', 'updatedAt']);
  });

  it('refuses an update that carries no updatable field', async () => {
    harness.state.rows = [roleRow()];
    const res = await call('PATCH', {});

    expect(res.status).toBe(400);
    expect(harness.state.updateCount).toBe(0);
  });

  it('keeps the missing-row answer as 404', async () => {
    harness.state.rows = [];
    const res = await call('PATCH', { name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

describe('tenant/roles/[id] DELETE', () => {
  it('refuses a role provisioned as system even when its slug is custom', async () => {
    harness.state.selectQueue = [[roleRow({ slug: 'qa_helper', isSystem: true })]];
    const res = await call('DELETE');

    expect(res.status).toBe(400);
    expect(harness.state.updateCount).toBe(0);
  });

  it('soft-deletes a custom role and revalidates the cache of every member holding it', async () => {
    harness.state.selectQueue = [[roleRow()], [{ userId: 'u-1' }, { userId: 'u-2' }]];
    harness.state.rows = [{ id: ROLE }];
    const res = await call('DELETE');

    expect(res.status).toBe(200);
    const payload = harness.state.setPayloads[0] ?? {};
    expect(payload.deletedAt).toBeInstanceOf(Date);
    expect(payload.updatedAt).toBeInstanceOf(Date);
    expect(invalidateUserContexts).toHaveBeenCalledTimes(2);
    expect(harness.state.invalidated.sort()).toEqual(['u-1', 'u-2']);
  });

  it('answers 404 for a row that is already gone rather than re-soft-deleting it', async () => {
    harness.state.selectQueue = [[]];
    const res = await call('DELETE');

    expect(res.status).toBe(404);
    expect(harness.state.updateCount).toBe(0);
  });
});
