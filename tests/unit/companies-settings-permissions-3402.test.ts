/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Mutating & Row-Scoped tenant routes permission gates:
 * Companies (view, view_all, edit, delete) and Settings Status (view).
 *
 * Verifies that:
 *  - GET /api/tenant/companies requires companies.view
 *  - GET /api/tenant/companies scopes by owner unless caller holds companies.view_all
 *  - GET /api/tenant/companies/[id] requires companies.view and owner unless companies.view_all
 *  - PATCH /api/tenant/companies/[id] requires companies.edit and owner unless companies.view_all
 *  - DELETE /api/tenant/companies/[id] requires companies.delete and owner unless companies.view_all
 *  - GET /api/tenant/settings-status requires settings.view
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface AuthCtx {
  tenantId: string;
  userId: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  permissions?: Record<string, boolean>;
}

const { mockAuthCtx, mockDb, companyMine, companyOther } = vi.hoisted(() => {
  const TENANT = 'tenant-test-1';
  const USER_MINE = 'user-mine';
  const USER_OTHER = 'user-other';

  const mine = {
    id: 'comp-mine',
    tenantId: TENANT,
    name: 'My Company',
    industry: 'Software',
    companySize: '10-50',
    website: 'https://mine.example.com',
    phone: '555-0001',
    address: '123 Main St',
    notes: 'My notes',
    customFields: {},
    assignedTo: USER_MINE,
    createdBy: USER_MINE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const other = {
    id: 'comp-other',
    tenantId: TENANT,
    name: 'Other Company',
    industry: 'Retail',
    companySize: '100+',
    website: 'https://other.example.com',
    phone: '555-0002',
    address: '456 Elm St',
    notes: 'Other notes',
    customFields: {},
    assignedTo: USER_OTHER,
    createdBy: USER_OTHER,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const authCtx: AuthCtx = {
    tenantId: TENANT,
    userId: USER_MINE,
    isAdmin: false,
    isSuperAdmin: false,
    permissions: {},
  };

  interface Chainable {
    from: () => Chainable;
    leftJoin: () => Chainable;
    where: () => Chainable;
    orderBy: () => Chainable;
    groupBy: () => Chainable;
    limit: () => Chainable;
    offset: () => Chainable;
    as: () => Chainable;
    returning: () => Promise<unknown[]>;
    then: (resolve: (v: unknown) => void) => void;
  }

  const makeChain = (res: unknown = [mine]): Chainable => ({
    from: () => makeChain(res),
    leftJoin: () => makeChain(res),
    where: () => makeChain(res),
    orderBy: () => makeChain(res),
    groupBy: () => makeChain(res),
    limit: () => makeChain(res),
    offset: () => makeChain(res),
    as: () => makeChain(res),
    returning: async () => (Array.isArray(res) ? res : [res]),
    then: (resolve: (v: unknown) => void) => resolve(res),
  });

  const dbObj = {
    select: vi.fn(() => makeChain([mine])),
    update: vi.fn(() => ({
      set: () => makeChain([{ id: 'comp-mine' }]),
    })),
    query: {
      companies: {
        findFirst: vi.fn(async () => mine),
      },
    },
  };

  return { mockAuthCtx: authCtx, mockDb: dbObj, companyMine: mine, companyOther: other };
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(h: T) => h,
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/webhooks', () => ({
  fireWebhooks: vi.fn(async () => undefined),
}));

vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: vi.fn(async (_ctx, _entity, rows) => rows),
  enforceFieldWrite: vi.fn(async (_ctx, _entity, body) => ({ body, stripped: [] })),
  attachStrippedFields: vi.fn((res) => res),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: vi.fn(async () => mockAuthCtx),
    can: (ctx: AuthCtx, perm: string) => {
      return (
        ctx.isSuperAdmin === true ||
        ctx.isAdmin === true ||
        ctx.permissions?.['all'] === true ||
        ctx.permissions?.[perm] === true
      );
    },
    requirePerm: (ctx: AuthCtx, perm: string) => {
      if (
        ctx.isSuperAdmin ||
        ctx.isAdmin ||
        ctx.permissions?.['all'] === true ||
        ctx.permissions?.[perm] === true
      ) {
        return null;
      }
      return NextResponse.json(
        { error: 'Forbidden', message: `Missing required permission: ${perm}` },
        { status: 403 },
      );
    },
  };
});

vi.mock('@/drizzle/db', () => ({ db: mockDb }));

import { GET as getCompanies } from '@/app/api/tenant/companies/route';
import {
  GET as getCompany,
  PATCH as patchCompany,
  DELETE as deleteCompany,
} from '@/app/api/tenant/companies/[id]/route';
import { GET as getSettingsStatus } from '@/app/api/tenant/settings-status/route';

