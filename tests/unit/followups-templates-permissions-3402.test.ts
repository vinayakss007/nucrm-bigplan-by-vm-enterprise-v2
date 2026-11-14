/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Mutating tenant routes permission gates:
 * Follow-Ups, Email Templates, and SMS Templates.
 *
 * Verifies that:
 *  - GET /api/tenant/follow-ups requires tasks.view
 *  - POST /api/tenant/follow-ups requires tasks.create
 *  - PATCH /api/tenant/follow-ups/[id] requires tasks.edit
 *  - DELETE /api/tenant/follow-ups/[id] requires tasks.delete
 *  - POST /api/tenant/email-templates requires settings.manage
 *  - PATCH /api/tenant/email-templates/[id] requires settings.manage
 *  - DELETE /api/tenant/email-templates/[id] requires settings.manage
 *  - POST /api/tenant/sms/templates requires settings.manage
 *  - PUT /api/tenant/sms/templates requires settings.manage
 *  - DELETE /api/tenant/sms/templates requires settings.manage
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
    offset: () => Chainable;
    returning: () => Promise<unknown[]>;
    then: (resolve: (v: unknown) => void) => void;
  }

  const mockRow = {
    id: 'row-1',
    tenantId: 'tenant-test-1',
    userId: 'user-test-1',
    title: 'Test Follow-Up',
    name: 'Test Template',
    subject: 'Subject',
    body: 'Body text',
    bodyHtml: '<p>Body</p>',
    category: 'general',
    dueDate: new Date(),
    status: 'pending',
    updatedAt: new Date(),
    createdAt: new Date(),
    isActive: true,
  };

  const makeChain = (res: unknown = [mockRow]): Chainable => ({
    from: () => makeChain(res),
    leftJoin: () => makeChain(res),
    where: () => makeChain(res),
    orderBy: () => makeChain(res),
    limit: () => makeChain(res),
    offset: () => makeChain(res),
    returning: async () => (Array.isArray(res) ? res : [res]),
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
      emailTemplates: {
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

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
  updatedAtMs: vi.fn(() => ({}) as never),
}));

