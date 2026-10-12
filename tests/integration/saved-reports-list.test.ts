import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const {
  mockRequireAuth, mockCan, mockExecutionsFindMany,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCan: vi.fn(),
  mockExecutionsFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  can: (...args: unknown[]) => mockCan(...args),
}));

let _selectResult: unknown = [];
let _deleteResult: unknown = [];
let _patchResult: unknown = [];

/** Every predicate the route handed to `.where(...)`, in submission order. */
const _whereClauses: unknown[] = [];

// Build a fluent chain: every method returns an object with all follow-ups.
// The "terminal" methods (limit, orderBy, returning) return _selectResult.
function makeSelectChain() {
  const terminal = () => _selectResult;
  const self: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'leftJoin', 'where', 'orderBy', 'limit']) {
    self[m] = () => (m === 'limit' || m === 'orderBy') ? terminal() : self;
  }
  self.where = (...a: unknown[]) => { _whereClauses.push(...a); return self; };
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeSelectChain(),
    delete: () => ({
      where: (...a: unknown[]) => { _whereClauses.push(...a); return { returning: () => _deleteResult }; },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (...a: unknown[]) => { _whereClauses.push(...a); _lastSetValues = values; return { returning: () => _patchResult }; },
      }),
    }),
    query: {
      reportExecutions: {
        findMany: (...a: unknown[]) => { mockExecutionsFindMany(...a); return _selectResult; },
      },
    },
  },
}));

let _lastSetValues: Record<string, unknown> = {};

// The route rejects a path segment that is not a uuid before it reaches
// Postgres, so every id these tests use has to be a real one.
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_GONE = '33333333-3333-4333-8333-333333333333';

function createTestRequest(path: string, opts: RequestInit & { method?: string } = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', cookie: 'session=test', ...(opts.headers as Record<string, string> || {}) },
    body: opts.body,
  });
}

const R1 = { id: ID_A, name: 'Contact Summary', reportType: 'contacts', chartType: 'bar', isPublic: true, lastRunAt: '2026-01-15', createdBy: 'user-1', createdAt: '2026-01-01', updatedAt: '2026-01-10', createdByName: 'Admin User' };
const R2 = { id: ID_B, name: 'Deal Pipeline', reportType: 'deals', chartType: 'pie', isPublic: false, lastRunAt: null, createdBy: 'user-2', createdAt: '2026-01-05', updatedAt: '2026-01-08', createdByName: 'Sales User' };

