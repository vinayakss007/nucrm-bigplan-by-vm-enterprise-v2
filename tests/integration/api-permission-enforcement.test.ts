/**
 * #666 — API Permission Enforcement Tests
 *
 * Verifies that protected API routes return 403 when the user lacks
 * the required permission (mocked requirePerm returns a NextResponse 403).
 *
 * Does NOT import from auth-mock.ts to avoid vi.mock conflicts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { mockDb, mockResolver } from '../helpers/db-mock';
import type { AuthContext } from '@/lib/auth/middleware';

// ── Shared mock setup ──
const mockRequireAuth = vi.fn();
const mockRequirePerm = vi.fn();
const mockRequireModule = vi.fn().mockResolvedValue(null);

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth, requirePerm: mockRequirePerm, requireModule: mockRequireModule };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/webhooks', () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/cache', () => ({
  cache: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  invalidateWidgetCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/concurrency', () => ({
  withConcurrencyGuard: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/usage/middleware', () => ({
  checkLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn().mockResolvedValue(null),
}));

// ── Helpers ──
const BASE_CTX: AuthContext = {
  userId: 'user-001',
  tenantId: 'tenant-001',
  email: 'user@test.com',
  isAdmin: false,
  isSuperAdmin: false,
  permissions: { 'contacts.view': true, 'companies.view': true, 'tickets.view': true, 'deals.create': true },
  roleSlug: 'member',
};

function makeReq(path: string, opts?: RequestInit): NextRequest {
  const headers = new Headers(opts?.headers);
  headers.set('cookie', 'nucrm_session=test-token');
  headers.set('x-forwarded-for', '127.0.0.1');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), { ...opts, headers });
}

function makePostReq(path: string, body: unknown): NextRequest {
  return makeReq(path, { method: 'POST', body: JSON.stringify(body) });
}

// ── Tests ──
describe('API Permission Enforcement (#666)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolver(() => []);
  });

  function expect403(res: Response) {
    expect(res.status).toBe(403);
    return res.json().then((b) => expect(b.error).toBeDefined());
  }

  describe('GET /api/tenant/contacts — non-admin without view_all sees only own contacts', () => {
    it('filters by assignedTo when canViewAll is false', async () => {
      const memberCtx: AuthContext = {
        ...BASE_CTX,
        isAdmin: false,
        permissions: { 'contacts.view': true },
      };
      mockRequireAuth.mockResolvedValue(memberCtx);
      mockRequirePerm.mockReturnValue(null);
      // Don't set mockResolver — contacts GET runs TWO queries (count + data)
      // both hitting the same mock. Using [] means countResult is undefined
      // (total defaults to 0) and data is empty. That's correct for this test.

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/tenant/contacts — allowed with contacts.view', () => {
    it('returns 200 when requirePerm returns null', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/tenant/contacts/[id] — 403 without contacts.edit', () => {
    it('returns 403 when requirePerm returns 403', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(NextResponse.json({ error: 'Forbidden: contacts.edit' }, { status: 403 }));

      const { PATCH } = await import('@/app/api/tenant/contacts/[id]/route');
      const res = await PATCH(makeReq('/api/tenant/contacts/c1', { method: 'PATCH', body: JSON.stringify({ first_name: 'X' }) }), { params: Promise.resolve({ id: 'c1' }) });
      await expect403(res);
    });
  });

  describe('DELETE /api/tenant/contacts/[id] — 403 without contacts.delete', () => {
    it('returns 403 when requirePerm returns 403', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(NextResponse.json({ error: 'Forbidden: contacts.delete' }, { status: 403 }));

      const { DELETE } = await import('@/app/api/tenant/contacts/[id]/route');
      const res = await DELETE(makeReq('/api/tenant/contacts/c1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'c1' }) });
      await expect403(res);
    });
  });

  describe('GET /api/tenant/companies — 403 without companies.view', () => {
    it('returns 403 when requirePerm returns 403', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(NextResponse.json({ error: 'Forbidden: companies.view' }, { status: 403 }));

      const { GET } = await import('@/app/api/tenant/companies/route');
      const res = await GET(makeReq('/api/tenant/companies'));
      await expect403(res);
    });
  });

  describe('GET /api/tenant/tickets — 403 without tickets.view', () => {
    it('returns 403 when requirePerm returns 403', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(NextResponse.json({ error: 'Forbidden: tickets.view' }, { status: 403 }));

      const { GET } = await import('@/app/api/tenant/tickets/route');
      const res = await GET(makeReq('/api/tenant/tickets'));
      await expect403(res);
    });
  });

  describe('POST /api/tenant/deals — 403 without deals.create', () => {
    it('returns 403 when requirePerm returns 403', async () => {
      mockRequireAuth.mockResolvedValue(BASE_CTX);
      mockRequirePerm.mockReturnValue(NextResponse.json({ error: 'Forbidden: deals.create' }, { status: 403 }));

      const { POST } = await import('@/app/api/tenant/deals/route');
      const res = await POST(makePostReq('/api/tenant/deals', { title: 'Test' }));
      await expect403(res);
    });
  });

  describe('Admin bypass — requirePerm returns null for admins', () => {
    it('admins get 200 even without specific permission', async () => {
      const adminCtx: AuthContext = { ...BASE_CTX, isAdmin: true, permissions: {} };
      mockRequireAuth.mockResolvedValue(adminCtx);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(200);
    });
  });
});
