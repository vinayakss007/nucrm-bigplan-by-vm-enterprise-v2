/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for the authentication / tenant-scoping entry point:
 *   requireAuth, requireCsrf, requireModule, requireFeature  (lib/auth/middleware.ts)
 *
 * This is a sibling file to tests/unit/auth-middleware.test.ts rather than an extension
 * of it, because that file's module mocks are incompatible with exercising requireAuth:
 *   - its `next/headers` mock hardcodes a `nucrm_session` cookie value, so the
 *     "no token present" branches can never be reached there;
 *   - its `@/lib/tenant/request-context` mock omits `withRequestId`, which requireAuth
 *     wraps its entire body in (the mocked module would throw on call).
 * That file keeps its coverage of the pure helpers `can` / `requirePerm`, which are
 * deliberately NOT duplicated here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
  chain.limit = vi.fn(() => Promise.resolve(shift()));
  // Awaiting the chain itself (e.g. `await db.select().from().where()`) resolves a result.
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
    tryApiKeyAuth: vi.fn(),
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
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  gt: vi.fn((a: unknown, b: unknown) => ({ op: 'gt', a, b })),
  or: vi.fn((...parts: unknown[]) => ({ op: 'or', parts })),
  desc: vi.fn((a: unknown) => ({ op: 'desc', a })),
  asc: vi.fn((a: unknown) => ({ op: 'asc', a })),
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

vi.mock('@/lib/db/rls', () => ({ setTenantContext: m.setTenantContext }));

vi.mock('@/lib/auth/api-key', () => ({ tryApiKeyAuth: m.tryApiKeyAuth }));

vi.mock('@/lib/tenant/request-context', () => ({
  requestContext: m.rc,
  withRequestId: <T>(_requestId: string, fn: () => T): T => fn(),
}));

// #1615: requireAuth now wraps its body in withPinnedConnection to pin one
// PoolClient for the auth + setTenantContext path. In these unit tests there is
// no real pool, so stub it to run the callback directly (no client acquired).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/lib/modules/registry', () => ({
  ModuleRegistry: { hasModule: m.hasModule, hasFeature: m.hasFeature },
}));

// NOTE: @/lib/auth/csrf is intentionally NOT mocked — it is pure and self-contained,
// so requireCsrf is exercised against the real token comparison logic.
import {
  requireAuth,
  requireCsrf,
  requireModule,
  requireFeature,
  type AuthContext,
} from '@/lib/auth/middleware';

const TOKEN = 'valid.jwt.token';
const TOKEN_HASH = 'hash-of-valid-token';

function makeRequest(
  init: { token?: string; method?: string; path?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return new NextRequest(`http://localhost:3000${init.path ?? '/api/contacts'}`, {
    method: init.method ?? 'GET',
    headers,
  });
}

function queueSelects(...results: unknown[][]): void {
  m.selectResults.push(...results);
}

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    fullName: 'Test User',
    isSuperAdmin: false,
    lastTenantId: 'tenant-1',
    ...over,
  };
}

function memberRow(over: Record<string, unknown> = {}) {
  return {
    ...userRow(),
    tenantId: 'tenant-1',
    roleSlug: 'member',
    permissions: { 'contacts.view': true },
    ...over,
  };
}

function cachedCtx(over: Partial<AuthContext> = {}) {
  return {
    userId: 'cached-user',
    tenantId: 'cached-tenant',
    roleSlug: 'member',
    permissions: { 'contacts.view': true },
    isAdmin: false,
    isSuperAdmin: false,
    cachedAt: Date.now(),
    ...over,
  };
}

/** Asserts the result is a rejection Response (not a context) and returns its JSON body. */
async function expectRejection(
  result: AuthContext | NextResponse,
  status: number,
): Promise<{ error?: string }> {
  expect(result).toBeInstanceOf(NextResponse);
  const res = result as NextResponse;
  expect(res.status).toBe(status);
  // A rejection must never look like a usable auth context.
  expect((result as unknown as AuthContext).userId).toBeUndefined();
  expect((result as unknown as AuthContext).tenantId).toBeUndefined();
  return (await res.json()) as { error?: string };
}

