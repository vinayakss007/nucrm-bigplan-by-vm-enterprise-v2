/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — the tenant plugin-engine route had a role-shaped hole.
 *
 * `/api/tenant/plugin-engine/actions` already gates privileged calls with
 * `settings.manage` (#3292), but the CRUD route that *stores* the integration
 * credentials answered to a bare `requireAuth`: any member with a session and a
 * CSRF token could install, edit or soft-delete integrations for the tenant, and
 * read back the list with its credential-key names. This spec runs the REAL
 * `requirePerm` from `lib/auth/middleware.ts` — only identity lookup is stubbed —
 * and asserts that the gate fires before any database call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';

const harness = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  selects: 0,
  inserts: 0,
  updates: 0,
  csrf: 0,
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(handler: T): T => handler,
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => harness.ctx),
    requireCsrf: vi.fn(() => {
      harness.csrf += 1;
      return null;
    }),
  };
});

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      harness.selects += 1;
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([{
              id: ROW_ID,
              tenantId: TENANT_ID,
              type: 'mailgun',
              name: 'Mailgun',
              config: { api_key: 'key-1', domain: 'mg.example.com' },
              isActive: true,
              createdAt: new Date(),
            }]),
          }),
        }),
      };
    },
    insert: () => {
      harness.inserts += 1;
      return {
        values: () => ({
          returning: () => Promise.resolve([{
            id: ROW_ID,
            tenantId: TENANT_ID,
            type: 'mailgun',
            name: 'Mailgun',
            config: { api_key: 'key-1', domain: 'mg.example.com' },
            isActive: true,
            createdAt: new Date(),
          }]),
        }),
      };
    },
    update: () => {
      harness.updates += 1;
      return {
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([{ id: ROW_ID, updatedAt: new Date() }]),
            then: (resolve: (v: unknown) => void) => resolve([]),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/lib/integrations/registry', () => ({
  getAllProviders: vi.fn(() => []),
  getProviderDef: vi.fn(() => undefined),
}));
vi.mock('@/lib/integrations/config-credentials', () => ({
  splitConfigCredentials: vi.fn(() => ({ publicConfig: {}, credentialKeys: ['api_key'] })),
  mergeKeepingSecretKeys: vi.fn((_existing: unknown, incoming: unknown) => incoming),
}));
vi.mock('@/lib/integrations/config-policy', () => ({
  integrationConfigResponse: vi.fn(() => null),
}));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => ({ provider_id: 'mailgun', name: 'Mailgun', id: ROW_ID })),
  validateBody: vi.fn(() => ({ data: {} })),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));

// The real `can`/`requirePerm` live in a module that pulls session, quota and
// module machinery at import time. Stub the edges, keep the permission logic.
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
  withUserContext: <T,>(fn: () => T): T => fn(),
  NO_TENANT_SENTINEL: '00000000-0000-0000-0000-000000000000',
}));
vi.mock('@/lib/tenant/request-context', () => ({
  requestContext: {
    get: () => undefined,
    set: () => undefined,
    cache: () => undefined,
    read: () => undefined,
  },
  withRequestId: <T,>(_requestId: string, fn: () => T): T => fn(),
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

type Handler = (r: NextRequest) => Promise<Response>;
async function fire(method: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<Response> {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  const handler = mod[method] as Handler;
  return handler(new Request(`http://localhost/api/tenant/plugin-engine?id=${ROW_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest);
}

function member() {
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
  harness.selects = harness.inserts = harness.updates = harness.csrf = 0;
  member();
});

describe('plugin-engine CRUD requires settings permissions (#3402)', () => {
  it('refuses a plain member on every handler, before any database call', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      member();
      const res = await fire(method);
      expect(res.status, method).toBe(403);
      expect(JSON.stringify(await res.json())).toContain(method === 'GET' ? 'settings.view' : 'settings.manage');
    }
    expect(harness.selects).toBe(0);
    expect(harness.inserts).toBe(0);
    expect(harness.updates).toBe(0);
  });

  it('lets a role holding settings.view read, but not write', async () => {
    harness.ctx = { ...harness.ctx, permissions: { 'settings.view': true } };
    expect((await fire('GET')).status).toBe(200);
    expect(harness.selects).toBe(1);
    expect((await fire('POST')).status).toBe(403);
    expect(harness.inserts).toBe(0);
  });

  it('lets a role holding settings.manage install, edit and delete', async () => {
    harness.ctx = { ...harness.ctx, permissions: { 'settings.manage': true } };
    expect((await fire('POST')).status).toBe(201);
    expect((await fire('PATCH')).status).toBe(200);
    expect((await fire('DELETE')).status).toBe(200);
    expect(harness.inserts).toBe(1);
    expect(harness.updates).toBe(2);
  });

  it('lets an admin through, because can() treats admin as holding both ids', async () => {
    harness.ctx = { ...harness.ctx, roleSlug: 'admin', isAdmin: true };
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      expect((await fire(method)).status, method).not.toBe(403);
    }
  });

  it('still refuses an unauthenticated call before the permission check', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await fire('POST');
    expect(res.status).toBe(401);
    expect(harness.inserts).toBe(0);
  });
});