describe('GET /api/tenant/reports/saved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', email: 'admin@test.com', role: 'admin' });
    mockCan.mockReturnValue(true);
    _selectResult = [R1, R2];
  });

  it('returns all saved reports', async () => {
    const { GET } = await import('@/app/api/tenant/reports/saved/route');
    const res = await GET(createTestRequest('/api/tenant/reports/saved'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe('Contact Summary');
  });

  it('returns 403 when permission denied', async () => {
    mockCan.mockReturnValueOnce(false);

    const { GET } = await import('@/app/api/tenant/reports/saved/route');
    const res = await GET(createTestRequest('/api/tenant/reports/saved'));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/tenant/reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', email: 'admin@test.com', role: 'admin' });
    mockCan.mockReturnValue(true);
    _selectResult = [R1];
    mockExecutionsFindMany.mockReturnValue([]);
  });

  it('returns report detail', async () => {
    const { GET } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await GET(createTestRequest('/api/tenant/reports/' + ID_A), { params: Promise.resolve({ id: ID_A }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Contact Summary');
  });

  it('returns 404 for missing report', async () => {
    _selectResult = [];

    const { GET } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await GET(createTestRequest('/api/tenant/reports/' + ID_GONE), { params: Promise.resolve({ id: ID_GONE }) });
    expect(res.status).toBe(404);
  });

  it('answers 400 for a path segment that is not an id', async () => {
    // `usage`, a typo or a stale bookmark hits this route. Unchecked it reached
    // Postgres as `invalid input syntax for type uuid` and the API answered 500.
    _selectResult = [R1];
    const { GET } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await GET(createTestRequest('/api/tenant/reports/usage'), { params: Promise.resolve({ id: 'usage' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid report id');
  });
});

describe('DELETE /api/tenant/reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', email: 'admin@test.com', role: 'admin' });
    mockCan.mockReturnValue(true);
    // #860 converted this route from db.delete() to a soft delete: it now runs
    // update().set({ deletedAt }).returning(), which this mock resolves from
    // _patchResult, not _deleteResult. Both are set so the intent stays clear
    // if the route ever moves back to a hard delete.
    _deleteResult = [R1];
    _patchResult = [R1];
  });

  it('deletes saved report', async () => {
    const { DELETE } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await DELETE(createTestRequest('/api/tenant/reports/' + ID_A, { method: 'DELETE' }), { params: Promise.resolve({ id: ID_A }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 for nonexistent report', async () => {
    // The soft delete matches no row, so returning() is empty.
    _deleteResult = [];
    _patchResult = [];

    const { DELETE } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await DELETE(createTestRequest('/api/tenant/reports/' + ID_GONE, { method: 'DELETE' }), { params: Promise.resolve({ id: ID_GONE }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/tenant/reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', email: 'admin@test.com', role: 'admin' });
    mockCan.mockReturnValue(true);
    _patchResult = [R1];
  });

  it('updates saved report', async () => {
    const { PATCH } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await PATCH(
      createTestRequest('/api/tenant/reports/' + ID_A, { method: 'PATCH', body: JSON.stringify({ name: 'Updated Report' }) }),
      { params: Promise.resolve({ id: ID_A }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 with no fields', async () => {
    const { PATCH } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await PATCH(
      createTestRequest('/api/tenant/reports/' + ID_A, { method: 'PATCH', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: ID_A }) }
    );
    expect(res.status).toBe(400);
  });
});

/**
 * `saved_reports.deleted_at` exists and the DELETE handler writes a tombstone
 * there, but no read path used to filter it: a "deleted" report stayed in the
 * list, in the detail GET and in the run lookup forever. These assert the
 * predicate, not just the response code — the mock chain would happily answer
 * with a row for any where clause.
 */
describe('soft-deleted reports are invisible everywhere', () => {
  const dialect = new PgDialect();

  function renderedWhere(): string[] {
    return _whereClauses.map((q) => dialect.sqlToQuery(q as Parameters<PgDialect['sqlToQuery']>[0]).sql.toLowerCase());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _whereClauses.length = 0;
    _lastSetValues = {};
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1', email: 'admin@test.com', role: 'admin' });
    mockCan.mockReturnValue(true);
    _selectResult = [R1];
    _patchResult = [R1];
    mockExecutionsFindMany.mockReturnValue([]);
  });

  it('list GET excludes the tombstone', async () => {
    const { GET } = await import('@/app/api/tenant/reports/saved/route');
    await GET(createTestRequest('/api/tenant/reports/saved'));
    expect(renderedWhere().join(' ')).toMatch(/deleted_at"\s+is\s+null/);
  });

  it('detail GET excludes the tombstone', async () => {
    const { GET } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await GET(createTestRequest(`/api/tenant/reports/${ID_A}`), { params: Promise.resolve({ id: ID_A }) });
    expect(res.status).toBe(200);
    expect(renderedWhere().join(' ')).toMatch(/deleted_at"\s+is\s+null/);
  });

  it('run excludes the tombstone instead of executing a deleted report', async () => {
    const { POST } = await import('@/app/api/tenant/reports/[id]/route');
    await POST(
      createTestRequest(`/api/tenant/reports/${ID_A}`, { method: 'POST', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: ID_A }) }
    );
    expect(renderedWhere().join(' ')).toMatch(/deleted_at"\s+is\s+null/);
  });

  it('PATCH and DELETE refuse a tombstone rather than resurrecting it', async () => {
    const route = await import('@/app/api/tenant/reports/[id]/route');
    await route.PATCH(
      createTestRequest(`/api/tenant/reports/${ID_A}`, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) }),
      { params: Promise.resolve({ id: ID_A }) }
    );
    await route.DELETE(
      createTestRequest(`/api/tenant/reports/${ID_A}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: ID_A }) }
    );
    const sql = renderedWhere().join(' ');
    const hits = sql.match(/deleted_at"\s+is\s+null/g) ?? [];
    expect(hits.length).toBe(2);
    // and the delete is still a tombstone write, not a row removal
    expect(_lastSetValues).toMatchObject({ deletedAt: expect.any(Date) });
  });
});