function isContext(result: AuthContext | NextResponse): result is AuthContext {
  return !(result instanceof NextResponse);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.selectResults.length = 0;
  m.cookieToken.current = null;
  m.tryApiKeyAuth.mockResolvedValue(null);
  m.verifyToken.mockResolvedValue({ userId: 'user-1' });
  m.hashToken.mockResolvedValue(TOKEN_HASH);
  m.setTenantContext.mockResolvedValue(undefined);
  m.rc.generateId.mockReturnValue('req-generated');
  m.rc.getCached.mockResolvedValue(null);
  m.rc.cache.mockResolvedValue(undefined);
  m.rc.invalidate.mockResolvedValue(undefined);
  m.db.query.sessions.findFirst.mockResolvedValue(undefined);
  m.db.query.users.findFirst.mockResolvedValue(undefined);
  m.db.query.tenants.findFirst.mockResolvedValue(undefined);
  m.hasModule.mockResolvedValue(true);
  m.hasFeature.mockResolvedValue(true);
  vi.stubEnv('ALLOW_DEMO_MODE', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireAuth — rejection paths', () => {
  it('returns 401 when no token is present', async () => {
    const result = await requireAuth(makeRequest());

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Authentication required');
    expect(m.setTenantContext).not.toHaveBeenCalled();
    expect(m.verifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 when verifyToken rejects the token', async () => {
    m.verifyToken.mockResolvedValue(null);

    const result = await requireAuth(makeRequest({ token: 'tampered.token' }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Invalid or expired token');
    expect(m.verifyToken).toHaveBeenCalledWith('tampered.token');
    // No session lookup, no RLS context on a rejected token.
    expect(m.hashToken).not.toHaveBeenCalled();
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is valid but no matching non-expired session row exists', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue(undefined);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Session expired');
    expect(m.db.query.sessions.findFirst).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('returns 401 when the session is valid but the user record does not exist', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1', tokenHash: TOKEN_HASH });
    queueSelects([]); // users lookup returns no rows

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('User not found');
    expect(m.setTenantContext).not.toHaveBeenCalled();
    expect(m.rc.cache).not.toHaveBeenCalled();
  });

  it('returns 403 "No active workspace" when the user exists but has no active membership', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], []); // user found, membership join empty

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 403);
    expect(body.error).toBe('No active workspace');
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('falls back to request.cookies when the next/headers cookies() store is unavailable', async () => {
    const { cookies } = await import('next/headers');
    vi.mocked(cookies).mockRejectedValueOnce(new Error('cookies() not available in this context'));
    m.verifyToken.mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/contacts', {
      headers: new Headers({ cookie: 'nucrm_session=request-cookie-token' }),
    });

    const result = await requireAuth(req);

    await expectRejection(result, 401);
    expect(m.verifyToken).toHaveBeenCalledWith('request-cookie-token');
  });

  it('reads the token from the nucrm_session cookie when no Authorization header is present', async () => {
    m.cookieToken.current = 'cookie.jwt.token';
    m.verifyToken.mockResolvedValue(null);

    const result = await requireAuth(makeRequest());

    await expectRejection(result, 401);
    // Proves the cookie was used as the token source rather than being treated as "no token".
    expect(m.verifyToken).toHaveBeenCalledWith('cookie.jwt.token');
  });
});