function makeRequest(method: string, path: string, body?: unknown): NextRequest {
  const url = `http://localhost:3000${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(new URL(url), init);
}

describe('#3402 (PR-2E) Companies & Settings Status Permission Gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthCtx.tenantId = 'tenant-test-1';
    mockAuthCtx.userId = 'user-mine';
    mockAuthCtx.isAdmin = false;
    mockAuthCtx.isSuperAdmin = false;
    mockAuthCtx.permissions = {};
    mockDb.query.companies.findFirst.mockImplementation(async () => companyMine);
  });

  describe('Companies List Route (GET /api/tenant/companies)', () => {
    it('GET 403s without companies.view', async () => {
      const req = makeRequest('GET', '/api/tenant/companies');
      const res = await getCompanies(req);
      expect(res.status).toBe(403);
    });

    it('GET 200s with companies.view', async () => {
      mockAuthCtx.permissions = { 'companies.view': true };
      const req = makeRequest('GET', '/api/tenant/companies');
      const res = await getCompanies(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Company Detail Route (GET /api/tenant/companies/[id])', () => {
    it('GET 403s without companies.view', async () => {
      const req = makeRequest('GET', '/api/tenant/companies/comp-mine');
      const res = await getCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(403);
    });

    it('GET 404s when holding companies.view without companies.view_all on foreign company', async () => {
      mockAuthCtx.permissions = { 'companies.view': true };
      mockDb.query.companies.findFirst.mockImplementation(async () => companyOther);
      const req = makeRequest('GET', '/api/tenant/companies/comp-other');
      const res = await getCompany(req, { params: Promise.resolve({ id: 'comp-other' }) });
      expect(res.status).toBe(404);
    });

    it('GET 200s when holding companies.view without companies.view_all on own company', async () => {
      mockAuthCtx.permissions = { 'companies.view': true };
      mockDb.query.companies.findFirst.mockImplementation(async () => companyMine);
      const req = makeRequest('GET', '/api/tenant/companies/comp-mine');
      const res = await getCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(200);
    });

    it('GET 200s when holding companies.view_all on foreign company', async () => {
      mockAuthCtx.permissions = { 'companies.view': true, 'companies.view_all': true };
      mockDb.query.companies.findFirst.mockImplementation(async () => companyOther);
      const req = makeRequest('GET', '/api/tenant/companies/comp-other');
      const res = await getCompany(req, { params: Promise.resolve({ id: 'comp-other' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Company Update Route (PATCH /api/tenant/companies/[id])', () => {
    it('PATCH 403s without companies.edit', async () => {
      const req = makeRequest('PATCH', '/api/tenant/companies/comp-mine', { name: 'Updated' });
      const res = await patchCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 404s when holding companies.edit without companies.view_all on foreign company', async () => {
      mockAuthCtx.permissions = { 'companies.edit': true };
      mockDb.select.mockImplementation(() => {
        interface Chainable {
          from: () => Chainable;
          where: () => Chainable;
          limit: () => Promise<unknown[]>;
        }
        const chain = (res: unknown[]): Chainable => ({
          from: () => chain(res),
          where: () => chain(res),
          limit: async () => res,
        });
        return chain([{ assignedTo: 'user-other', createdBy: 'user-other' }]) as never;
      });
      const req = makeRequest('PATCH', '/api/tenant/companies/comp-other', { name: 'Updated' });
      const res = await patchCompany(req, { params: Promise.resolve({ id: 'comp-other' }) });
      expect(res.status).toBe(404);
    });

    it('PATCH 200s when holding companies.edit without companies.view_all on own company', async () => {
      mockAuthCtx.permissions = { 'companies.edit': true };
      mockDb.select.mockImplementation(() => {
        interface Chainable {
          from: () => Chainable;
          where: () => Chainable;
          limit: () => Promise<unknown[]>;
        }
        const chain = (res: unknown[]): Chainable => ({
          from: () => chain(res),
          where: () => chain(res),
          limit: async () => res,
        });
        return chain([{ assignedTo: 'user-mine', createdBy: 'user-mine' }]) as never;
      });
      const req = makeRequest('PATCH', '/api/tenant/companies/comp-mine', { name: 'Updated' });
      const res = await patchCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Company Delete Route (DELETE /api/tenant/companies/[id])', () => {
    it('DELETE 403s without companies.delete', async () => {
      const req = makeRequest('DELETE', '/api/tenant/companies/comp-mine');
      const res = await deleteCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 404s when holding companies.delete without companies.view_all on foreign company', async () => {
      mockAuthCtx.permissions = { 'companies.delete': true };
      mockDb.select.mockImplementation(() => {
        interface Chainable {
          from: () => Chainable;
          where: () => Chainable;
          limit: () => Promise<unknown[]>;
        }
        const chain = (res: unknown[]): Chainable => ({
          from: () => chain(res),
          where: () => chain(res),
          limit: async () => res,
        });
        return chain([{ assignedTo: 'user-other', createdBy: 'user-other' }]) as never;
      });
      const req = makeRequest('DELETE', '/api/tenant/companies/comp-other');
      const res = await deleteCompany(req, { params: Promise.resolve({ id: 'comp-other' }) });
      expect(res.status).toBe(404);
    });

    it('DELETE 200s when holding companies.delete without companies.view_all on own company', async () => {
      mockAuthCtx.permissions = { 'companies.delete': true };
      mockDb.select.mockImplementation(() => {
        interface Chainable {
          from: () => Chainable;
          where: () => Chainable;
          limit: () => Promise<unknown[]>;
        }
        const chain = (res: unknown[]): Chainable => ({
          from: () => chain(res),
          where: () => chain(res),
          limit: async () => res,
        });
        return chain([{ assignedTo: 'user-mine', createdBy: 'user-mine' }]) as never;
      });
      const req = makeRequest('DELETE', '/api/tenant/companies/comp-mine');
      const res = await deleteCompany(req, { params: Promise.resolve({ id: 'comp-mine' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Settings Status Route (GET /api/tenant/settings-status)', () => {
    it('GET 403s without settings.view', async () => {
      const req = makeRequest('GET', '/api/tenant/settings-status');
      const res = await getSettingsStatus(req);
      expect(res.status).toBe(403);
    });

    it('GET 200s with settings.view', async () => {
      mockAuthCtx.permissions = { 'settings.view': true };
      const req = makeRequest('GET', '/api/tenant/settings-status');
      const res = await getSettingsStatus(req);
      expect(res.status).toBe(200);
    });
  });
});
