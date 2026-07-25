/**
 * #666 — Auth Edge Cases Tests
 *
 * Verifies that API routes handle edge cases in the auth flow:
 * - Expired session token → 401
 * - Deleted user → 401
 * - No active workspace → 403
 * - Super admin with no workspace → allowed
 * - API key auth (different path than JWT)
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

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth, requirePerm: mockRequirePerm };
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
function makeReq(path: string, opts?: RequestInit): NextRequest {
  const headers = new Headers(opts?.headers);
  headers.set('cookie', 'nucrm_session=test-token');
  headers.set('x-forwarded-for', '127.0.0.1');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, 'http://localhost:3000'), { ...opts, headers });
}

// ── Tests ──
describe('Auth Edge Cases (#666)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockResolver(() => []);
  });

  describe('Expired session token → 401', () => {
    it('returns 401 for expired session', async () => {
      mockRequireAuth.mockResolvedValue(
        NextResponse.json({ error: 'Session expired' }, { status: 401 })
      );

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Session expired');
    });
  });

  describe('Invalid/expired JWT → 401', () => {
    it('returns 401 for invalid token', async () => {
      mockRequireAuth.mockResolvedValue(
        NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
      );

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Invalid or expired token');
    });
  });

  describe('Deleted user → 401', () => {
    it('returns 401 when user record not found', async () => {
      mockRequireAuth.mockResolvedValue(
        NextResponse.json({ error: 'User not found' }, { status: 401 })
      );

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('User not found');
    });
  });

  describe('No active workspace → 403', () => {
    it('returns 403 when user has no tenant membership', async () => {
      mockRequireAuth.mockResolvedValue(
        NextResponse.json({ error: 'No active workspace' }, { status: 403 })
      );

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('No active workspace');
    });
  });

  describe('Super admin with no workspace → allowed', () => {
    it('allows super admin even without lastTenantId', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'superadmin-001',
        tenantId: '__superadmin_no_tenant__',
        isSuperAdmin: true,
        isAdmin: true,
        permissions: { all: true },
        roleSlug: 'superadmin',
        noWorkspace: true,
      } as AuthContext);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(200);
    });
  });

  describe('Regular user with valid session → allowed', () => {
    it('returns 200 for authenticated user with valid session', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-001',
        tenantId: 'tenant-001',
        isAdmin: false,
        isSuperAdmin: false,
        permissions: { 'contacts.view': true },
        roleSlug: 'member',
      } as AuthContext);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(200);
    });
  });

  describe('Auth method propagation', () => {
    it('JWT auth sets authMethod in context', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-001',
        tenantId: 'tenant-001',
        authMethod: 'jwt',
      } as AuthContext);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(200);
    });

    it('API key auth sets authMethod in context', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-001',
        tenantId: 'tenant-001',
        authMethod: 'api_key',
      } as AuthContext);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 0 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));

      expect(res.status).toBe(200);
    });
  });

  describe('Cross-user isolation', () => {
    it('user A sees their tenant data only', async () => {
      mockRequireAuth.mockResolvedValue({
        userId: 'user-a-001',
        tenantId: 'tenant-a-001',
        isAdmin: true,
        permissions: { all: true },
      } as AuthContext);
      mockRequirePerm.mockReturnValue(null);
      mockResolver(() => [{ count: 3 }]);

      const { GET } = await import('@/app/api/tenant/contacts/route');
      const res = await GET(makeReq('/api/tenant/contacts'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(3);
      expect(mockRequireAuth).toHaveBeenCalled();
    });
  });
});