describe('requireAuth — demo mode is never an auth fallback', () => {
  /**
   * Seeds a resolvable demo tenant + demo user so that IF the implementation ever
   * consulted the demo path it WOULD hand back a usable context. Without this the
   * "expect 401" assertions would pass for the wrong reason (no demo tenant to find).
   */
  function seedResolvableDemoWorkspace(): void {
    m.db.query.tenants.findFirst.mockResolvedValue({ id: 'demo-tenant', slug: 'demo' });
    m.db.query.users.findFirst.mockResolvedValue({
      id: 'demo-user-id',
      email: 'demo@nucrm.local',
      fullName: 'Demo User',
      isSuperAdmin: false,
    });
  }

  it('returns 401 (never a demo context) when there is no token and demo mode is not allowed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', '');
    seedResolvableDemoWorkspace();

    const result = await requireAuth(makeRequest());

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Authentication required');
    // The demo lookup must not even be attempted.
    expect(m.db.query.tenants.findFirst).not.toHaveBeenCalled();
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('returns 401 with no token in production even when ALLOW_DEMO_MODE=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    seedResolvableDemoWorkspace();

    const result = await requireAuth(makeRequest());

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Authentication required');
    expect(m.db.query.tenants.findFirst).not.toHaveBeenCalled();
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('is only reachable with NODE_ENV!=production AND ALLOW_DEMO_MODE=true AND no token', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockResolvedValue({ id: 'demo-tenant', slug: 'demo' });
    m.db.query.users.findFirst.mockResolvedValue({
      id: 'demo-user-id',
      email: 'demo@nucrm.local',
      fullName: 'Demo User',
      isSuperAdmin: false,
    });

    const result = await requireAuth(makeRequest());

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.tenantId).toBe('demo-tenant');
    expect(ctx.userId).toBe('demo-user-id');
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.isSuperAdmin).toBe(false);
    expect(ctx.authMethod).toBe('jwt');
  });

  it('does NOT fall back to demo when a token is present but invalid', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.verifyToken.mockResolvedValue(null);
    seedResolvableDemoWorkspace();

    const result = await requireAuth(makeRequest({ token: 'bogus.token' }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Invalid or expired token');
    expect(m.db.query.tenants.findFirst).not.toHaveBeenCalled();
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('does NOT fall back to demo when the token is valid but the session is gone', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.sessions.findFirst.mockResolvedValue(undefined);
    seedResolvableDemoWorkspace();

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Session expired');
    expect(m.db.query.tenants.findFirst).not.toHaveBeenCalled();
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('returns 401 when demo mode is allowed but no demo tenant exists', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockResolvedValue(undefined);

    const result = await requireAuth(makeRequest());

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Authentication required');
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('returns 401 when the demo tenant lookup throws', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await requireAuth(makeRequest());

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Authentication required');
    errSpy.mockRestore();
  });

  it('coerces a null isSuperAdmin on the demo user to false', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockResolvedValue({ id: 'demo-tenant', slug: 'demo' });
    m.db.query.users.findFirst.mockResolvedValue({
      id: 'demo-user-id',
      email: 'demo@nucrm.local',
      fullName: null,
      isSuperAdmin: null,
    });

    const result = await requireAuth(makeRequest());

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).user).toEqual({
      id: 'demo-user-id',
      email: 'demo@nucrm.local',
      full_name: null,
      is_super_admin: false,
    });
  });

  it('falls back to placeholder demo user when the demo user row is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockResolvedValue({ id: 'demo-tenant', slug: 'demo' });
    m.db.query.users.findFirst.mockResolvedValue(undefined);

    const result = await requireAuth(makeRequest());

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.userId).toBe('demo-user');
    expect(ctx.user).toEqual({
      id: 'demo-user',
      email: 'demo@nucrm.local',
      full_name: 'Demo User',
      is_super_admin: false,
    });
  });
});

describe('requireAuth — API key authentication', () => {
  it('uses the api-key context, marks authMethod=api_key and never attempts the JWT path', async () => {
    m.tryApiKeyAuth.mockResolvedValue({
      userId: 'api-user',
      tenantId: 'api-tenant',
      roleSlug: 'integration',
      permissions: { 'contacts.view': true },
      isAdmin: false,
      isSuperAdmin: false,
    });

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.authMethod).toBe('api_key');
    expect(ctx.userId).toBe('api-user');
    expect(ctx.tenantId).toBe('api-tenant');
    // JWT path must not run at all.
    expect(m.verifyToken).not.toHaveBeenCalled();
    expect(m.hashToken).not.toHaveBeenCalled();
    expect(m.db.query.sessions.findFirst).not.toHaveBeenCalled();
    expect(m.rc.getCached).not.toHaveBeenCalled();
    expect(m.rc.set).toHaveBeenCalled();
  });

  it('falls through to the JWT path when tryApiKeyAuth returns null', async () => {
    m.tryApiKeyAuth.mockResolvedValue(null);
    m.verifyToken.mockResolvedValue(null);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    await expectRejection(result, 401);
    expect(m.verifyToken).toHaveBeenCalledTimes(1);
  });
});

