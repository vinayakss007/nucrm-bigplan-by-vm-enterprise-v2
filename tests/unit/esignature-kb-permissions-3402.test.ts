/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Mutating tenant routes permission gates:
 * E-Signature and Knowledge Base (articles & categories).
 *
 * Verifies that:
 *  - GET /api/tenant/esignature requires contracts.view
 *  - POST /api/tenant/esignature requires contracts.sign
 *  - GET /api/tenant/kb/articles requires tickets.view
 *  - POST /api/tenant/kb/articles requires tickets.manage
 *  - GET /api/tenant/kb/articles/[id] requires tickets.view
 *  - PATCH /api/tenant/kb/articles/[id] requires tickets.manage
 *  - DELETE /api/tenant/kb/articles/[id] requires tickets.manage
 *  - POST /api/tenant/kb/articles/[id] (helpful vote) requires tickets.view
 *  - GET /api/tenant/kb/categories requires tickets.view
 *  - POST /api/tenant/kb/categories requires tickets.manage
 *  - PATCH /api/tenant/kb/categories/[id] requires tickets.manage
 *  - DELETE /api/tenant/kb/categories/[id] requires tickets.manage
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

  const mockArticle = {
    id: 'art-1',
    tenantId: 'tenant-test-1',
    userId: 'user-test-1',
    categoryId: 'cat-1',
    title: 'Test Article',
    slug: 'test-article',
    content: 'Article content',
    excerpt: 'Excerpt',
    status: 'published',
    views: 10,
    helpful: 5,
    notHelpful: 1,
    tags: ['tag1'],
    publishedAt: new Date(),
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  const mockCategory = {
    id: 'cat-1',
    tenantId: 'tenant-test-1',
    userId: 'user-test-1',
    name: 'General',
    slug: 'general',
    description: 'General category',
    icon: 'folder',
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const makeChain = (res: unknown = [mockArticle]): Chainable => ({
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
    select: vi.fn(() => makeChain([mockArticle])),
    insert: vi.fn(() => ({
      values: () => makeChain([mockArticle]),
    })),
    update: vi.fn(() => ({
      set: () => makeChain([mockArticle]),
    })),
    delete: vi.fn(() => ({
      where: () => makeChain([mockArticle]),
    })),
  };

  return { mockAuthCtx: authCtx, mockDb: dbObj, mockArticle, mockCategory };
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
}));

vi.mock('@/lib/esignature', () => ({
  createSigningRequest: vi.fn(async (args: { documentId: string; signers: Array<{ name: string; email: string }> }) => ({
    id: 'sign-req-1',
    documentId: args.documentId,
    provider: 'internal',
    status: 'pending',
    signers: args.signers.map((s) => ({ ...s, token: 'tok-abc-123' })),
    createdAt: new Date(),
  })),
}));

vi.mock('@/drizzle/db', () => ({ db: mockDb }));

import { GET as getEsignature, POST as postEsignature } from '@/app/api/tenant/esignature/route';
import { GET as getKbArticles, POST as postKbArticle } from '@/app/api/tenant/kb/articles/route';
import {
  GET as getKbArticle,
  PATCH as patchKbArticle,
  DELETE as deleteKbArticle,
  POST as postKbArticleFeedback,
} from '@/app/api/tenant/kb/articles/[id]/route';
import { GET as getKbCategories, POST as postKbCategory } from '@/app/api/tenant/kb/categories/route';
import {
  PATCH as patchKbCategory,
  DELETE as deleteKbCategory,
} from '@/app/api/tenant/kb/categories/[id]/route';

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

