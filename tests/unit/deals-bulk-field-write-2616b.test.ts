/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2616 (bulk half) — POST /api/tenant/deals/bulk wrote assigned_to /
// stage_id straight from payload keys in its assign/transfer/stage/close
// actions, with no enforceFieldWrite anywhere on the path. A role with those
// fields write-restricted via field_permissions could still bulk-move or
// bulk-assign deals. The route now probes the watched columns through
// enforceFieldWrite and 403s when any is stripped (stripping a bulk
// action's only payload value would leave the action meaningless).

const TENANT = 'c1111111-1111-4111-8111-111111111111';

const { mockEnforceFieldWrite, mockReadJsonBody, mockUpdate } = vi.hoisted(() => ({
  mockEnforceFieldWrite: vi.fn(),
  mockReadJsonBody: vi.fn(),
  mockUpdate: vi.fn(),
}));

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'limit', 'orderBy']) b[m] = () => b;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return b;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    update: mockUpdate,
    transaction: vi.fn(),
  },
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'user-1',
    roleSlug: 'rep',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    user: { email: 'rep@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/api/validate', () => ({ readJsonBody: mockReadJsonBody }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/rbac/enforce', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/rbac/enforce')>();
  return { ...orig, enforceFieldWrite: mockEnforceFieldWrite };
});

// Select queue for the stage flow: [valid-ids lookup, stage lookup].
async function queueSelects(...queues: unknown[][]) {
  const { db } = await import('@/drizzle/db');
  let i = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => chain(queues[i++] ?? []));
}

async function post(body: unknown) {
  mockReadJsonBody.mockResolvedValue(body);
  const route = await import('@/app/api/tenant/deals/bulk/route');
  const req = new Request('http://localhost/api/tenant/deals/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  return route.POST(req);
}

function passthrough(_ctx: unknown, _entity: string, body: Record<string, unknown>) {
  return Promise.resolve({ body: { ...body }, stripped: [] as string[] });
}

beforeEach(() => {
  vi.resetModules();
  mockEnforceFieldWrite.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(() => ({
    set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
  }));
});

describe('deals bulk — field_permissions gate on column writes (#2616)', () => {
  it('stage action 403s when stage_id is write-restricted, no update runs', async () => {
    mockEnforceFieldWrite.mockImplementation(async (_c: unknown, _e: string, body: Record<string, unknown>) => ({
      body: {},
      stripped: 'stage_id' in body ? ['stage_id'] : [],
    }));
    await queueSelects([{ id: 'd1' }]);

    const res = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } });
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toContain('stage_id');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stage action succeeds when enforceFieldWrite passes through', async () => {
    mockEnforceFieldWrite.mockImplementation(passthrough);
    await queueSelects([{ id: 'd1' }], [{ id: 'S1' }]);

    const res = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } });
    expect(res.status).toBe(200);
    const json = await res.json() as { affected: number };
    expect(json.affected).toBe(1);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('assign action 403s when assigned_to is write-restricted', async () => {
    mockEnforceFieldWrite.mockImplementation(async (_c: unknown, _e: string, body: Record<string, unknown>) => ({
      body: {},
      stripped: 'assigned_to' in body ? ['assigned_to'] : [],
    }));
    await queueSelects([{ id: 'd1' }]);

    const res = await post({ action: 'assign', deal_ids: ['d1'], payload: { assigned_to: 'u-2' } });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('assigned_to');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('close action probes stage_id too', async () => {
    mockEnforceFieldWrite.mockImplementation(async (_c: unknown, _e: string, body: Record<string, unknown>) => {
      expect(body).toHaveProperty('stage_id');
      return { body: { ...body }, stripped: [] };
    });
    await queueSelects([{ id: 'd1' }], [{ id: 'S1' }]);

    const res = await post({ action: 'close', deal_ids: ['d1'], payload: { stage_id: 'S1', outcome: 'won' } });
    expect(res.status).toBe(200);
  });

  it('actions without column writes (archive) never hit the probe', async () => {
    await queueSelects([{ id: 'd1' }]);

    const res = await post({ action: 'archive', deal_ids: ['d1'], payload: {} });
    expect(res.status).toBe(200);
    expect(mockEnforceFieldWrite).not.toHaveBeenCalled();
  });
});