describe('requireAuth — super admin', () => {
  it('bypasses the tenant-membership lookup and uses lastTenantId', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow({ id: 'sa-1', isSuperAdmin: true, lastTenantId: 'tenant-sa' })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.tenantId).toBe('tenant-sa');
    expect(ctx.roleSlug).toBe('superadmin');
    expect(ctx.isSuperAdmin).toBe(true);
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.permissions).toEqual({ all: true });
    expect(ctx.noWorkspace).toBe(false);
    // The membership query is the only one that joins — it must not have run.
    expect(m.db.innerJoin).not.toHaveBeenCalled();
    expect(m.rc.cache).toHaveBeenCalledWith(TOKEN_HASH, expect.objectContaining({ tenantId: 'tenant-sa' }));
  });

  it('falls back to the __superadmin_no_tenant__ sentinel and sets noWorkspace when lastTenantId is null', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow({ id: 'sa-1', isSuperAdmin: true, lastTenantId: null })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.tenantId).toBe('__superadmin_no_tenant__');
    expect(ctx.noWorkspace).toBe(true);
    expect(ctx.isSuperAdmin).toBe(true);
    expect(ctx.isAdmin).toBe(true);
    expect(m.db.innerJoin).not.toHaveBeenCalled();
  });
});

describe('requireAuth — normal tenant member', () => {
  it('builds the context from the membership row', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [userRow()],
      [memberRow({ tenantId: 'tenant-7', roleSlug: 'member', permissions: { 'deals.view': true } })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.userId).toBe('user-1');
    expect(ctx.tenantId).toBe('tenant-7');
    expect(ctx.roleSlug).toBe('member');
    expect(ctx.permissions).toEqual({ 'deals.view': true });
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.isSuperAdmin).toBe(false);
    expect(m.rc.cache).toHaveBeenCalledWith(TOKEN_HASH, expect.objectContaining({ tenantId: 'tenant-7' }));
  });

  it('marks isAdmin for the admin role slug', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], [memberRow({ roleSlug: 'admin' })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect((result as AuthContext).isAdmin).toBe(true);
    expect((result as AuthContext).isSuperAdmin).toBe(false);
  });

  it('defaults permissions to {} and roleSlug to "" when the row has none', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], [memberRow({ roleSlug: null, permissions: null })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const ctx = result as AuthContext;
    expect(ctx.permissions).toEqual({});
    expect(ctx.roleSlug).toBe('');
    expect(ctx.isAdmin).toBe(false);
  });
});

