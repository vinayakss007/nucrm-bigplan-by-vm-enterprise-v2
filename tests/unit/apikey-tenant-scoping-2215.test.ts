/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2215 — `ak_` API keys bypassed tenant/permission scoping on the v1 surface.
 *
 * Covers the two shipped guards (the third — gating the edge `ak_` pass-through
 * in proxy.ts — is exercised by the edge test file; the edge cannot do DB
 * lookups so its unit surface is the path predicate):
 *  1. requireAuth() rejects an X-Tenant-ID header that does not match the
 *     tenant bound to the key: cross-tenant override attempt -> 403, and the
 *     key's own tenant still works.
 *  2. requireApiKeyScope() denies a key that lacks the required scope and
 *     leaves JWT consumers completely untouched.
 *  3. End-to-end on GET /api/v1/leads: scopeless key -> 403 before any DB
 *     query; leads:read key -> 200; JWT session -> 200 (no regression).
 *
 * Mock scaffolding follows tests/unit/auth-middleware-require-auth.test.ts and
 * the thenable drizzle-chain pattern from tests/unit/public-tickets.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  // FIFO queue of results for `db.select(...)` chains, in call order.
  const selectResults: unknown[][] = [];
  const shift = (): unknown[] => (selectResults.length > 0 ? (selectResults.shift() as unknown[]) : []);

  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  // .limit() stays chainable (the leads list query ends .limit().offset());
  // awaiting the chain itself resolves the next queued result.
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => Promise.resolve(shift()));
  chain.then = (onOk: any, onErr: any) => Promise.resolve(shift()).then(onOk, onErr);
  chain.query = {
    sessions: { findFirst: vi.fn() },
    users: { findFirst: vi.fn() },
    tenants: { findFirst: vi.fn() },
  };

  return {
    db: chain,
    selectResults,
    cookieToken: { current: null as string | null },
    verifyToken: vi.fn(),
    hashToken: vi.fn(),
    setTenantContext: vi.fn(),
    setSuperAdminContext: vi.fn(),
    tryApiKeyAuth: vi.fn(),
    logError: vi.fn(),
    limitCheck: vi.fn(),
    rc: {
      generateId: vi.fn(),
      set: vi.fn(),
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
  users: {
    id: 'users.id',
    email: 'users.email',
    fullName: 'users.full_name',
    isSuperAdmin: 'users.is_super_admin',
    lastTenantId: 'users.last_tenant_id',
  },
  sessions: { tokenHash: 'sessions.token_hash', expiresAt: 'sessions.expires_at' },
  tenantMembers: {
    tenantId: 'tenant_members.tenant_id',
    userId: 'tenant_members.user_id',
    status: 'tenant_members.status',
    roleId: 'tenant_members.role_id',
    roleSlug: 'tenant_members.role_slug',
    createdAt: 'tenant_members.created_at',
  },
  roles: { id: 'roles.id', permissions: 'roles.permissions', updatedAt: 'roles.updated_at' },
  apiKeys: { id: 'api_keys.id', keyHash: 'api_keys.key_hash', tenantId: 'api_keys.tenant_id' },
  apiKeyUsage: { id: 'api_key_usage.id' },
  leads: { id: 'leads.id', tenantId: 'leads.tenant_id', deletedAt: 'leads.deleted_at' },
  contacts: { id: 'contacts.id' },
  companies: { id: 'companies.id' },
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

vi.mock('@/lib/auth/session', () => ({
  verifyToken: m.verifyToken,
  hashToken: m.hashToken,
}));

vi.mock('@/lib/db/rls', () => ({
  setTenantContext: m.setTenantContext,
  setSuperAdminContext: m.setSuperAdminContext,
  withUserContext: async (_userId: string, fn: (tx: unknown) => unknown) => fn(m.db),
  withAuthLookupContext: async (fn: (tx: unknown) => unknown) => fn(m.db),
  NO_TENANT_SENTINEL: '00000000-0000-0000-0000-000000000000',
}));

vi.mock('@/lib/errors-server', () => ({ logError: m.logError }));

// tryApiKeyAuth is stubbed so the auth-layer tests control the key's tenant
// directly; requireApiKeyScope/hasScope run for REAL — they are pure and the
// whole point of the scope-enforcement tests.
vi.mock('@/lib/auth/api-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/api-key')>();
  return { ...actual, tryApiKeyAuth: m.tryApiKeyAuth };
});

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

// Route-level imports (GET /api/v1/leads): the wrapper is a pass-through so the
// handler runs without a real pinned pool; rate limiters return "allowed".
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute:
    <C>(fn: (request: import('next/server').NextRequest, context: C) => unknown) =>
    (request: import('next/server').NextRequest, context: C) =>
      fn(request, context),
}));
vi.mock('@/lib/rate-limit', () => ({
  limiters: { contacts: { check: (...args: unknown[]) => m.limitCheck(...args) } },
}));
vi.mock('@/lib/formula/sync', () => ({ syncCalculatedFields: vi.fn() }));
vi.mock('@/lib/dev-logger', () => ({
  devLogger: { auth: vi.fn(), error: vi.fn(), request: vi.fn(), warn: vi.fn() },
}));

import { requireAuth, type AuthContext } from '@/lib/auth/middleware';
import { requireApiKeyScope } from '@/lib/auth/api-key';

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

function makeRequest(headers: Record<string, string> = {}, path = '/api/v1/leads'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'GET',
    headers: new Headers(headers),
  });
}

