/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3001 — the custom-field DEFINITION mutators ran on `requireAuth` alone, so any
 * authenticated tenant member could rewrite tenant-wide schema. A field definition
 * is the shape every form, list, filter and integration in the tenant renders, so
 * the create branch of POST, PUT and DELETE now require `settings.manage` via
 * `requirePerm` — the same permission the sibling tenant-config routes already use
 * to gate writes (`app/api/tenant/api-keys`, `branding`, `canned-responses`). It is
 * the permission the RBAC surface already defines for editing tenant-wide settings;
 * no new id was invented. `can()` short-circuits on admin/superadmin, so admins keep
 * passing. The `action=register-feature` branch is untouched (it already demands super
 * admin — see the #2768 test) and `set-value`/`set-bulk` stay member-open because they
 * write a value on one record, not the shared definition. Pass-through for an
 * authorized caller is proved by the status the body reaches *past* the gate — the 400
 * validation failure (or the 404 a missing record would give), not by a 2xx — so the
 * pin also shows the gate sits before validation, not after it. Both GET shapes stay
 * open to the same unauthorized caller, mirroring #3020 so over-correction is visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T>(h: T) => h,
}));

// Keep the real requirePerm/can() logic so the boundary is the permission itself,
// not a hand-written stub of it — only the authenticated principal is faked.
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      customFieldDefs: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => undefined) },
      featureRegistry: { findMany: vi.fn(async () => []) },
    },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })) })),
    execute: vi.fn(async () => ({ rows: [] })),
  },
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/custom-fields/route');

const NON_ADMIN: AuthContext = {
  userId: STAFF, tenantId: TENANT, roleSlug: 'viewer', permissions: {},
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

const ADMIN: AuthContext = {
  userId: STAFF, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

// A non-admin who actually holds the settings-editing permission — proves the gate is
// `settings.manage`, not a blanket admin check.
const DELEGATED: AuthContext = {
  userId: STAFF, tenantId: TENANT, roleSlug: 'ops', permissions: { 'settings.manage': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

function req(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function run(handler: (r: NextRequest) => Promise<Response>, path: string, method: string, body?: unknown) {
  return handler(req(path, method, body));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('custom-field definition mutators require settings.manage (#3001)', () => {
  it('POST create-field branch: 403 for a non-admin, 400 past the gate for an authorized caller', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(NON_ADMIN);
    // No action param → falls through to the create-field definition branch.
    const res = await run(route.POST, '/api/tenant/custom-fields', 'POST', {});
    expect(res.status).toBe(403);

    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const adminRes = await run(route.POST, '/api/tenant/custom-fields', 'POST', {});
    // Past the gate, the empty body fails createCustomFieldSchema → 400, never reaching the insert.
    expect(adminRes.status).toBe(400);
  });

  it('POST create-field branch: 403 for a non-admin without the permission, 400 past the gate when they hold it', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(DELEGATED);
    const res = await run(route.POST, '/api/tenant/custom-fields', 'POST', {});
    // settings.manage (not admin) is what opens the gate.
    expect(res.status).toBe(400);
  });

  it('PUT (edit definition): 403 for a non-admin, 400 past the gate for an authorized caller', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(NON_ADMIN);
    const res = await run(route.PUT, '/api/tenant/custom-fields', 'PUT', {});
    expect(res.status).toBe(403);

    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const adminRes = await run(route.PUT, '/api/tenant/custom-fields', 'PUT', {});
    // Past the gate, missing fieldId fails updateCustomFieldSchema → 400, before the update.
    expect(adminRes.status).toBe(400);
  });

  it('DELETE (tombstone definition): 403 for a non-admin, 400 past the gate for an authorized caller', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(NON_ADMIN);
    const res = await run(route.DELETE, '/api/tenant/custom-fields', 'DELETE');
    expect(res.status).toBe(403);

    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    // Past the gate, with no fieldId/fieldKey+entityType the handler refuses on validation.
    const adminRes = await run(route.DELETE, '/api/tenant/custom-fields', 'DELETE');
    expect(adminRes.status).toBe(400);
  });

  it('leaves both GET shapes open to the same non-admin — the gate is on schema writes, not reads', async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(NON_ADMIN);

    // Shape 1: the entity-types hint / definitions listing (no action param).
    const listRes = await run(route.GET, '/api/tenant/custom-fields', 'GET');
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toHaveProperty('entityTypes');

    // Shape 2: the registered-features read (action=features) — 200, not the 403 the
    // mutators answer, so reading is never framed as a permission problem.
    const featuresRes = await run(route.GET, '/api/tenant/custom-fields?action=features', 'GET');
    expect(featuresRes.status).toBe(200);
    expect(await featuresRes.json()).toHaveProperty('features');
  });
});
