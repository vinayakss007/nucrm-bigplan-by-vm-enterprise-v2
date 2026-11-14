/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3402 PR-2E: Team, Roles, and Members route permission gates.
 *
 * Verifies that:
 * - GET /api/tenant/members enforces 'team.view'
 * - PATCH /api/tenant/members enforces 'team.manage_roles' (change_role) and 'team.remove' (remove)
 * - GET /api/tenant/teams enforces 'team.view'
 * - GET /api/tenant/teams/[id] enforces 'team.view'
 * - DELETE /api/tenant/teams/[id]/members enforces 'team.remove'
 * - GET /api/tenant/roles enforces 'team.view'
 * - POST /api/tenant/roles enforces 'team.manage_roles'
 * - PATCH /api/tenant/roles/[id] enforces 'team.manage_roles'
 * - DELETE /api/tenant/roles/[id] enforces 'team.manage_roles'
 *
 * Usage: npx vitest run tests/unit/team-permissions-3402.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_ID = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';
const ROLE_ID = 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr';
const MEMBER_ID = 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm';

let currentCtx: AuthContext | null = null;

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => currentCtx ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 })),
  };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/cache/sessions', () => ({
  deleteUserSessions: vi.fn(async () => undefined),
  invalidateUserContexts: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

function makeBuilder(rows: unknown[] = []) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy', 'where']) {
    builder[m] = chain;
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

function session(permissions: Record<string, boolean> = {}, roleSlug = 'rep'): AuthContext {
  return {
    userId: USER,
    tenantId: TENANT,
    roleSlug,
    permissions,
    isAdmin: roleSlug === 'admin',
    isSuperAdmin: false,
  } as unknown as AuthContext;
}

describe('Team & Roles permission gating (#3402)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockImplementation(() => makeBuilder([]));
  });

  describe('GET /api/tenant/members', () => {
    it('rejects with 403 when session lacks team.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/members/route');
      const req = new NextRequest(new URL('/api/tenant/members', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.view required/i);
    });

    it('allows access when session has team.view', async () => {
      currentCtx = session({ 'team.view': true });
      const { GET } = await import('@/app/api/tenant/members/route');
      const req = new NextRequest(new URL('/api/tenant/members', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });

    it('allows access for admin role', async () => {
      currentCtx = session({}, 'admin');
      const { GET } = await import('@/app/api/tenant/members/route');
      const req = new NextRequest(new URL('/api/tenant/members', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/tenant/members', () => {
    it('enforces team.manage_roles on change_role action', async () => {
      currentCtx = session({ 'team.view': true });
      const { PATCH } = await import('@/app/api/tenant/members/route');
      const req = new NextRequest(new URL('/api/tenant/members', 'http://localhost:3000'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId: MEMBER_ID, action: 'change_role', role_slug: 'sales_rep' }),
      });
      const res = await (PATCH as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
    });

    it('enforces team.remove on remove action', async () => {
      currentCtx = session({ 'team.view': true });
      const { PATCH } = await import('@/app/api/tenant/members/route');
      const req = new NextRequest(new URL('/api/tenant/members', 'http://localhost:3000'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId: MEMBER_ID, action: 'remove' }),
      });
      const res = await (PATCH as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/tenant/teams', () => {
    it('rejects with 403 when session lacks team.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/teams/route');
      const req = new NextRequest(new URL('/api/tenant/teams', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.view required/i);
    });

    it('allows access when session has team.view', async () => {
      currentCtx = session({ 'team.view': true });
      const { GET } = await import('@/app/api/tenant/teams/route');
      const req = new NextRequest(new URL('/api/tenant/teams', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/tenant/teams/[id]', () => {
    it('rejects with 403 when session lacks team.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/teams/[id]/route');
      const req = new NextRequest(new URL(`/api/tenant/teams/${TEAM_ID}`, 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: TEAM_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.view required/i);
    });

    it('passes permission gate when session has team.view', async () => {
      currentCtx = session({ 'team.view': true });
      const { GET } = await import('@/app/api/tenant/teams/[id]/route');
      const req = new NextRequest(new URL(`/api/tenant/teams/${TEAM_ID}`, 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: TEAM_ID }) }
      );
      // Returns 404 because team does not exist in mock, proving it passed 403 gate
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/tenant/teams/[id]/members', () => {
    it('rejects with 403 when session lacks team.remove', async () => {
      currentCtx = session({ 'team.view': true });
      const { DELETE } = await import('@/app/api/tenant/teams/[id]/members/route');
      const req = new NextRequest(new URL(`/api/tenant/teams/${TEAM_ID}/members?userId=${USER}`, 'http://localhost:3000'), {
        method: 'DELETE',
      });
      const res = await (DELETE as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: TEAM_ID }) }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/tenant/roles', () => {
    it('rejects with 403 when session lacks team.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/roles/route');
      const req = new NextRequest(new URL('/api/tenant/roles', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.view required/i);
    });

    it('allows access when session has team.view', async () => {
      currentCtx = session({ 'team.view': true });
      const { GET } = await import('@/app/api/tenant/roles/route');
      const req = new NextRequest(new URL('/api/tenant/roles', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/roles', () => {
    it('rejects with 403 when session lacks team.manage_roles', async () => {
      currentCtx = session({ 'team.view': true });
      const { POST } = await import('@/app/api/tenant/roles/route');
      const req = new NextRequest(new URL('/api/tenant/roles', 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Special Role' }),
      });
      const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.manage_roles required/i);
    });

    it('passes permission gate when session has team.manage_roles', async () => {
      currentCtx = session({ 'team.manage_roles': true });
      const { POST } = await import('@/app/api/tenant/roles/route');
      const req = new NextRequest(new URL('/api/tenant/roles', 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Special Role' }),
      });
      const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe('PATCH /api/tenant/roles/[id]', () => {
    it('rejects with 403 when session lacks team.manage_roles', async () => {
      currentCtx = session({ 'team.view': true });
      const { PATCH } = await import('@/app/api/tenant/roles/[id]/route');
      const req = new NextRequest(new URL(`/api/tenant/roles/${ROLE_ID}`, 'http://localhost:3000'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });
      const res = await (PATCH as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: ROLE_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.manage_roles required/i);
    });
  });

  describe('DELETE /api/tenant/roles/[id]', () => {
    it('rejects with 403 when session lacks team.manage_roles', async () => {
      currentCtx = session({ 'team.view': true });
      const { DELETE } = await import('@/app/api/tenant/roles/[id]/route');
      const req = new NextRequest(new URL(`/api/tenant/roles/${ROLE_ID}`, 'http://localhost:3000'), {
        method: 'DELETE',
      });
      const res = await (DELETE as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: ROLE_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied: team\.manage_roles required/i);
    });
  });
});
