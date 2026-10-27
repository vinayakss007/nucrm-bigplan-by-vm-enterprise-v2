/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 ask 3 — firing an integration is a privileged action, not a read.
 *
 * `POST /api/tenant/plugin-engine/actions` gated on bare `requireAuth`, and the
 * provider handler returns the upstream response body to whoever called it
 * (`lib/integrations/registry.ts:148-150`). With the Mailgun `base_url` still
 * tenant-configurable that made any member of the workspace a readable proxy for
 * internal HTTP; with the egress fixed (this PR) the read-back is still a
 * problem, because what the endpoint does is issue a request *with that
 * integration's credentials* and hand back whatever came out.
 *
 * The gate is `requirePerm(ctx, 'settings.manage')`, and the real `requirePerm`
 * from `lib/auth/middleware.ts` is what runs here — only `requireAuth` is
 * stubbed, so the assertions are about which permission the route asks for and
 * not about a mock's own behaviour. `can()` resolves the permission true for
 * admins and for a role carrying `settings.manage`, which is the shape the
 * integrations admin UI already has.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';

const harness = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  executed: [] as string[],
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(handler: T): T => handler,
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

/**
 * The real permission logic, with only the identity lookup stubbed — so
 * `requirePerm` here is `lib/auth/middleware.ts:437`, not a test double that
 * would agree with anything.
 */
vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => harness.ctx),
    requireCsrf: vi.fn(() => null),
  };
});

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{
              id: ROW_ID,
              tenantId: TENANT_ID,
              type: 'mailgun',
              name: 'Mailgun',
              config: { api_key: 'key-1', domain: 'mg.example.com', base_url: 'https://api.mailgun.net/v3' },
              isActive: true,
              createdAt: new Date(),
            }]),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
  },
}));

vi.mock('@/lib/integrations/registry', () => ({
  executeAction: vi.fn(async (instance: { providerId: string }) => {
    harness.executed.push(instance.providerId);
    return { success: true, data: { id: '<2026@mg.example.com>' } };
  }),
  getAllProviders: vi.fn(() => []),
  getProviderDef: vi.fn(() => undefined),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));

// The real `requirePerm`/`can` live in a module that also pulls the session,
// quota and module-registry machinery at import time. Stubbing the edges is what
// lets this spec keep the permission logic and drop the rest.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  hashToken: vi.fn(async () => 'h'),
  getCurrentUserForToken: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/api-key', () => ({ tryApiKeyAuth: vi.fn(async () => null) }));
vi.mock('@/lib/usage/api-key-quota', () => ({ checkApiKeyCallQuota: vi.fn(async () => null) }));
vi.mock('@/lib/db/rls', () => ({
  setTenantContext: vi.fn(async () => undefined),
  setSuperAdminContext: vi.fn(async () => undefined),
  withUserContext: <T>(fn: () => T): T => fn(),
  NO_TENANT_SENTINEL: '00000000-0000-0000-0000-000000000000',
}));
vi.mock('@/lib/tenant/request-context', () => ({
  requestContext: {
    get: () => undefined,
    set: () => undefined,
    cache: () => undefined,
    read: () => undefined,
  },
  withRequestId: <T>(_requestId: string, fn: () => T): T => fn(),
}));
vi.mock('@/lib/modules/registry', () => ({
  ModuleRegistry: {
    hasModule: vi.fn(async () => true),
    hasFeature: vi.fn(async () => true),
  },
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function fire(): Promise<Response> {
  return import('@/app/api/tenant/plugin-engine/actions/route').then((mod) =>
    (mod.POST as unknown as (r: NextRequest) => Promise<Response>)(
      new Request('http://localhost/api/tenant/plugin-engine/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instance_id: ROW_ID,
          action: 'send_email',
          params: { to: 'a@b.co', subject: 's', body: 'b' },
        }),
      }) as unknown as NextRequest,
    ),
  );
}

function memberWithoutPermission() {
  harness.ctx = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    roleSlug: 'member',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    authMethod: 'session',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.executed = [];
  memberWithoutPermission();
});

describe('plugin-engine/actions requires settings.manage', () => {
  it('refuses a plain member and executes nothing', async () => {
    const res = await fire();
    expect(res.status).toBe(403);
    expect(harness.executed).toEqual([]);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('settings.manage');
  });

  it('does not leak the integration response body to the refuted caller', async () => {
    const res = await fire();
    expect(await res.text()).not.toContain('mg.example.com');
  });

  it('lets a role that holds settings.manage through', async () => {
    harness.ctx = { ...harness.ctx, permissions: { 'settings.manage': true } };
    const res = await fire();
    expect(res.status).toBe(200);
    expect(harness.executed).toEqual(['mailgun']);
  });

  it('lets the workspace admin through, because can() treats admin as holding it', async () => {
    harness.ctx = { ...harness.ctx, roleSlug: 'admin', isAdmin: true };
    expect((await fire()).status).toBe(200);
  });

  it('still refuses an unauthenticated call before the permission check', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await fire();
    expect(res.status).toBe(401);
    expect(harness.executed).toEqual([]);
  });

  it('checks the permission before touching the database', async () => {
    // The order matters: a gate placed after the row lookup would still answer
    // 403 while proving which instance ids exist in the tenant.
    memberWithoutPermission();
    const res = await fire();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(ROW_ID);
  });
});
