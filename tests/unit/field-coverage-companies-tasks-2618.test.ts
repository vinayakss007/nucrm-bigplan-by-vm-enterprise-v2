/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2618 (companies/tasks half) — field_permissions was enforced on the deals
// and leads/contacts handlers, so the companies bulk/export/import paths and
// the tasks bulk path wrote and returned restricted columns regardless of the
// role. These tests pin the gates the leads/contacts PR (#2647) established:
// a bulk action whose own column is restricted is REJECTED (403), not
// performed with the value stripped; the export CSV drops a restricted column
// from the header AND every row; the CSV import reports dropped keys per row.

const TENANT = 'c1111111-1111-4111-8111-111111111111';
const ID = 'd2222222-2222-4222-8222-222222222222';

const mockEnforceFieldWrite = vi.hoisted(() => vi.fn());
const mockEnforceFieldRead = vi.hoisted(() => vi.fn());
const mockReadJsonBody = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const insertedRows: unknown[] = [];

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy', 'for']) b[m] = () => b;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return b;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(() => ({ values: (rows: unknown) => Promise.resolve({ rowCount: 1, inserted: rows }) })),
    transaction: mockTransaction,
  },
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
  return {
    ...orig,
    enforceFieldWrite: mockEnforceFieldWrite,
    enforceFieldRead: mockEnforceFieldRead,
  };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/dashboard/widget-cache', () => ({ invalidateWidgetCache: vi.fn() }));

async function queueSelects(...queues: unknown[][]) {
  let i = 0;
  mockSelect.mockImplementation(() => chain(queues[i++] ?? []));
}

