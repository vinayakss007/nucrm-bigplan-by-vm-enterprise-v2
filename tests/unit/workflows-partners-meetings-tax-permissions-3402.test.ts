/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Mutating tenant routes permission gates:
 * Workflows, Partners Deals, Meetings, Tax, Territories, Webhook Field-Mappings.
 *
 * Verifies that:
 *  - GET /api/tenant/automation/workflows requires automations.view
 *  - PATCH /api/tenant/automation/workflows requires automations.manage
 *  - POST /api/tenant/partners/[id]/deals requires partners.create
 *  - GET /api/tenant/meetings/[id] requires meetings.view
 *  - PATCH /api/tenant/meetings/[id] requires meetings.create
 *  - DELETE /api/tenant/meetings/[id] requires meetings.create
 *  - POST /api/tenant/tax requires settings.manage
 *  - PUT /api/tenant/tax requires settings.manage
 *  - DELETE /api/tenant/tax requires settings.manage
 *  - POST /api/tenant/territories requires settings.manage
 *  - PUT /api/tenant/territories requires settings.manage
 *  - DELETE /api/tenant/territories requires settings.manage
 *  - POST /api/tenant/webhooks/field-mappings requires settings.manage
 *  - PATCH /api/tenant/webhooks/field-mappings requires settings.manage
 *  - DELETE /api/tenant/webhooks/field-mappings requires settings.manage
 *
 * An unprivileged caller without the requisite permission receives 403 Forbidden.
 * When granted the specific permission or admin rights, the gate opens.
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

const { mockAuthCtx, mockDb } = vi.hoisted(() => {
  interface Chainable {
    from: () => Chainable;
    leftJoin: () => Chainable;
    where: () => Chainable;
    orderBy: () => Chainable;
    limit: () => Chainable;
    returning: () => Promise<unknown[]>;
    onConflictDoUpdate: () => Promise<unknown[]>;
    then: (resolve: (v: unknown) => void) => void;
  }

  const mockRow = {
    id: 'row-1',
    tenantId: 'tenant-test-1',
    userId: 'user-test-1',
    workflowId: 'w-1',
    name: 'Test',
    rate: '10',
    type: 'percentage',
    enabled: true,
    config: {},
    updatedAt: new Date(),
    createdAt: new Date(),
    isActive: true,
    sourceKey: 'src',
    targetType: 'native',
    targetKey: 'email',
  };

  const makeChain = (res: unknown = [mockRow]): Chainable => ({
    from: () => makeChain(res),
    leftJoin: () => makeChain(res),
    where: () => makeChain(res),
    orderBy: () => makeChain(res),
    limit: () => makeChain(res),
    returning: async () => (Array.isArray(res) ? res : [res]),
    onConflictDoUpdate: async () => (Array.isArray(res) ? res : [res]),
    then: (resolve: (v: unknown) => void) => resolve(res),
  });

  const authCtx: AuthCtx = {
    tenantId: 'tenant-test-1',
    userId: 'user-test-1',
    isAdmin: false,
    isSuperAdmin: false,
    permissions: {},
  };

  const dbObj = {
    select: vi.fn(() => makeChain([mockRow])),
    insert: vi.fn(() => ({
      values: () => makeChain([mockRow]),
    })),
    update: vi.fn(() => ({
      set: () => makeChain([mockRow]),
    })),
    delete: vi.fn(() => ({
      where: () => makeChain([mockRow]),
    })),
    query: {
      customFieldDefs: {
        findFirst: vi.fn(async () => mockRow),
      },
      webhookFieldMappings: {
        findFirst: vi.fn(async () => mockRow),
        findMany: vi.fn(async () => [mockRow]),
      },
      apiKeys: {
        findFirst: vi.fn(async () => mockRow),
      },
    },
  };

  return { mockAuthCtx: authCtx, mockDb: dbObj };
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(h: T) => h,
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
}));

vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: vi.fn(async () => mockAuthCtx),
    requireModule: vi.fn(async () => null),
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

vi.mock('@/lib/concurrency', () => ({
  withConcurrencyGuard: vi.fn(async (fn: () => unknown) => [await fn()]),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
  concurrencyGuardById: vi.fn(async () => null),
  checkStaleUpdate: vi.fn(() => null),
  updatedAtMs: vi.fn(() => ({}) as never),
}));

