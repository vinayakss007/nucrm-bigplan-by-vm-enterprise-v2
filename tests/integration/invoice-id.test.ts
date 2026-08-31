import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuthContext } from '../helpers/auth-mock';

const {
  mockRequireAuth, mockCan, mockLogAudit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCan: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requirePerm: (...args: unknown[]) => mockCan(...args),
  // #1835: handlers call requireCsrf() as defense-in-depth; no-op in tests.
  requireCsrf: () => null,
}));

vi.mock('@/lib/audit', () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

// ── Mutable results that control what the DB mock returns ──
let _selectResult: unknown[] = [];
let _updateResult: unknown[] = [];

function makeSelectChain() {
  const terminal = () => _selectResult;
  const self: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) {
    self[m] = () => (m === 'limit' || m === 'orderBy') ? terminal() : self;
  }
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => makeSelectChain(),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => _updateResult,
        }),
      }),
    }),
  },
}));

function createTestRequest(path: string, opts: RequestInit & { method?: string } = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', cookie: 'session=test', ...(opts.headers as Record<string, string> || {}) },
    body: opts.body,
  });
}

const INV = {
  id: 'inv-1',
  tenantId: 'tenant-1',
  invoiceNumber: 'INV-001',
  title: 'Test Invoice',
  status: 'draft',
  issueDate: '2026-01-15',
  dueDate: '2026-02-15',
  subtotal: '500.00',
  totalAmount: '500.00',
  currency: 'USD',
  notes: 'Test notes',
  createdAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
  deletedAt: null,
  createdBy: 'user-1',
};

describe('Invoice [id] API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockRequireAuth.mockResolvedValue(requireAuthContext());
    mockCan.mockReturnValue(null);
    mockLogAudit.mockResolvedValue(undefined);
    _selectResult = [];
    _updateResult = [];
  });

  // ─── GET ───────────────────────────────────────────────────────────────────
  describe('GET /api/tenant/invoices/[id]', () => {
    it('returns invoice when found', async () => {
      _selectResult = [INV];
      const { GET } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await GET(
        createTestRequest('/api/tenant/invoices/inv-1'),
        { params: Promise.resolve({ id: 'inv-1' }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe('inv-1');
      expect(body.data.invoiceNumber).toBe('INV-001');
    });

    it('returns 404 when not found', async () => {
      _selectResult = [];
      const { GET } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await GET(
        createTestRequest('/api/tenant/invoices/missing'),
        { params: Promise.resolve({ id: 'missing' }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── PUT ───────────────────────────────────────────────────────────────────
  describe('PUT /api/tenant/invoices/[id]', () => {
    it('updates invoice fields', async () => {
      _selectResult = [{ id: 'inv-1' }];
      _updateResult = [{ ...INV, title: 'Updated Invoice' }];
      const { PUT } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await PUT(
        createTestRequest('/api/tenant/invoices/inv-1', {
          method: 'PUT',
          body: JSON.stringify({ title: 'Updated Invoice' }),
        }),
        { params: Promise.resolve({ id: 'inv-1' }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe('Updated Invoice');
    });

    it('returns 400 for invalid numeric field', async () => {
      _selectResult = [{ id: 'inv-1' }];
      const { PUT } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await PUT(
        createTestRequest('/api/tenant/invoices/inv-1', {
          method: 'PUT',
          body: JSON.stringify({ subtotal: 'not-a-number' }),
        }),
        { params: Promise.resolve({ id: 'inv-1' }) },
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('subtotal');
    });

    it('returns 400 when no valid fields', async () => {
      _selectResult = [{ id: 'inv-1' }];
      const { PUT } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await PUT(
        createTestRequest('/api/tenant/invoices/inv-1', {
          method: 'PUT',
          body: JSON.stringify({ nonexistent: 'value' }),
        }),
        { params: Promise.resolve({ id: 'inv-1' }) },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when invoice not found', async () => {
      _selectResult = [];
      const { PUT } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await PUT(
        createTestRequest('/api/tenant/invoices/missing', {
          method: 'PUT',
          body: JSON.stringify({ title: 'test' }),
        }),
        { params: Promise.resolve({ id: 'missing' }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE ────────────────────────────────────────────────────────────────
  describe('DELETE /api/tenant/invoices/[id]', () => {
    it('soft-deletes invoice', async () => {
      _updateResult = [{ id: 'inv-1' }];
      const { DELETE } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await DELETE(
        createTestRequest('/api/tenant/invoices/inv-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'inv-1' }) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('returns 404 when invoice not found', async () => {
      _updateResult = [];
      const { DELETE } = await import('@/app/api/tenant/invoices/[id]/route');
      const res = await DELETE(
        createTestRequest('/api/tenant/invoices/missing', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'missing' }) },
      );
      expect(res.status).toBe(404);
    });
  });
});