vi.mock('@/lib/sms', () => ({
  extractTemplateVariables: vi.fn(() => []),
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));

import { GET as getFollowUps, POST as postFollowUp } from '@/app/api/tenant/follow-ups/route';
import { PATCH as patchFollowUp, DELETE as deleteFollowUp } from '@/app/api/tenant/follow-ups/[id]/route';
import { POST as postEmailTemplate } from '@/app/api/tenant/email-templates/route';
import { PATCH as patchEmailTemplate, DELETE as deleteEmailTemplate } from '@/app/api/tenant/email-templates/[id]/route';
import { POST as postSmsTemplate, PUT as putSmsTemplate, DELETE as deleteSmsTemplate } from '@/app/api/tenant/sms/templates/route';

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

describe('#3402 (PR-2E) - Follow-Ups and Templates Permission Gates', () => {
  beforeEach(() => {
    mockAuthCtx.tenantId = 'tenant-test-1';
    mockAuthCtx.userId = 'user-test-1';
    mockAuthCtx.isAdmin = false;
    mockAuthCtx.isSuperAdmin = false;
    mockAuthCtx.permissions = {};
    vi.clearAllMocks();
  });

  describe('Follow-Ups Routes', () => {
    it('GET 403s without tasks.view', async () => {
      const res = await getFollowUps(makeRequest('GET', '/api/tenant/follow-ups'));
      expect(res.status).toBe(403);
    });

    it('GET 200s with tasks.view', async () => {
      mockAuthCtx.permissions = { 'tasks.view': true };
      const res = await getFollowUps(makeRequest('GET', '/api/tenant/follow-ups'));
      expect(res.status).toBe(200);
    });

    it('POST 403s without tasks.create', async () => {
      const req = makeRequest('POST', '/api/tenant/follow-ups', {
        title: 'Call prospect',
      });
      const res = await postFollowUp(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with tasks.create', async () => {
      mockAuthCtx.permissions = { 'tasks.create': true };
      const req = makeRequest('POST', '/api/tenant/follow-ups', {
        title: 'Call prospect',
      });
      const res = await postFollowUp(req);
      expect(res.status).toBe(201);
    });

    it('PATCH 403s without tasks.edit', async () => {
      const req = makeRequest('PATCH', '/api/tenant/follow-ups/fu-1', {
        title: 'Updated follow up',
      });
      const res = await patchFollowUp(req, { params: Promise.resolve({ id: 'fu-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with tasks.edit', async () => {
      mockAuthCtx.permissions = { 'tasks.edit': true };
      const req = makeRequest('PATCH', '/api/tenant/follow-ups/fu-1', {
        title: 'Updated follow up',
      });
      const res = await patchFollowUp(req, { params: Promise.resolve({ id: 'fu-1' }) });
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without tasks.delete', async () => {
      const req = makeRequest('DELETE', '/api/tenant/follow-ups/fu-1');
      const res = await deleteFollowUp(req, { params: Promise.resolve({ id: 'fu-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with tasks.delete', async () => {
      mockAuthCtx.permissions = { 'tasks.delete': true };
      const req = makeRequest('DELETE', '/api/tenant/follow-ups/fu-1');
      const res = await deleteFollowUp(req, { params: Promise.resolve({ id: 'fu-1' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('Email Templates Routes', () => {
    it('POST 403s without settings.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/email-templates', {
        name: 'Welcome',
        subject: 'Welcome to our platform',
        body: '<p>Welcome</p>',
      });
      const res = await postEmailTemplate(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('POST', '/api/tenant/email-templates', {
        name: 'Welcome',
        subject: 'Welcome to our platform',
        body: '<p>Welcome</p>',
      });
      const res = await postEmailTemplate(req);
      expect(res.status).toBe(201);
    });

    it('PATCH 403s without settings.manage', async () => {
      const req = makeRequest('PATCH', '/api/tenant/email-templates/tmpl-1', {
        name: 'Updated Welcome',
      });
      const res = await patchEmailTemplate(req, { params: Promise.resolve({ id: 'tmpl-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('PATCH', '/api/tenant/email-templates/tmpl-1', {
        name: 'Updated Welcome',
      });
      const res = await patchEmailTemplate(req, { params: Promise.resolve({ id: 'tmpl-1' }) });
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without settings.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/email-templates/tmpl-1');
      const res = await deleteEmailTemplate(req, { params: Promise.resolve({ id: 'tmpl-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/email-templates/tmpl-1');
      const res = await deleteEmailTemplate(req, { params: Promise.resolve({ id: 'tmpl-1' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('SMS Templates Routes', () => {
    it('POST 403s without settings.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/sms/templates', {
        name: 'SMS Promo',
        body: 'Special offer today!',
      });
      const res = await postSmsTemplate(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('POST', '/api/tenant/sms/templates', {
        name: 'SMS Promo',
        body: 'Special offer today!',
      });
      const res = await postSmsTemplate(req);
      expect(res.status).toBe(201);
    });

    it('PUT 403s without settings.manage', async () => {
      const req = makeRequest('PUT', '/api/tenant/sms/templates', {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Updated SMS Promo',
      });
      const res = await putSmsTemplate(req);
      expect(res.status).toBe(403);
    });

    it('PUT 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('PUT', '/api/tenant/sms/templates', {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Updated SMS Promo',
      });
      const res = await putSmsTemplate(req);
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without settings.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/sms/templates?id=11111111-1111-4111-8111-111111111111');
      const res = await deleteSmsTemplate(req);
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with settings.manage', async () => {
      mockAuthCtx.permissions = { 'settings.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/sms/templates?id=11111111-1111-4111-8111-111111111111');
      const res = await deleteSmsTemplate(req);
      expect(res.status).toBe(200);
    });
  });
});
