/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3402 PR-2E: Quotes & Offers mutating/view route permission gates.
 *
 * Verifies that:
 * - GET /api/tenant/quotes enforces 'quotes.view'
 * - POST /api/tenant/quotes enforces 'quotes.manage'
 * - GET /api/tenant/offers enforces 'quotes.view'
 * - POST /api/tenant/offers/[quoteId]/send enforces 'quotes.manage'
 * - POST /api/tenant/offers/[quoteId]/cancel enforces 'quotes.manage'
 * - GET /api/tenant/quotes/[id]/pdf enforces 'quotes.view'
 *
 * Usage: npx vitest run tests/unit/quotes-offers-permissions-3402.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUOTE_ID = 'qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqq';

let currentCtx: AuthContext | null = null;

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  query: {
    quotes: {
      findFirst: vi.fn(),
    },
  },
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => currentCtx ?? NextResponse.json({ error: 'unauthorized' }, { status: 401 })),
    requireModule: vi.fn(async () => null),
  };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
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

describe('Quotes & Offers permission gating (#3402)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockImplementation(() => makeBuilder([]));
    mockDb.query.quotes.findFirst.mockResolvedValue(null);
  });

  describe('GET /api/tenant/quotes', () => {
    it('rejects with 403 when session lacks quotes.view', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { GET } = await import('@/app/api/tenant/quotes/route');
      const req = new NextRequest(new URL('/api/tenant/quotes', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('allows access when session has quotes.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/quotes/route');
      const req = new NextRequest(new URL('/api/tenant/quotes', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });

    it('allows access for admin role', async () => {
      currentCtx = session({}, 'admin');
      const { GET } = await import('@/app/api/tenant/quotes/route');
      const req = new NextRequest(new URL('/api/tenant/quotes', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/quotes', () => {
    it('rejects with 403 when session lacks quotes.manage', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { POST } = await import('@/app/api/tenant/quotes/route');
      const req = new NextRequest(new URL('/api/tenant/quotes', 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New Quote' }),
      });
      const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('passes permission gate when session has quotes.manage', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { POST } = await import('@/app/api/tenant/quotes/route');
      const req = new NextRequest(new URL('/api/tenant/quotes', 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}), // Empty body fails validation (400), proving it passed 403 gate
      });
      const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /api/tenant/offers', () => {
    it('rejects with 403 when session lacks quotes.view', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { GET } = await import('@/app/api/tenant/offers/route');
      const req = new NextRequest(new URL('/api/tenant/offers', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('allows access when session has quotes.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/offers/route');
      const req = new NextRequest(new URL('/api/tenant/offers', 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest) => Promise<NextResponse>)(req);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/offers/[quoteId]/send', () => {
    it('rejects with 403 when session lacks quotes.manage', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { POST } = await import('@/app/api/tenant/offers/[quoteId]/send/route');
      const req = new NextRequest(new URL(`/api/tenant/offers/${QUOTE_ID}/send`, 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await (POST as (r: NextRequest, ctx: { params: Promise<{ quoteId: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ quoteId: QUOTE_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('passes permission gate when session has quotes.manage', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { POST } = await import('@/app/api/tenant/offers/[quoteId]/send/route');
      const req = new NextRequest(new URL(`/api/tenant/offers/${QUOTE_ID}/send`, 'http://localhost:3000'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await (POST as (r: NextRequest, ctx: { params: Promise<{ quoteId: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ quoteId: QUOTE_ID }) }
      );
      // Because mockDb returns null for findFirst, it 404s after passing the 403 gate
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/tenant/offers/[quoteId]/cancel', () => {
    it('rejects with 403 when session lacks quotes.manage', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { POST } = await import('@/app/api/tenant/offers/[quoteId]/cancel/route');
      const req = new NextRequest(new URL(`/api/tenant/offers/${QUOTE_ID}/cancel`, 'http://localhost:3000'), {
        method: 'POST',
      });
      const res = await (POST as (r: NextRequest, ctx: { params: Promise<{ quoteId: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ quoteId: QUOTE_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('passes permission gate when session has quotes.manage', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { POST } = await import('@/app/api/tenant/offers/[quoteId]/cancel/route');
      const req = new NextRequest(new URL(`/api/tenant/offers/${QUOTE_ID}/cancel`, 'http://localhost:3000'), {
        method: 'POST',
      });
      const res = await (POST as (r: NextRequest, ctx: { params: Promise<{ quoteId: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ quoteId: QUOTE_ID }) }
      );
      // Because mockDb returns null for findFirst, it 404s after passing the 403 gate
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/tenant/quotes/[id]/pdf', () => {
    it('rejects with 403 when session lacks quotes.view', async () => {
      currentCtx = session({ 'quotes.manage': true });
      const { GET } = await import('@/app/api/tenant/quotes/[id]/pdf/route');
      const req = new NextRequest(new URL(`/api/tenant/quotes/${QUOTE_ID}/pdf`, 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: QUOTE_ID }) }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Permission denied/i);
    });

    it('passes permission gate when session has quotes.view', async () => {
      currentCtx = session({ 'quotes.view': true });
      const { GET } = await import('@/app/api/tenant/quotes/[id]/pdf/route');
      const req = new NextRequest(new URL(`/api/tenant/quotes/${QUOTE_ID}/pdf`, 'http://localhost:3000'));
      const res = await (GET as (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>)(
        req,
        { params: Promise.resolve({ id: QUOTE_ID }) }
      );
      // Because mockDb returns empty array, it 404s after passing the 403 gate
      expect(res.status).toBe(404);
    });
  });
});