vi.mock('@/lib/partners', () => ({
  getPartnerById: vi.fn(() => ({ id: 'p-1', status: 'active' })),
  getPartnerDealRegistrations: vi.fn(() => []),
  checkConflict: vi.fn(() => null),
  registerDeal: vi.fn(() => ({ id: 'reg-1', dealTitle: 'Deal A' })),
}));

vi.mock('@/lib/automation/workflows', () => ({
  getAllWorkflows: vi.fn(() => [{ id: 'w-1', name: 'Prebuilt 1', description: 'Test' }]),
}));

vi.mock('@/lib/territories', () => ({
  getTerritoryTree: vi.fn(async () => []),
}));

vi.mock('@/lib/webhooks/field-mapping', () => ({
  isValidNativeTarget: vi.fn(() => true),
  NATIVE_TARGETS: { contact: ['email'] },
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));

import { GET as getWorkflows, PATCH as patchWorkflows } from '@/app/api/tenant/automation/workflows/route';
import { POST as postPartnerDeals } from '@/app/api/tenant/partners/[id]/deals/route';
import { GET as getMeeting, PATCH as patchMeeting, DELETE as deleteMeeting } from '@/app/api/tenant/meetings/[id]/route';
import { POST as postTax, PUT as putTax, DELETE as deleteTax } from '@/app/api/tenant/tax/route';
import { POST as postTerritory, PUT as putTerritory, DELETE as deleteTerritory } from '@/app/api/tenant/territories/route';
import { POST as postFieldMapping, PATCH as patchFieldMapping, DELETE as deleteFieldMapping } from '@/app/api/tenant/webhooks/field-mappings/route';

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

describe('#3402 (PR-2E) - Mutating Routes Permission Gates', () => {
  beforeEach(() => {
    mockAuthCtx.tenantId = 'tenant-test-1';
    mockAuthCtx.userId = 'user-test-1';
    mockAuthCtx.isAdmin = false;
    mockAuthCtx.isSuperAdmin = false;
    mockAuthCtx.permissions = {};
    vi.clearAllMocks();
  });

  describe('Automation Workflows Route', () => {
    it('GET 403s without automations.view', async () => {
      const res = await getWorkflows(makeRequest('GET', '/api/tenant/automation/workflows'));
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('GET 200s with automations.view', async () => {
      mockAuthCtx.permissions = { 'automations.view': true };
      const res = await getWorkflows(makeRequest('GET', '/api/tenant/automation/workflows'));
      expect(res.status).toBe(200);
    });

    it('PATCH 403s without automations.manage', async () => {
      const req = makeRequest('PATCH', '/api/tenant/automation/workflows', {
        workflow_id: 'w-1',
        enabled: true,
      });
      const res = await patchWorkflows(req);
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with automations.manage', async () => {
      mockAuthCtx.permissions = { 'automations.manage': true };
      const req = makeRequest('PATCH', '/api/tenant/automation/workflows', {
        workflow_id: 'w-1',
        enabled: true,
      });
      const res = await patchWorkflows(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Partner Deals Route', () => {
    it('POST 403s without partners.create', async () => {
      const req = makeRequest('POST', '/api/tenant/partners/p-1/deals', {
        dealTitle: 'Big Deal',
        contactName: 'Alice',
        contactEmail: 'alice@example.com',
        expectedValue: 5000,
      });
      const res = await postPartnerDeals(req, { params: Promise.resolve({ id: 'p-1' }) });
      expect(res.status).toBe(403);
    });

    it('POST 201s with partners.create', async () => {
      mockAuthCtx.permissions = { 'partners.create': true };
      const req = makeRequest('POST', '/api/tenant/partners/p-1/deals', {
        dealTitle: 'Big Deal',
        contactName: 'Alice',
        contactEmail: 'alice@example.com',
        expectedValue: 5000,
      });
      const res = await postPartnerDeals(req, { params: Promise.resolve({ id: 'p-1' }) });
      expect(res.status).toBe(201);
    });
  });

  describe('Meetings [id] Route', () => {
    it('GET 403s without meetings.view', async () => {
      const req = makeRequest('GET', '/api/tenant/meetings/m-1');
      const res = await getMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(403);
    });

    it('GET 200s with meetings.view', async () => {
      mockAuthCtx.permissions = { 'meetings.view': true };
      const req = makeRequest('GET', '/api/tenant/meetings/m-1');
      const res = await getMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(200);
    });

    it('PATCH 403s without meetings.create', async () => {
      const req = makeRequest('PATCH', '/api/tenant/meetings/m-1', { title: 'Updated' });
      const res = await patchMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with meetings.create', async () => {
      mockAuthCtx.permissions = { 'meetings.create': true };
      const req = makeRequest('PATCH', '/api/tenant/meetings/m-1', { title: 'Updated' });
      const res = await patchMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without meetings.create', async () => {
      const req = makeRequest('DELETE', '/api/tenant/meetings/m-1');
      const res = await deleteMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with meetings.create', async () => {
      mockAuthCtx.permissions = { 'meetings.create': true };
      const req = makeRequest('DELETE', '/api/tenant/meetings/m-1');
      const res = await deleteMeeting(req, { params: Promise.resolve({ id: 'm-1' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Tax Route', () => {
    it('POST 403s without settings.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/tax', { name: 'GST', rate: 18 });
      const res = await postTax(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('POST', '/api/tenant/tax', { name: 'GST', rate: 18 });
      const res = await postTax(req);
      expect(res.status).toBe(201);
    });

    it('PUT 403s without settings.manage', async () => {
      const req = makeRequest('PUT', '/api/tenant/tax', {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'VAT',
      });
      const res = await putTax(req);
      expect(res.status).toBe(403);
    });

    it('PUT 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('PUT', '/api/tenant/tax', {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'VAT',
      });
      const res = await putTax(req);
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without settings.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/tax?id=11111111-1111-4111-8111-111111111111');
      const res = await deleteTax(req);
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/tax?id=11111111-1111-4111-8111-111111111111');
      const res = await deleteTax(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Territories Route', () => {
    it('POST 403s without settings.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/territories', {
        name: 'APAC',
        type: 'region',
      });
      const res = await postTerritory(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('POST', '/api/tenant/territories', {
        name: 'APAC',
        type: 'region',
      });
      const res = await postTerritory(req);
      expect(res.status).toBe(201);
    });

    it('PUT 403s without settings.manage', async () => {
      const req = makeRequest('PUT', '/api/tenant/territories', {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'EMEA',
      });
      const res = await putTerritory(req);
      expect(res.status).toBe(403);
    });

    it('PUT 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('PUT', '/api/tenant/territories', {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'EMEA',
      });
      const res = await putTerritory(req);
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without settings.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/territories?id=22222222-2222-4222-8222-222222222222');
      const res = await deleteTerritory(req);
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/territories?id=22222222-2222-4222-8222-222222222222');
      const res = await deleteTerritory(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Webhook Field Mappings Route', () => {
    it('POST 403s without settings.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/webhooks/field-mappings', {
        entityType: 'contact',
        sourceKey: 'phone_ext',
        targetType: 'native',
        targetKey: 'email',
      });
      const res = await postFieldMapping(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      mockDb.query.webhookFieldMappings.findFirst.mockResolvedValueOnce(null as never);
      const req = makeRequest('POST', '/api/tenant/webhooks/field-mappings', {
        entityType: 'contact',
        sourceKey: 'phone_ext',
        targetType: 'native',
        targetKey: 'email',
      });
      const res = await postFieldMapping(req);
      expect(res.status).toBe(201);
    });

    it('PATCH 403s without settings.manage', async () => {
      const req = makeRequest('PATCH', '/api/tenant/webhooks/field-mappings', {
        id: '33333333-3333-4333-8333-333333333333',
        sourceKey: 'phone_ext2',
      });
      const res = await patchFieldMapping(req);
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('PATCH', '/api/tenant/webhooks/field-mappings', {
        id: '33333333-3333-4333-8333-333333333333',
        sourceKey: 'phone_ext2',
      });
      const res = await patchFieldMapping(req);
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without settings.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/webhooks/field-mappings?id=33333333-3333-4333-8333-333333333333');
      const res = await deleteFieldMapping(req);
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/webhooks/field-mappings?id=33333333-3333-4333-8333-333333333333');
      const res = await deleteFieldMapping(req);
      expect(res.status).toBe(200);
    });
  });
});