describe('requireAuth — cached context path', () => {
  it('re-checks session AND membership on a cache hit, so a live authorized session rides the cache', async () => {
    m.rc.getCached.mockResolvedValue(cachedCtx());
    queueSelects(
      [{ count: 1 }], // session still live
      [{ status: 'active', roleSlug: 'member' }], // membership still active, same role
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).tenantId).toBe('cached-tenant');
    // Both re-checks happened, and the full DB rebuild did not.
    expect(m.db.select).toHaveBeenCalledTimes(2);
    expect(m.db.query.sessions.findFirst).not.toHaveBeenCalled();
    expect(m.rc.invalidate).not.toHaveBeenCalled();
    expect(m.rc.set).toHaveBeenCalledWith('req-generated', expect.objectContaining({ tenantId: 'cached-tenant' }));
  });

  it('does NOT trust the cache once the membership is no longer active', async () => {
    // Revoking a member's access must take effect immediately, not after the
    // cache TTL. Previously only the session was re-checked, so a revoked user
    // kept their old tenant and permissions for the rest of the TTL.
    m.rc.getCached.mockResolvedValue(cachedCtx());
    queueSelects(
      [{ count: 1 }], // session is still live...
      [{ status: 'suspended', roleSlug: 'member' }], // ...but membership is not
    );
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], []); // rebuild finds no active membership

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 403);
    expect(body.error).toBe('No active workspace');
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('does NOT trust the cache once the membership row has been deleted', async () => {
    m.rc.getCached.mockResolvedValue(cachedCtx());
    queueSelects([{ count: 1 }], []); // membership row gone
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], []);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    await expectRejection(result, 403);
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('does NOT trust the cached permission set after a role change', async () => {
    // A downgrade from admin to member must not keep serving admin permissions.
    m.rc.getCached.mockResolvedValue(cachedCtx({ roleSlug: 'admin', isAdmin: true }));
    queueSelects(
      [{ count: 1 }],
      [{ status: 'active', roleSlug: 'member' }], // role no longer matches the cache
    );
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [userRow()],
      [memberRow({ tenantId: 'cached-tenant', roleSlug: 'member', permissions: { 'contacts.view': true } })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    const ctx = result as AuthContext;
    expect(ctx.roleSlug).toBe('member');
    expect(ctx.isAdmin).toBe(false);
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
  });

  it('#1836: keeps trusting the cache when the role version is unchanged', async () => {
    const t = Date.now();
    m.rc.getCached.mockResolvedValue(cachedCtx({ roleVersion: t }));
    queueSelects(
      [{ count: 1 }],                                            // session live
      [{ status: 'active', roleSlug: 'member', roleId: 'role-1' }], // membership ok
      [{ updatedAt: new Date(t) }],                              // role unchanged (same version)
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).tenantId).toBe('cached-tenant');
    expect(m.rc.invalidate).not.toHaveBeenCalled();
  });

  it('#1836: invalidates the cache when the role permissions were edited in place (version advanced)', async () => {
    const cachedAt = Date.now() - 60_000;
    m.rc.getCached.mockResolvedValue(cachedCtx({ roleVersion: cachedAt, roleSlug: 'member' }));
    queueSelects(
      [{ count: 1 }],                                             // session live
      [{ status: 'active', roleSlug: 'member', roleId: 'role-1' }], // same role slug
      [{ updatedAt: new Date(cachedAt + 30_000) }],               // role updated AFTER cache → stale
    );
    // rebuild path
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [userRow()],
      [memberRow({ tenantId: 'cached-tenant', roleSlug: 'member', permissions: { 'contacts.view': true, 'contacts.edit': true }, roleUpdatedAt: new Date(cachedAt + 30_000) })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    // Rebuilt context carries the freshly-edited permissions, not the stale set.
    expect((result as AuthContext).permissions).toEqual({ 'contacts.view': true, 'contacts.edit': true });
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
  });

  it('#1836: re-validates a cached context that has NO roleVersion stamp (null treated as 0)', async () => {
    // Contexts cached before the version stamp existed (e.g. across a deploy)
    // have roleVersion == null. Previously the version check was skipped for
    // them, so an in-place permission edit stayed effective for the full TTL.
    // Now null is treated as 0, so any real role (updated_at > 0) forces a
    // re-validation on the next hit.
    m.rc.getCached.mockResolvedValue(cachedCtx({ roleVersion: undefined, roleSlug: 'member' }));
    queueSelects(
      [{ count: 1 }],                                              // session live
      [{ status: 'active', roleSlug: 'member', roleId: 'role-1' }], // membership ok, has roleId
      [{ updatedAt: new Date() }],                                 // live role has a real updated_at (> 0)
    );
    // rebuild path (cache was treated as stale)
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [userRow()],
      [memberRow({ tenantId: 'cached-tenant', roleSlug: 'member', roleUpdatedAt: new Date() })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    // The unstamped cache was NOT trusted — it was invalidated and rebuilt.
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
  });

  it('#1836: stamps roleVersion from the role updated_at when building a fresh context', async () => {
    const roleUpdated = new Date('2026-08-01T00:00:00Z');
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [userRow()],
      [memberRow({ tenantId: 'tenant-1', roleSlug: 'member', roleUpdatedAt: roleUpdated })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    // The cached copy must carry the version stamp for later staleness checks.
    expect(m.rc.cache).toHaveBeenCalledWith(
      TOKEN_HASH,
      expect.objectContaining({ roleVersion: roleUpdated.getTime() }),
    );
  });

  it('skips the membership check for a cached super admin, which has no membership row', async () => {
    m.rc.getCached.mockResolvedValue(
      cachedCtx({ isSuperAdmin: true, isAdmin: true, roleSlug: 'superadmin', tenantId: 'tenant-sa', userId: 'sa-1' }),
    );
    queueSelects([{ count: 1 }]); // session only — no membership lookup expected

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).isSuperAdmin).toBe(true);
    expect(m.db.select).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('tenant-sa', 'sa-1');
  });

  it('invalidates the cache entry and does not succeed on the cached value when the session is revoked', async () => {
    const cached = cachedCtx();
    m.rc.getCached.mockResolvedValue(cached);
    queueSelects([{ count: 0 }]); // revoked session: re-check finds nothing
    m.db.query.sessions.findFirst.mockResolvedValue(undefined);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    const body = await expectRejection(result, 401);
    expect(body.error).toBe('Session expired');
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
    expect(result).not.toBe(cached);
    // Crucially: a revoked session must not get RLS context set.
    expect(m.setTenantContext).not.toHaveBeenCalled();
  });

  it('rebuilds from the database (not the stale cache) when the cached entry is invalidated', async () => {
    m.rc.getCached.mockResolvedValue(cachedCtx({ tenantId: 'stale-tenant', userId: 'stale-user' }));
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects(
      [{ count: 0 }], // re-check fails -> invalidate
      [userRow()],
      [memberRow({ tenantId: 'fresh-tenant' })],
    );

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).tenantId).toBe('fresh-tenant');
    expect((result as AuthContext).userId).toBe('user-1');
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
    expect(m.setTenantContext).toHaveBeenCalledWith('fresh-tenant', 'user-1');
    expect(m.setTenantContext).not.toHaveBeenCalledWith('stale-tenant', 'stale-user');
  });

  it('treats a missing count row as no session and invalidates', async () => {
    m.rc.getCached.mockResolvedValue(cachedCtx());
    queueSelects([]); // no count row at all
    m.db.query.sessions.findFirst.mockResolvedValue(undefined);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    await expectRejection(result, 401);
    expect(m.rc.invalidate).toHaveBeenCalledWith(TOKEN_HASH);
  });
});

