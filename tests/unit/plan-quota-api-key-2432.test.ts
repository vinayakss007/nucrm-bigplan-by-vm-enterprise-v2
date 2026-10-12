/* eslint-disable @typescript-eslint/no-explicit-any */
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2432 — `plans.max_api_calls_day` is sold and editable but nothing ever read
 * it. The fix puts the cap on the one chokepoint that sees every API-key
 * request: the `ak_` branch of requireAuth().
 *
 * These tests pin that branch's behaviour:
 *   1. over quota  -> the 402 comes back out of requireAuth and the request
 *                     context is never populated;
 *   2. under quota -> the key still authenticates normally;
 *   3. measurement throws -> the request is ALLOWED (fail open: this is a
 *                     billing control, not an access control) and logged;
 *   4. the check runs AFTER setTenantContext, because the `api_key_usage`
 *                     count it issues is only RLS-visible under that GUC;
 *   5. the JWT path is untouched — cookie-authenticated UI traffic does not
 *                     gain a per-request plan read.
 *
 * checkLimit itself is stubbed: its measurement side is covered by
 * tests/unit/plan-quota-measurement-2432.test.ts and its 402/record-violation
 * branch by tests/unit/usage-middleware.test.ts. Mock scaffolding follows
 * tests/unit/apikey-tenant-scoping-2215.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const m = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const chain: any = {};
  for (const method of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onOk: any, onErr: any) =>
    Promise.resolve(selectResults.length > 0 ? selectResults.shift() : []).then(onOk, onErr);
  chain.query = {
    sessions: { findFirst: vi.fn() },
    users: { findFirst: vi.fn() },
    tenants: { findFirst: vi.fn() },
  };

  return {
    db: chain,
    selectResults,
    // Shared log of the auth-layer side effects, in execution order.
    calls: [] as string[],
    cookieToken: { current: null as string | null },
    verifyToken: vi.fn(),
    hashToken: vi.fn(),
    setTenantContext: vi.fn(),
    setSuperAdminContext: vi.fn(),
    tryApiKeyAuth: vi.fn(),
    checkLimit: vi.fn(),
    logError: vi.fn(),
    loggerWarn: vi.fn(),
    rc: {
      generateId: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      getCached: vi.fn(),
      cache: vi.fn(),
      invalidate: vi.fn(),
    },
    hasModule: vi.fn(),
    hasFeature: vi.fn(),
  };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));

vi.mock('@/drizzle/schema', () => ({
  tenants: { id: 'tenants.id', slug: 'tenants.slug', name: 'tenants.name' },
  users: { id: 'users.id', email: 'users.email', fullName: 'users.full_name' },
  sessions: { tokenHash: 'sessions.token_hash', expiresAt: 'sessions.expires_at' },
  tenantMembers: { tenantId: 'tenant_members.tenant_id', userId: 'tenant_members.user_id' },
  roles: { id: 'roles.id', permissions: 'roles.permissions' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  gt: vi.fn((a: unknown, b: unknown) => ({ op: 'gt', a, b })),
  or: vi.fn((...parts: unknown[]) => ({ op: 'or', parts })),
  desc: vi.fn((a: unknown) => ({ op: 'desc', a })),
  asc: vi.fn((a: unknown) => ({ op: 'asc', a })),
  count: vi.fn((a: unknown) => ({ op: 'count', a })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    text: Array.from(strings).join('?'),
    values,
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'nucrm_session' && m.cookieToken.current ? { value: m.cookieToken.current } : undefined,
  })),
}));

vi.mock('@/lib/auth/session', () => ({ verifyToken: m.verifyToken, hashToken: m.hashToken }));

vi.mock('@/lib/db/rls', () => ({
  setTenantContext: m.setTenantContext,
  setSuperAdminContext: m.setSuperAdminContext,
  withUserContext: async (_userId: string, fn: (tx: unknown) => unknown) => fn(m.db),
  withAuthLookupContext: async (fn: (tx: unknown) => unknown) => fn(m.db),
  NO_TENANT_SENTINEL: '00000000-0000-0000-0000-000000000000',
}));

vi.mock('@/lib/errors-server', () => ({ logError: m.logError }));

// The whole point of this file is the call site, so the key resolution and the
// quota decision are both controlled here.
vi.mock('@/lib/auth/api-key', () => ({ tryApiKeyAuth: m.tryApiKeyAuth }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: m.checkLimit }));
vi.mock('@/lib/logger', () => ({ logger: { warn: m.loggerWarn, error: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/tenant/request-context', () => ({
  requestContext: m.rc,
  withRequestId: <T>(_requestId: string, fn: () => T): T => fn(),
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/lib/modules/registry', () => ({
  ModuleRegistry: { hasModule: m.hasModule, hasFeature: m.hasFeature },
}));

import { requireAuth, type AuthContext } from '@/lib/auth/middleware';

function apiKeyCtx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'key-owner',
    tenantId: 'tenant-A',
    roleSlug: 'api',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    authMethod: 'api_key',
    ...over,
  };
}

function makeKeyRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/leads', {
    method: 'GET',
    headers: new Headers({ authorization: 'Bearer ak_live_deadbeef' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.selectResults.length = 0;
  m.calls.length = 0;
  m.cookieToken.current = null;
  m.tryApiKeyAuth.mockReset().mockResolvedValue(apiKeyCtx());
  m.checkLimit.mockReset().mockResolvedValue(null);
  m.verifyToken.mockResolvedValue({ userId: 'user-1' });
  m.hashToken.mockResolvedValue('jwt-hash');
  m.rc.generateId.mockReturnValue('req-generated');
  m.rc.getCached.mockResolvedValue(null);
  m.db.query.sessions.findFirst.mockResolvedValue(undefined);

  // Order-sensitive side effects, recorded as they happen.
  m.setTenantContext.mockImplementation(async () => {
    m.calls.push('setTenantContext');
  });
  m.checkLimit.mockImplementation(async () => {
    m.calls.push('checkLimit');
    return null;
  });
  m.rc.set.mockImplementation(() => {
    m.calls.push('requestContext.set');
  });
});

describe('requireAuth — apiCallsDay enforcement on the ak_ branch (#2432)', () => {
  it('returns the 402 from checkLimit and never populates the request context', async () => {
    const denied = NextResponse.json(
      { error: 'Plan limit reached for apiCallsDay', kind: 'apiCallsDay', limit: 1000, actual: 1000, upgradeUrl: '/tenant/settings/billing' },
      { status: 402 }
    );
    m.checkLimit.mockImplementation(async () => {
      m.calls.push('checkLimit');
      return denied;
    });

    const result = await requireAuth(makeKeyRequest());

    expect(result).toBe(denied);
    expect((result as NextResponse).status).toBe(402);
    const body = (await (result as Response).json()) as { upgradeUrl: string; kind: string };
    expect(body.kind).toBe('apiCallsDay');
    expect(body.upgradeUrl).toBe('/tenant/settings/billing');
    expect(m.rc.set).not.toHaveBeenCalled();
  });

  it('lets an under-quota key through, asking for exactly the apiCallsDay kind', async () => {
    const result = await requireAuth(makeKeyRequest());

    expect(result).not.toBeInstanceOf(Response);
    expect((result as AuthContext).authMethod).toBe('api_key');
    expect(m.checkLimit).toHaveBeenCalledTimes(1);
    const [ctx, kind] = m.checkLimit.mock.calls[0] as [AuthContext, string];
    expect(kind).toBe('apiCallsDay');
    expect(ctx.tenantId).toBe('tenant-A');
  });

  it('runs the quota read AFTER setTenantContext, so the count is RLS-visible', async () => {
    await requireAuth(makeKeyRequest());

    expect(m.calls).toEqual(['setTenantContext', 'checkLimit', 'requestContext.set']);
  });

  it('fails OPEN when the measurement throws — a billing control must not become an outage', async () => {
    m.checkLimit.mockImplementation(async () => {
      m.calls.push('checkLimit');
      throw new Error('connection reset');
    });

    const result = await requireAuth(makeKeyRequest());

    expect(result).not.toBeInstanceOf(Response);
    expect((result as AuthContext).tenantId).toBe('tenant-A');
    // …and the swallow is loud enough to be found in the logs.
    expect(m.loggerWarn).toHaveBeenCalledTimes(1);
    const detail = m.loggerWarn.mock.calls[0] as [string, { error: string; tenantId: string }];
    expect(detail[1].error).toContain('connection reset');
    expect(detail[1].tenantId).toBe('tenant-A');
    expect(m.calls).toContain('requestContext.set');
  });

  it('does not add a plan read to the JWT path', async () => {
    m.tryApiKeyAuth.mockResolvedValue(null);
    m.rc.getCached.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-A',
      roleSlug: 'member',
      permissions: { 'leads.view': true },
      isAdmin: false,
      isSuperAdmin: false,
      cachedAt: Date.now(),
    });
    m.selectResults.push([{ count: 1 }], [{ status: 'active', roleSlug: 'member', roleId: null }]);

    const result = await requireAuth(
      new NextRequest('http://localhost:3000/api/v1/leads', {
        method: 'GET',
        headers: new Headers({ authorization: 'Bearer some.jwt.token' }),
      })
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(m.checkLimit).not.toHaveBeenCalled();
  });

  it('keeps the #2215 cross-tenant reject ahead of the quota check', async () => {
    const result = await requireAuth(
      new NextRequest('http://localhost:3000/api/v1/leads', {
        method: 'GET',
        headers: new Headers({ authorization: 'Bearer ak_live_deadbeef', 'x-tenant-id': 'tenant-B' }),
      })
    );

    expect((result as Response).status).toBe(403);
    expect(m.checkLimit).not.toHaveBeenCalled();
  });
});
