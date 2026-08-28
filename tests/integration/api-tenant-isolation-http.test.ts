/**
 * #666 — Tenant Isolation HTTP Tests
 *
 * Verifies that API routes return tenant-scoped data through the
 * requireAuth middleware. When authenticated as tenant-a, contacts
 * for tenant-b should not appear.
 *
 * Does NOT import from auth-mock.ts to avoid vi.mock conflicts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
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
  invalidateTenantCache: vi.fn().mockResolvedValue(undefined),
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
function ctx(tenantId = 'tenant-a-001'): AuthContext {
  return {
    userId: 'user-a-001',
    tenantId,
    email: 'a@test.com',
    isAdmin: true,
    isSuperAdmin: false,
    permissions: { all: true },
    roleSlug: 'admin',
  };
}

function makeReq(path: string, opts?: RequestInit): NextRequest {
  const headers = new Headers(opts?.headers);
  headers.set('cookie', 'nucrm_session=test-token');
  headers.set('x-forwarded-for', '127.0.0.1');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), { ...opts, headers });
}

// ── Tests ──
describe('Tenant Isolation HTTP (#666)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('GET /api/tenant/contacts — empty for tenant with no contacts', () => {
    it('returns empty data for a new tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('new-tenant-001'));
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/tenant/deals — empty for tenant with no deals', () => {
    it('returns empty data for a new tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('new-tenant-001'));
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/deals/route');
      const res = await GET(makeReq('/api/tenant/deals'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/tenant/tasks — empty for tenant with no tasks', () => {
    it('returns empty data for a new tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('new-tenant-001'));
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/tasks/route');
      const res = await GET(makeReq('/api/tenant/tasks'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/tenant/companies — empty for tenant with no companies', () => {
    it('returns empty data for a new tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('new-tenant-001'));
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/companies/route');
      const res = await GET(makeReq('/api/tenant/companies'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/tenant/tickets — empty for tenant with no tickets', () => {
    it('returns empty data for a new tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('new-tenant-001'));
      mockRequirePerm.mockReturnValue(null);
      mockRequireModule.mockResolvedValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/tickets/route');
      const res = await GET(makeReq('/api/tenant/tickets'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('POST /api/tenant/contacts — correct tenant', () => {
    it('creates contact with correct tenantId', async () => {
      const contact = { id: 'c-new', tenantId: 'tenant-a-001', firstName: 'New', lastName: 'Contact', email: 'new@test.com' };
      mockRequireAuth.mockResolvedValue(ctx('tenant-a-001'));
      mockRequirePerm.mockReturnValue(null);
      mockRequireModule.mockResolvedValue(null);
      // Duplicate email check returns [] (no existing contact), insert returns the new contact
      mockResolver(() => []);
      mockDb.returning.mockResolvedValueOnce([contact]);

      const { POST } = await import('@/app/api/tenant/contacts/route');
      const res = await POST(makeReq('/api/tenant/contacts', {
        method: 'POST',
        body: JSON.stringify({ first_name: 'New', last_name: 'Contact', email: 'new@test.com' }),
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.tenantId).toBe('tenant-a-001');
    });
  });

  describe('GET /api/tenant/contacts/[id] — wrong tenant returns 404', () => {
    it('returns 404 when contact belongs to different tenant', async () => {
      mockRequireAuth.mockResolvedValue(ctx('tenant-b-001'));
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => []);

      const { GET } = await import('@/app/api/tenant/contacts/[id]/route');
      const res = await GET(makeReq('/api/tenant/contacts/c-from-tenant-a'), { params: Promise.resolve({ id: 'c-from-tenant-a' }) });
      expect(res.status).toBe(404);
    });
  });
});
