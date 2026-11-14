/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E Batch 2) — Contracts & Subscriptions mutating permission gates.
 *
 * Verifies that the catalog ids `contracts.create` and `subscriptions.manage`
 * (and their view twins `contracts.view`, `subscriptions.view`) are strictly enforced on:
 *   - POST /api/tenant/contracts (requires contracts.create)
 *   - GET  /api/tenant/contracts (requires contracts.view)
 *   - POST /api/tenant/subscriptions (requires subscriptions.manage)
 *   - GET  /api/tenant/subscriptions (requires subscriptions.view)
 *
 * An unprivileged tenant member without the required permission gets 403 and
 * the handler executes no business logic or writes.
 * Users with the explicit grant, admins, and superadmins pass the permission gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as getContracts, POST as postContract } from '@/app/api/tenant/contracts/route';
import { GET as getSubscriptions, POST as postSubscription } from '@/app/api/tenant/subscriptions/route';

interface AuthCtx {
  tenantId: string;
  userId: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  permissions?: Record<string, boolean>;
}

let mockAuthCtx: AuthCtx = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  isAdmin: false,
  isSuperAdmin: false,
  permissions: {},
};

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(h: T) => h,
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: vi.fn(() => ({})),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: vi.fn(async () => mockAuthCtx),
    requireCsrf: vi.fn(() => null),
    requirePerm: (ctx: AuthCtx, perm: string) => {
      if (ctx.isSuperAdmin || ctx.isAdmin || ctx.permissions?.['all'] === true || ctx.permissions?.[perm] === true) {
        return null;
      }
      return NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 });
    },
  };
});

interface FakeChain {
  from(): FakeChain;
  where(): FakeChain;
  orderBy(): FakeChain;
  limit(): FakeChain;
  offset(): FakeChain;
  returning(): FakeChain;
  then(resolve: (v: unknown) => void): void;
}

const chainable = (result: unknown): FakeChain => ({
  from: () => chainable(result),
  where: () => chainable(result),
  orderBy: () => chainable(result),
  limit: () => chainable(result),
  offset: () => chainable(result),
  returning: () => chainable(result),
  then: (resolve: (v: unknown) => void) => resolve(result),
});

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => chainable([{ count: 0, id: 'item-1' }]),
    insert: () => ({
      values: () => chainable([{ id: 'item-1', title: 'Contract 1' }]),
    }),
    update: () => ({
      set: () => chainable([{ id: 'item-1' }]),
    }),
  },
}));

function makeRequest(path: string, options: { method?: string; body?: unknown } = {}): NextRequest {
  const { method = 'GET', body } = options;
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:3000${path}`, init) as unknown as NextRequest;
}

describe('PR-2E (#3402 Batch 2) — contracts & subscriptions permission gates', () => {
  beforeEach(() => {
    mockAuthCtx = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      isAdmin: false,
      isSuperAdmin: false,
      permissions: {},
    };
  });

  describe('POST /api/tenant/contracts (contracts.create)', () => {
    const validBody = {
      title: 'Enterprise SLA',
      start_date: '2026-11-13',
      type: 'service',
    };

    it('returns 403 when user lacks contracts.create', async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest('/api/tenant/contracts', { method: 'POST', body: validBody });
      const res = await postContract(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('contracts.create required');
    });

    it('permits user with explicit contracts.create grant', async () => {
      mockAuthCtx.permissions = { 'contracts.create': true };
      const req = makeRequest('/api/tenant/contracts', { method: 'POST', body: validBody });
      const res = await postContract(req);
      expect(res.status).not.toBe(403);
    });

    it('permits admin user', async () => {
      mockAuthCtx.isAdmin = true;
      const req = makeRequest('/api/tenant/contracts', { method: 'POST', body: validBody });
      const res = await postContract(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /api/tenant/contracts (contracts.view)', () => {
    it('returns 403 when user lacks contracts.view', async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest('/api/tenant/contracts?limit=10&page=1');
      const res = await getContracts(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('contracts.view required');
    });

    it('permits user with explicit contracts.view grant', async () => {
      mockAuthCtx.permissions = { 'contracts.view': true };
      const req = makeRequest('/api/tenant/contracts?limit=10&page=1');
      const res = await getContracts(req);
      expect(res.status).toBe(200);
    });

    it('permits admin user', async () => {
      mockAuthCtx.isAdmin = true;
      const req = makeRequest('/api/tenant/contracts?limit=10&page=1');
      const res = await getContracts(req);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tenant/subscriptions (subscriptions.manage)', () => {
    const validBody = {
      name: 'Monthly Plan',
      start_date: '2026-11-13',
      billing_frequency: 'monthly',
      amount: 49.99,
    };

    it('returns 403 when user lacks subscriptions.manage', async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest('/api/tenant/subscriptions', { method: 'POST', body: validBody });
      const res = await postSubscription(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('subscriptions.manage required');
    });

    it('permits user with explicit subscriptions.manage grant', async () => {
      mockAuthCtx.permissions = { 'subscriptions.manage': true };
      const req = makeRequest('/api/tenant/subscriptions', { method: 'POST', body: validBody });
      const res = await postSubscription(req);
      expect(res.status).not.toBe(403);
    });

    it('permits admin user', async () => {
      mockAuthCtx.isAdmin = true;
      const req = makeRequest('/api/tenant/subscriptions', { method: 'POST', body: validBody });
      const res = await postSubscription(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /api/tenant/subscriptions (subscriptions.view)', () => {
    it('returns 403 when user lacks subscriptions.view', async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest('/api/tenant/subscriptions?limit=10&page=1');
      const res = await getSubscriptions(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('subscriptions.view required');
    });

    it('permits user with explicit subscriptions.view grant', async () => {
      mockAuthCtx.permissions = { 'subscriptions.view': true };
      const req = makeRequest('/api/tenant/subscriptions?limit=10&page=1');
      const res = await getSubscriptions(req);
      expect(res.status).toBe(200);
    });

    it('permits superAdmin user', async () => {
      mockAuthCtx.isSuperAdmin = true;
      const req = makeRequest('/api/tenant/subscriptions?limit=10&page=1');
      const res = await getSubscriptions(req);
      expect(res.status).toBe(200);
    });
  });
});
