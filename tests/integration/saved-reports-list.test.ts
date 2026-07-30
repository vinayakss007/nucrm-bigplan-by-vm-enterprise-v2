import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Build a fluent chain: every method returns an object with all follow-ups.
// The "terminal" methods (limit, orderBy, returning) return _selectResult.
function makeSelectChain() {
  const terminal = () => _selectResult;
  const self: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'leftJoin', 'where', 'orderBy', 'limit']) {
    self[m] = () => (m === 'limit' || m === 'orderBy') ? terminal() : self;
  }
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeSelectChain(),
    delete: () => ({
      where: () => ({ returning: () => _deleteResult }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => _patchResult }),
      }),
    }),
    query: {
      reportExecutions: {
        findMany: (...a: unknown[]) => { mockExecutionsFindMany(...a); return _selectResult; },
      },
    },
  },
}));

function createTestRequest(path: string, opts: RequestInit & { method?: string } = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', cookie: 'session=test', ...(opts.headers as Record<string, string> || {}) },
    body: opts.body,
  });
}

const R1 = { id: 'r-1', name: 'Contact Summary', reportType: 'contacts', chartType: 'bar', isPublic: true, lastRunAt: '2026-01-15', createdBy: 'user-1', createdAt: '2026-01-01', updatedAt: '2026-01-10', createdByName: 'Admin User' };
const R2 = { id: 'r-2', name: 'Deal Pipeline', reportType: 'deals', chartType: 'pie', isPublic: false, lastRunAt: null, createdBy: 'user-2', createdAt: '2026-01-05', updatedAt: '2026-01-08', createdByName: 'Sales User' };

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
    const res = await GET(createTestRequest('/api/tenant/reports/r-1'), { params: Promise.resolve({ id: 'r-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Contact Summary');
  });

  it('returns 404 for missing report', async () => {
    _selectResult = [];

    const { GET } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await GET(createTestRequest('/api/tenant/reports/missing'), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
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
    const res = await DELETE(createTestRequest('/api/tenant/reports/r-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'r-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 for nonexistent report', async () => {
    // The soft delete matches no row, so returning() is empty.
    _deleteResult = [];
    _patchResult = [];

    const { DELETE } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await DELETE(createTestRequest('/api/tenant/reports/missing', { method: 'DELETE' }), { params: Promise.resolve({ id: 'missing' }) });
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
      createTestRequest('/api/tenant/reports/r-1', { method: 'PATCH', body: JSON.stringify({ name: 'Updated Report' }) }),
      { params: Promise.resolve({ id: 'r-1' }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 with no fields', async () => {
    const { PATCH } = await import('@/app/api/tenant/reports/[id]/route');
    const res = await PATCH(
      createTestRequest('/api/tenant/reports/r-1', { method: 'PATCH', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: 'r-1' }) }
    );
    expect(res.status).toBe(400);
  });
});