function queueSelects(...results: unknown[][]): void {
  m.selectResults.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.selectResults.length = 0;
  m.cookieToken.current = null;
  m.tryApiKeyAuth.mockResolvedValue(null);
  m.verifyToken.mockResolvedValue({ userId: 'user-1' });
  m.hashToken.mockResolvedValue('jwt-hash');
  m.setTenantContext.mockResolvedValue(undefined);
  m.limitCheck.mockResolvedValue({ allowed: true, remaining: 10, reset: 0, limit: 10 });
  m.rc.generateId.mockReturnValue('req-generated');
  m.rc.getCached.mockResolvedValue(null);
  m.rc.cache.mockResolvedValue(undefined);
  m.rc.invalidate.mockResolvedValue(undefined);
  m.db.query.sessions.findFirst.mockResolvedValue(undefined);
});

describe('requireAuth — X-Tenant-ID guard on API-key requests (#2215)', () => {
  it('rejects with 403 when a cross-tenant X-Tenant-ID accompanies an ak_ key', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx());

    const result = await requireAuth(
      makeRequest({ authorization: 'Bearer ak_live_deadbeef', 'x-tenant-id': 'tenant-B' })
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    const body = (await (result as Response).json()) as { error: string };
    expect(body.error).toContain('does not match');
    // The override attempt must never reach the tenant GUC or the request ctx.
    expect(m.setTenantContext).not.toHaveBeenCalled();
    expect(m.rc.set).not.toHaveBeenCalled();
  });

  it('accepts the key when X-Tenant-ID equals the key tenant (no false positives)', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx());

    const result = await requireAuth(
      makeRequest({ authorization: 'Bearer ak_live_deadbeef', 'x-tenant-id': 'tenant-A' })
    );

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as AuthContext;
    expect(ctx.authMethod).toBe('api_key');
    expect(m.setTenantContext).toHaveBeenCalledWith('tenant-A', 'key-owner');
  });

  it('keeps the original behaviour when no X-Tenant-ID is sent', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx());

    const result = await requireAuth(makeRequest({ authorization: 'Bearer ak_live_deadbeef' }));

    expect(result).not.toBeInstanceOf(Response);
    expect((result as AuthContext).tenantId).toBe('tenant-A');
  });

  it('does not touch the JWT path (X-Tenant-ID stays a gateway concern there)', async () => {
    m.tryApiKeyAuth.mockResolvedValue(null);
    m.verifyToken.mockResolvedValue({ userId: 'user-1' });
    m.rc.getCached.mockResolvedValue({ ...apiKeyCtx({ authMethod: undefined, tenantId: 'tenant-A' }), cachedAt: Date.now() });
    queueSelects([{ count: 1 }], [{ status: 'active', roleSlug: 'api', roleId: null }]);

    const result = await requireAuth(
      makeRequest({ authorization: 'Bearer some.jwt.token', 'x-tenant-id': 'tenant-B' })
    );

    // JWT cache-hit path: no 403 from the API-key guard.
    expect(result).not.toBeInstanceOf(Response);
  });
});

describe('requireApiKeyScope (#2215)', () => {
  it('denies an API key that lacks the required scope', () => {
    const res = requireApiKeyScope(apiKeyCtx({ permissions: {} }), 'leads:read');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows a key carrying the exact scope, a resource wildcard, or all', () => {
    expect(requireApiKeyScope(apiKeyCtx({ permissions: { 'leads:read': true } }), 'leads:read')).toBeNull();
    expect(requireApiKeyScope(apiKeyCtx({ permissions: { 'leads:all': true } }), 'leads:write')).toBeNull();
    expect(requireApiKeyScope(apiKeyCtx({ permissions: { all: true } }), 'tasks:write')).toBeNull();
  });

  it('leaves JWT consumers completely untouched', () => {
    const jwtCtx = apiKeyCtx({ authMethod: 'jwt', permissions: {} });
    expect(requireApiKeyScope(jwtCtx, 'leads:read')).toBeNull();
    expect(requireApiKeyScope(jwtCtx, 'anything:at_all')).toBeNull();
  });
});

describe('GET /api/v1/leads — scope enforcement end to end (#2215)', () => {
  it('403s a scopeless ak_ key BEFORE running any query', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx({ permissions: {} }));

    const { GET } = await import('@/app/api/v1/leads/route');
    const res = await GET(makeRequest({ authorization: 'Bearer ak_live_deadbeef' }), undefined as never);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('API_KEY_SCOPE_DENIED');
    expect(m.db.select).not.toHaveBeenCalled();
  });

  it('403s a read-only ak_ key on the write scope check (POST)', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx({ permissions: { 'leads:read': true } }));

    const { POST } = await import('@/app/api/v1/leads/route');
    const req = new NextRequest('http://localhost:3000/api/v1/leads', {
      method: 'POST',
      headers: new Headers({
        authorization: 'Bearer ak_live_deadbeef',
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ first_name: 'A', last_name: 'B' }),
    });
    const res = await POST(req, undefined as never);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('API_KEY_SCOPE_DENIED');
    expect(m.db.select).not.toHaveBeenCalled();
  });

  it('lets a leads:read ak_ key through and returns the list', async () => {
    m.tryApiKeyAuth.mockResolvedValue(apiKeyCtx({ permissions: { 'leads:read': true } }));
    queueSelects([{ id: 'lead-1' }], [{ total: 1 }]);

    const { GET } = await import('@/app/api/v1/leads/route');
    const res = await GET(makeRequest({ authorization: 'Bearer ak_live_deadbeef' }), undefined as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('leaves JWT sessions on the role-based path (no scope check applied)', async () => {
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
    queueSelects([{ count: 1 }], [{ status: 'active', roleSlug: 'member', roleId: null }], [{ id: 'lead-2' }], [{ total: 1 }]);

    const { GET } = await import('@/app/api/v1/leads/route');
    const res = await GET(makeRequest({ authorization: 'Bearer some.jwt.token' }), undefined as never);

    expect(res.status).toBe(200);
  });
});