async function post(path: string, body: unknown) {
  mockReadJsonBody.mockResolvedValue(body);
  const route = await import(`@/app/api/tenant/${path}/route`);
  const req = new Request(`http://localhost/api/tenant/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  return route.POST(req);
}

/** Strips exactly the named keys from whatever the route probes. */
function restrict(...fields: string[]) {
  mockEnforceFieldWrite.mockImplementation(async (_c: unknown, _e: string, body: Record<string, unknown>) => {
    const stripped = fields.filter((f) => f in body);
    const kept = Object.fromEntries(Object.entries(body).filter(([k]) => !fields.includes(k)));
    return { body: kept, stripped };
  });
}

beforeEach(() => {
  vi.resetModules();
  mockEnforceFieldWrite.mockReset();
  mockEnforceFieldRead.mockReset();
  mockEnforceFieldRead.mockImplementation(async (_c: unknown, _e: string, rows: Record<string, unknown>[]) => rows);
  mockUpdate.mockReset();
  mockUpdate.mockImplementation(() => ({ set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }) }));
  mockTransaction.mockReset();
  insertedRows.length = 0;
});

describe('tasks bulk — field_permissions gate (#2618)', () => {
  const tasksBody = (action: string, payload: Record<string, unknown> = {}) => ({
    action, task_ids: [ID], payload,
  });

  it('assign 403s on a restricted assigned_to and runs no update', async () => {
    restrict('assigned_to');
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('assign', { assigned_to: 'u-2' }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('assigned_to');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('priority 403s on a restricted priority', async () => {
    restrict('priority');
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('priority', { priority: 'urgent' }));
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('complete 403s when the status column is restricted', async () => {
    restrict('status');
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('complete'));
    expect(res.status).toBe(403);
  });

  it('due 403s on a restricted due_date', async () => {
    restrict('due_date');
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('due', { due_date: '2026-01-01' }));
    expect(res.status).toBe(403);
  });

  it('an unrestricted role still completes', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('complete'));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('delete writes only deleted_at, so it never probes a governed column', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('tasks/bulk', tasksBody('delete'));
    expect(mockEnforceFieldWrite).not.toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });
});

describe('companies bulk — field_permissions gate (#2618)', () => {
  const companiesBody = (action: string, payload: Record<string, unknown> = {}) => ({
    action, company_ids: [ID], payload,
  });

  it('assign 403s on a restricted assigned_to', async () => {
    restrict('assigned_to');
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('assign', { assigned_to: 'u-2' }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toContain('assigned_to');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('status 403s on a restricted status', async () => {
    restrict('status');
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('status', { status: 'archived' }));
    expect(res.status).toBe(403);
  });

  it('tag 403s on a restricted tags column', async () => {
    restrict('tags');
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('tag', { tag: 'vip' }));
    expect(res.status).toBe(403);
  });

  it('update_field 403s on a restricted custom_fields column', async () => {
    restrict('custom_fields');
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('update_field', { field_key: 'k', field_value: 'v' }));
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('an unrestricted role still tags', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('tag', { tag: 'vip' }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('archive writes only deleted_at, so it never probes', async () => {
    restrict();
    await queueSelects([{ id: ID }]);
    const res = await post('companies/bulk', companiesBody('archive'));
    expect(mockEnforceFieldWrite).not.toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });
});

describe('companies export CSV projection (#2618)', () => {
  it('a restricted column leaves the header AND every row', async () => {
    const exportRoute = await import('@/app/api/tenant/companies/export/route');
    await queueSelects([
      { name: 'Acme', domain: 'acme.io', industry: 'law', phone: '1', address: 'a', city: 'c', state: 's', country: 'co', postalCode: '9', numberOfEmployees: 500, annualRevenue: '10', notes: 'n', tags: ['x'], createdAt: '2026-01-01' },
    ]);
    mockEnforceFieldRead.mockImplementation(async (_c: unknown, _e: string, rows: Record<string, unknown>[]) =>
      rows.map(({ annualRevenue: _drop, ...rest }) => rest));

    const req = new Request('http://localhost/api/tenant/companies/export', { method: 'GET' }) as never;
    const res = await exportRoute.GET(req);
    const csv = await res.text();
    const [header, row] = csv.split('\n');
    expect(header).not.toContain('annual_revenue');
    expect(header?.split(',')).toHaveLength(13);
    expect(row).toBeDefined();
    expect(row).not.toContain('10');
    expect(csv).toContain('Acme');
  });

  it('an unrestricted role gets the pre-#2618 byte shape back', async () => {
    const exportRoute = await import('@/app/api/tenant/companies/export/route');
    await queueSelects([
      { name: 'Acme', domain: 'acme.io', industry: 'law', phone: '1', address: 'a', city: 'c', state: 's', country: 'co', postalCode: '9', numberOfEmployees: 500, annualRevenue: '10', notes: 'n', tags: ['x'], createdAt: '2026-01-01' },
    ]);
    const req = new Request('http://localhost/api/tenant/companies/export', { method: 'GET' }) as never;
    const csv = await (await exportRoute.GET(req)).text();
    expect(csv.split('\n')[0]).toBe(
      'name,domain,industry,phone,address,city,state,country,postal_code,company_size,annual_revenue,notes,tags,created_at',
    );
  });

  it('projects through enforceFieldRead on the companies entity', async () => {
    const exportRoute = await import('@/app/api/tenant/companies/export/route');
    await queueSelects([{ name: 'Acme', domain: null, industry: null, phone: null, address: null, city: null, state: null, country: null, postalCode: null, numberOfEmployees: null, annualRevenue: null, notes: null, tags: null, createdAt: null }]);
    const req = new Request('http://localhost/api/tenant/companies/export', { method: 'GET' }) as never;
    await exportRoute.GET(req);
    expect(mockEnforceFieldRead).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, roleSlug: 'rep' }), 'companies', expect.any(Array),
    );
  });
});

describe('companies CSV import gate (#2618)', () => {
  async function importCsv(csv: string) {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({
        values: (rows: unknown) => { insertedRows.push(rows); return Promise.resolve({ rowCount: 1 }); },
      }),
    }));
    return post('companies/import', { csv });
  }

  it('reports the dropped key on the row and never inserts it', async () => {
    restrict('phone');
    const res = await importCsv('name,phone\nAcme,555-0100\n');
    const body = await res.json() as {
      results: { imported: number; errors: string[] };
    };
    expect(body.results.errors.some((e) => /Row \d+: role restrictions dropped phone/.test(e))).toBe(true);
    const inserted = insertedRows.flat() as Record<string, unknown>[];
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted.every((r) => !('phone' in r) || r.phone === undefined)).toBe(true);
  });

  it('a row whose required name is restricted is skipped with the restriction as the reason', async () => {
    restrict('name');
    const res = await importCsv('name,phone\nAcme,555\n');
    const body = await res.json() as { results: { imported: number; skipped: number; errors: string[] } };
    expect(body.results.imported).toBe(0);
    expect(body.results.skipped).toBe(1);
    expect(body.results.errors.some((e) => /name is required and the role's field_permissions strip it/.test(e))).toBe(true);
  });

  it('an unrestricted import is untouched', async () => {
    restrict();
    const body = await (await importCsv('name,phone\nAcme,555\n')).json() as {
      results: { imported: number; errors: string[] };
    };
    expect(body.results.imported).toBe(1);
    expect(body.results.errors).toHaveLength(0);
  });
});

describe('companies/tasks read aliases (#2618)', () => {
  it('restricting company_size also clears the numberOfEmployees spelling', async () => {
    const { stripRowForRead } = await import('@/lib/rbac/enforce');
    const map = new Map([['company_size', 'none' as const]]);
    expect(stripRowForRead('companies', map, { id: ID, name: 'Acme', numberOfEmployees: 500 }))
      .toEqual({ id: ID, name: 'Acme' });
  });

  it('restricting created_by also clears the tasks POST user_id spelling', async () => {
    const { stripRowForRead } = await import('@/lib/rbac/enforce');
    const map = new Map([['created_by', 'none' as const]]);
    expect(stripRowForRead('tasks', map, { id: ID, title: 'Call', user_id: 'u9' }))
      .toEqual({ id: ID, title: 'Call' });
  });
});