describe('#3402 (PR-2E) E-Signature & KB Permission Gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthCtx.tenantId = 'tenant-test-1';
    mockAuthCtx.userId = 'user-test-1';
    mockAuthCtx.isAdmin = false;
    mockAuthCtx.isSuperAdmin = false;
    mockAuthCtx.permissions = {};
  });

  describe('E-Signature Routes', () => {
    it('GET 403s without contracts.view', async () => {
      const req = makeRequest('GET', '/api/tenant/esignature');
      const res = await getEsignature(req);
      expect(res.status).toBe(403);
    });

    it('GET 200s with contracts.view', async () => {
      mockAuthCtx.permissions = { 'contracts.view': true };
      const req = makeRequest('GET', '/api/tenant/esignature');
      const res = await getEsignature(req);
      expect(res.status).toBe(200);
    });

    it('POST 403s without contracts.sign', async () => {
      const req = makeRequest('POST', '/api/tenant/esignature', {
        documentId: 'doc-123',
        signers: [{ name: 'Alice', email: 'alice@example.com' }],
        provider: 'internal',
      });
      const res = await postEsignature(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with contracts.sign', async () => {
      mockAuthCtx.permissions = { 'contracts.sign': true };
      const req = makeRequest('POST', '/api/tenant/esignature', {
        documentId: 'doc-123',
        signers: [{ name: 'Alice', email: 'alice@example.com' }],
        provider: 'internal',
      });
      const res = await postEsignature(req);
      expect(res.status).toBe(201);
    });
  });

  describe('KB Articles Routes', () => {
    it('GET 403s without tickets.view', async () => {
      const req = makeRequest('GET', '/api/tenant/kb/articles');
      const res = await getKbArticles(req);
      expect(res.status).toBe(403);
    });

    it('GET 200s with tickets.view', async () => {
      mockAuthCtx.permissions = { 'tickets.view': true };
      const req = makeRequest('GET', '/api/tenant/kb/articles');
      const res = await getKbArticles(req);
      expect(res.status).toBe(200);
    });

    it('POST 403s without tickets.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/kb/articles', {
        title: 'New Knowledge Article',
        content: 'Comprehensive guides for troubleshooting.',
      });
      const res = await postKbArticle(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('POST', '/api/tenant/kb/articles', {
        title: 'New Knowledge Article',
        content: 'Comprehensive guides for troubleshooting.',
      });
      const res = await postKbArticle(req);
      expect(res.status).toBe(201);
    });
  });

  describe('KB Article Item Routes', () => {
    it('GET 403s without tickets.view', async () => {
      const req = makeRequest('GET', '/api/tenant/kb/articles/art-1');
      const res = await getKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(403);
    });

    it('GET 200s with tickets.view', async () => {
      mockAuthCtx.permissions = { 'tickets.view': true };
      const req = makeRequest('GET', '/api/tenant/kb/articles/art-1');
      const res = await getKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(200);
    });

    it('PATCH 403s without tickets.manage', async () => {
      const req = makeRequest('PATCH', '/api/tenant/kb/articles/art-1', {
        title: 'Updated Article Title',
      });
      const res = await patchKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('PATCH', '/api/tenant/kb/articles/art-1', {
        title: 'Updated Article Title',
      });
      const res = await patchKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without tickets.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/kb/articles/art-1');
      const res = await deleteKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/kb/articles/art-1');
      const res = await deleteKbArticle(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(200);
    });

    it('POST (helpful feedback) 403s without tickets.view', async () => {
      const req = makeRequest('POST', '/api/tenant/kb/articles/art-1', { action: 'helpful' });
      const res = await postKbArticleFeedback(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(403);
    });

    it('POST (helpful feedback) 200s with tickets.view', async () => {
      mockAuthCtx.permissions = { 'tickets.view': true };
      const req = makeRequest('POST', '/api/tenant/kb/articles/art-1', { action: 'helpful' });
      const res = await postKbArticleFeedback(req, { params: Promise.resolve({ id: 'art-1' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('KB Categories Routes', () => {
    it('GET 403s without tickets.view', async () => {
      const req = makeRequest('GET', '/api/tenant/kb/categories');
      const res = await getKbCategories(req);
      expect(res.status).toBe(403);
    });

    it('GET 200s with tickets.view', async () => {
      mockAuthCtx.permissions = { 'tickets.view': true };
      const req = makeRequest('GET', '/api/tenant/kb/categories');
      const res = await getKbCategories(req);
      expect(res.status).toBe(200);
    });

    it('POST 403s without tickets.manage', async () => {
      const req = makeRequest('POST', '/api/tenant/kb/categories', {
        name: 'Technical FAQs',
        slug: 'technical-faqs',
      });
      const res = await postKbCategory(req);
      expect(res.status).toBe(403);
    });

    it('POST 201s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('POST', '/api/tenant/kb/categories', {
        name: 'Technical FAQs',
        slug: 'technical-faqs',
      });
      const res = await postKbCategory(req);
      expect(res.status).toBe(201);
    });
  });

  describe('KB Category Item Routes', () => {
    it('PATCH 403s without tickets.manage', async () => {
      const req = makeRequest('PATCH', '/api/tenant/kb/categories/cat-1', {
        name: 'Renamed FAQs',
      });
      const res = await patchKbCategory(req, { params: Promise.resolve({ id: 'cat-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH 200s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('PATCH', '/api/tenant/kb/categories/cat-1', {
        name: 'Renamed FAQs',
      });
      const res = await patchKbCategory(req, { params: Promise.resolve({ id: 'cat-1' }) });
      expect(res.status).toBe(200);
    });

    it('DELETE 403s without tickets.manage', async () => {
      const req = makeRequest('DELETE', '/api/tenant/kb/categories/cat-1');
      const res = await deleteKbCategory(req, { params: Promise.resolve({ id: 'cat-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE 200s with tickets.manage', async () => {
      mockAuthCtx.permissions = { 'tickets.manage': true };
      const req = makeRequest('DELETE', '/api/tenant/kb/categories/cat-1');
      const res = await deleteKbCategory(req, { params: Promise.resolve({ id: 'cat-1' }) });
      expect(res.status).toBe(200);
    });
  });
});
