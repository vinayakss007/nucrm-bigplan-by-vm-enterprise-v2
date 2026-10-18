/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2618 — field_permissions was enforced in two deals handlers only, so the
// leads/contacts bulk and import routes wrote restricted columns regardless of
// the role. These tests pin the four new gates: the bulk routes reject (403)
// when the action's own column is restricted — stripping it would leave a
// meaningless action — and the alias maps make the leads/contacts wire
// spellings (status/source/title) fail closed with their canonical columns.

const TENANT = 'c1111111-1111-4111-8111-111111111111';
const ID = 'd2222222-2222-4222-8222-222222222222';

const mockEnforceFieldWrite = vi.hoisted(() => vi.fn());
const mockReadJsonBody = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy', 'for']) b[m] = () => b;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return b;
}

vi.mock('@/drizzle/db', () => ({
  db: { select: vi.fn(() => chain([])), update: mockUpdate, transaction: vi.fn(), insert: vi.fn() },
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT, userId: 'a1111111-1111-4111-8111-111111111111', roleSlug: 'rep',
    permissions: {}, isAdmin: false, isSuperAdmin: false, user: { email: 'rep@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...orig, readJsonBody: mockReadJsonBody };
});
vi.mock('@/lib/rbac/enforce', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/rbac/enforce')>();
  return { ...orig, enforceFieldWrite: mockEnforceFieldWrite };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => undefined) }));

async function queueSelects(...queues: unknown[][]) {
  const { db } = await import('@/drizzle/db');
  let i = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => chain(queues[i++] ?? []));
}

async function post(path: string, body: unknown) {
  mockReadJsonBody.mockResolvedValue(body);
  const route = await import(`@/app/api/tenant/${path}/bulk/route`);
  const req = new Request(`http://localhost/api/tenant/${path}/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  return route.POST(req);
}

/** Strips every watched key the route probed, so a 403 is expected. */
function restrict(...fields: string[]) {
  mockEnforceFieldWrite.mockImplementation(async (_c: unknown, _e: string, body: Record<string, unknown>) => {
    const stripped = fields.filter((f) => f in body);
    const kept = Object.fromEntries(Object.entries(body).filter(([k]) => !stripped.includes(k)));
    return { body: kept, stripped };
  });
}

// The two routes name their id list differently: contacts takes the legacy
// {ids, updates} shape, leads takes {lead_ids}.
const contactsBody = (action: string, payload: Record<string, unknown>) => ({
  action, ids: [ID], updates: {}, payload,
});
const leadsBody = (action: string, payload: Record<string, unknown>) => ({
  action, lead_ids: [ID], payload,
});

beforeEach(() => {
  vi.resetModules();
  mockEnforceFieldWrite.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(() => ({ set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }) }));
});

describe('contacts bulk — field_permissions gate (#2618)', () => {
  it('assign 403s on a restricted assigned_to and runs no update', async () => {
    restrict('assigned_to');
    await queueSelects([{ id: ID }]);
    const res = await post('contacts', contactsBody('assign', { assigned_to: 'u-2' }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('assigned_to');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('status 403s on a restricted lead_status', async () => {
    restrict('lead_status');
    await queueSelects([{ id: ID }]);
    const res = await post('contacts', contactsBody('status', { lead_status: 'customer' }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('lead_status');
  });

  it('passes assign through when nothing is restricted', async () => {
    restrict();
    // assign writes payload.assign_to after proving the assignee is a member,
    // so the gate needs both selects queued.
    await queueSelects([{ id: ID }], [{ userId: ID }]);
    const res = await post('contacts', contactsBody('assign', { assign_to: ID }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('tag writes no governed column, so it never probes', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('contacts', contactsBody('tag', { tag: 'vip' }));
    expect(mockEnforceFieldWrite).not.toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });
});

describe('leads bulk — field_permissions gate (#2618)', () => {
  it('status 403s on a restricted lead_status', async () => {
    restrict('lead_status');
    await queueSelects([{ id: ID }]);
    const res = await post('leads', leadsBody('status', { lead_status: 'qualified' }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('lead_status');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('assign 403s on a restricted assigned_to', async () => {
    restrict('assigned_to');
    await queueSelects([{ id: ID }]);
    const res = await post('leads', leadsBody('assign', { assigned_to: 'u-2' }));
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('convert does not probe the column writes it does not make', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('leads', leadsBody('convert', {}));
    expect(res.status).not.toBe(403);
  });
});

describe('leads/contacts read aliases (#2618)', () => {
  it('restricting lead_status also clears the status alias', async () => {
    const { stripRowForRead } = await import('@/lib/rbac/enforce');
    const map = new Map([['lead_status', 'none' as const]]);
    expect(stripRowForRead('leads', map, { id: ID, lead_status: 'new', status: 'new', company_name: 'A' }))
      .toEqual({ id: ID, company_name: 'A' });
  });

  it('restricting job_title also clears the title alias', async () => {
    const { stripRowForRead } = await import('@/lib/rbac/enforce');
    const map = new Map([['job_title', 'none' as const]]);
    expect(stripRowForRead('contacts', map, { id: ID, job_title: 'CTO', title: 'CTO', name: 'Ada' }))
      .toEqual({ id: ID, name: 'Ada' });
  });

  it('restricting lead_source also clears the source alias', async () => {
    const { stripRowForRead } = await import('@/lib/rbac/enforce');
    const map = new Map([['lead_source', 'none' as const]]);
    expect(stripRowForRead('leads', map, { id: ID, lead_source: 'web', source: 'web' }))
      .toEqual({ id: ID });
  });
});