describe('requireAuth — setTenantContext propagation on every successful path', () => {
  it('sets tenant context with the api-key tenantId and userId', async () => {
    m.tryApiKeyAuth.mockResolvedValue({
      userId: 'api-user',
      tenantId: 'api-tenant',
      roleSlug: 'integration',
      permissions: {},
      isAdmin: false,
      isSuperAdmin: false,
    });

    const result = await requireAuth(makeRequest());

    expect(isContext(result)).toBe(true);
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('api-tenant', 'api-user');
  });

  it('sets tenant context with the cached tenantId and userId on a cache hit', async () => {
    m.rc.getCached.mockResolvedValue(cachedCtx({ tenantId: 'cached-tenant', userId: 'cached-user' }));
    queueSelects([{ count: 1 }], [{ status: 'active', roleSlug: 'member' }]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('cached-tenant', 'cached-user');
  });

  it('sets tenant context with lastTenantId for a super admin', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow({ id: 'sa-1', isSuperAdmin: true, lastTenantId: 'tenant-sa' })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('tenant-sa', 'sa-1');
  });

  it('sets tenant context with the sentinel for a super admin without a workspace', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow({ id: 'sa-1', isSuperAdmin: true, lastTenantId: null })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('__superadmin_no_tenant__', 'sa-1');
  });

  it('sets tenant context with the resolved membership tenantId for a normal member', async () => {
    m.db.query.sessions.findFirst.mockResolvedValue({ id: 'sess-1' });
    queueSelects([userRow()], [memberRow({ id: 'user-9', tenantId: 'tenant-9' })]);

    const result = await requireAuth(makeRequest({ token: TOKEN }));

    expect(isContext(result)).toBe(true);
    expect((result as AuthContext).tenantId).toBe('tenant-9');
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('tenant-9', 'user-9');
  });

  it('sets tenant context with the demo tenant on the demo path', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_DEMO_MODE', 'true');
    m.db.query.tenants.findFirst.mockResolvedValue({ id: 'demo-tenant', slug: 'demo' });
    m.db.query.users.findFirst.mockResolvedValue({
      id: 'demo-user-id',
      email: 'demo@nucrm.local',
      fullName: 'Demo User',
      isSuperAdmin: false,
    });

    const result = await requireAuth(makeRequest());

    expect(isContext(result)).toBe(true);
    expect(m.setTenantContext).toHaveBeenCalledTimes(1);
    expect(m.setTenantContext).toHaveBeenCalledWith('demo-tenant', 'demo-user-id');
  });
});

describe('requireCsrf', () => {
  const csrfToken = 'a'.repeat(64);

  it('returns null for a safe method that needs no validation', () => {
    const req = makeRequest({ method: 'GET', path: '/api/contacts' });
    expect(requireCsrf(req)).toBeNull();
  });

  it('returns null when cookie and header tokens match', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/api/contacts',
      headers: { cookie: `nucrm_csrf_token=${csrfToken}`, 'x-csrf-token': csrfToken },
    });
    expect(requireCsrf(req)).toBeNull();
  });

  it('returns 403 when the header token is missing', async () => {
    const req = makeRequest({
      method: 'POST',
      path: '/api/contacts',
      headers: { cookie: `nucrm_csrf_token=${csrfToken}` },
    });

    const res = requireCsrf(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect(res?.status).toBe(403);
    const body = (await res?.json()) as { error?: string };
    expect(body.error).toContain('CSRF token missing or invalid');
  });

  it('returns 403 when the tokens do not match', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/api/contacts',
      headers: { cookie: `nucrm_csrf_token=${csrfToken}`, 'x-csrf-token': 'b'.repeat(64) },
    });
    expect(requireCsrf(req)?.status).toBe(403);
  });

  it('returns null for api_key authenticated requests (exempt)', () => {
    const req = makeRequest({
      method: 'POST',
      path: '/api/contacts',
      headers: { 'x-auth-method': 'api_key' },
    });
    expect(requireCsrf(req)).toBeNull();
  });

  it('returns null for exempt webhook paths', () => {
    const req = makeRequest({ method: 'POST', path: '/api/webhooks/stripe' });
    expect(requireCsrf(req)).toBeNull();
  });
});

describe('requireModule / requireFeature', () => {
  const ctx = (over: Partial<AuthContext> = {}): AuthContext =>
    ({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roleSlug: 'member',
      permissions: {},
      isAdmin: false,
      isSuperAdmin: false,
      ...over,
    }) as AuthContext;

  it('requireModule allows when the module is active', async () => {
    m.hasModule.mockResolvedValue(true);
    expect(await requireModule(ctx(), 'core-crm')).toBeNull();
    expect(m.hasModule).toHaveBeenCalledWith('tenant-1', 'core-crm');
  });

  it('requireModule denies with 403 when the module is not active', async () => {
    m.hasModule.mockResolvedValue(false);

    const res = await requireModule(ctx(), 'projects');

    expect(res?.status).toBe(403);
    const body = (await res?.json()) as { error?: string };
    expect(body.error).toBe('Module not active: projects');
  });

  it('requireModule allows super admins without consulting the registry', async () => {
    expect(await requireModule(ctx({ isSuperAdmin: true }), 'projects')).toBeNull();
    expect(m.hasModule).not.toHaveBeenCalled();
  });

  it('requireFeature allows when module and feature are both enabled', async () => {
    m.hasModule.mockResolvedValue(true);
    m.hasFeature.mockResolvedValue(true);

    expect(await requireFeature(ctx(), 'core-crm', 'bulk-import')).toBeNull();
    expect(m.hasFeature).toHaveBeenCalledWith('tenant-1', 'core-crm', 'bulk-import');
  });

  it('requireFeature denies with the module error when the parent module is inactive', async () => {
    m.hasModule.mockResolvedValue(false);

    const res = await requireFeature(ctx(), 'projects', 'gantt');

    expect(res?.status).toBe(403);
    const body = (await res?.json()) as { error?: string };
    expect(body.error).toBe('Module not active: projects');
    expect(m.hasFeature).not.toHaveBeenCalled();
  });

  it('requireFeature denies with 403 and feature details when only the feature is off', async () => {
    m.hasModule.mockResolvedValue(true);
    m.hasFeature.mockResolvedValue(false);

    const res = await requireFeature(ctx(), 'core-crm', 'bulk-import');

    expect(res?.status).toBe(403);
    const body = (await res?.json()) as { error?: string; module?: string; feature?: string };
    expect(body.module).toBe('core-crm');
    expect(body.feature).toBe('bulk-import');
    expect(body.error).toContain("Specific feature 'bulk-import' is not enabled");
  });

  it('requireFeature allows super admins without consulting the registry', async () => {
    expect(await requireFeature(ctx({ isSuperAdmin: true }), 'projects', 'gantt')).toBeNull();
    expect(m.hasModule).not.toHaveBeenCalled();
    expect(m.hasFeature).not.toHaveBeenCalled();
  });
});
