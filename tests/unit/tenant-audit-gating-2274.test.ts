/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2274 — GET /api/tenant/audit called only requireAuth, so every sales rep
 * could read the FULL tenant audit trail (other users' emails + old_data/
 * new_data PII diffs of every admin/manager CRUD). The UI already treats the
 * audit log as admin-only (app/tenant/settings/audit/page.tsx redirects
 * non-admins; sidebar-nav entry is adminOnly), and there is no self-view
 * ("my entries only") consumer of the user_id param — so the whole route is
 * gated with ctx.isAdmin, mirroring the #2221 backup/config pattern.
 *
 * Same-family fix: /api/tenant/audit/export previously gated on
 * requirePerm('settings.manage') — a non-admin role holding that permission
 * could bulk-export up to 50k audit rows (emails + IPs). It now requires
 * ctx.isAdmin too.
 *
 * requireAuth is already session-backed (#2216: verifyToken + live sessions
 * row check), so a forged or an unrevoked-but-dead/expired session short-
 * circuits to a 401 NextResponse before the role gate runs; we assert the
 * route honors that short-circuit (mock convention from
 * tests/unit/backup-config-route-gate.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const { mockRequireAuth, mockRateLimit, mockLogError, state } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRateLimit: vi.fn(),
  mockLogError: vi.fn(),
  state: { selectQueue: [] as unknown[][], selectCalls: 0 },
}));

/**
 * Awaitable Drizzle-chain stub: every chaining method returns the chain, and
 * awaiting the chain resolves the queued rows. One shape covers the count
 * query (select→from→where), the logs query (select→from→leftJoin→where→
 * orderBy→limit→offset) and the edit_history / export queries.
 */
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy', 'having']) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      state.selectCalls += 1;
      return makeChain(state.selectQueue.shift() ?? []);
    },
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: (...args: unknown[]) => mockRateLimit(...args),
}));
vi.mock('@/lib/errors-server', () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));
// Unit tests have no DB to pin a connection against (repo convention).
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));

// The withApiRoute mock is identity, so the exported handler is the bare
// (request) => Promise<NextResponse> function.
type RouteFn = (req: NextRequest) => Promise<NextResponse>;

async function callAuditGet(query = '') {
  const { GET } = await import('@/app/api/tenant/audit/route');
  const req = new Request(`http://localhost/api/tenant/audit${query}`, {
    headers: { cookie: 'nucrm_session=abc' },
  }) as unknown as NextRequest;
  return (GET as unknown as RouteFn)(req);
}

async function callExportGet(query = '') {
  const { GET } = await import('@/app/api/tenant/audit/export/route');
  const req = new Request(`http://localhost/api/tenant/audit/export${query}`, {
    headers: { cookie: 'nucrm_session=abc' },
  }) as unknown as NextRequest;
  return (GET as unknown as RouteFn)(req);
}

// A realistic rep context: session-backed auth passes, but role_slug is
// sales_rep, is_admin:false and the permission set from issue #2274
// ({deals:full, tasks:full, reports:read, contacts:full}) — no audit perms.
const repCtx = {
  tenantId: TENANT_ID,
  userId: 'rep-1',
  roleSlug: 'sales_rep',
  permissions: { deals: true, tasks: true, reports: true, contacts: true },
  isAdmin: false,
  isSuperAdmin: false,
};

// A manager holding settings.manage — the exact ctx that used to slip through
// the export route's requirePerm gate.
const managerCtx = {
  tenantId: TENANT_ID,
  userId: 'mgr-1',
  roleSlug: 'manager',
  permissions: { 'settings.manage': true, deals: true },
  isAdmin: false,
  isSuperAdmin: false,
};

const adminCtx = {
  tenantId: TENANT_ID,
  userId: 'admin-1',
  roleSlug: 'admin',
  permissions: {},
  isAdmin: true,
  isSuperAdmin: false,
};

const superadminCtx = { ...adminCtx, userId: 'sa-1', roleSlug: '', isAdmin: true, isSuperAdmin: true };

// Admin path runs: 1) count, 2) logs, 3) edit_history correlation.
function queueAuditData() {
  state.selectQueue.push(
    [{ count: 1 }],
    [
      {
        id: 'log-1',
        action: 'update',
        resource_type: 'contact',
        resource_id: 'contact-1',
        created_at: new Date('2026-08-01'),
        ip_address: null,
        old_data: { email: 'old@example.com' },
        new_data: { email: 'new@example.com' },
        full_name: 'Admin User',
        email: 'admin@test.com',
        user_id: 'admin-1',
      },
    ],
    [],
  );
}

describe('/api/tenant/audit — admin-only gate (#2274)', () => {
  beforeEach(() => {
    vi.resetModules();
    state.selectQueue = [];
    state.selectCalls = 0;
    mockRateLimit.mockResolvedValue(null);
    mockLogError.mockResolvedValue(undefined);
  });

  it('sales rep → 403 and NO audit query runs (no PII leak)', async () => {
    mockRequireAuth.mockResolvedValue(repCtx);
    const res = await callAuditGet();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin access required' });
    expect(state.selectCalls).toBe(0);
  });

  it('manager (non-admin, even with settings.manage) → 403', async () => {
    mockRequireAuth.mockResolvedValue(managerCtx);
    const res = await callAuditGet();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin access required' });
    expect(state.selectCalls).toBe(0);
  });

  it('the user_id query param is not a bypass for a rep', async () => {
    mockRequireAuth.mockResolvedValue(repCtx);
    const res = await callAuditGet(`?user_id=${encodeURIComponent('other-user')}`);
    expect(res.status).toBe(403);
    expect(state.selectCalls).toBe(0);
  });

  it('admin → 200 with logs + total preserved (UI contract intact)', async () => {
    mockRequireAuth.mockResolvedValue(adminCtx);
    queueAuditData();
    const res = await callAuditGet('?limit=50&offset=0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].email).toBe('admin@test.com');
    expect(body.logs[0].field_changes).toEqual([]);
    expect(body.total).toBe(1);
  });

  it('superadmin (isAdmin derived in requireAuth) → 200', async () => {
    mockRequireAuth.mockResolvedValue(superadminCtx);
    queueAuditData();
    const res = await callAuditGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
  });

  it('no auth at all → the requireAuth 401 short-circuits before the gate', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));
    const res = await callAuditGet();
    expect(res.status).toBe(401);
    expect(state.selectCalls).toBe(0);
  });

  it('forged / unrevoked-but-dead-or-expired session (requireAuth 401, #2216 session-backed) → 401', async () => {
    const { NextResponse } = await import('next/server');
    // verifyToken parses but the sessions-row lookup (getCurrentUserForToken
    // equivalent inside requireAuth) fails → middleware returns this response.
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }));
    const res = await callAuditGet();
    expect(res.status).toBe(401);
    expect(state.selectCalls).toBe(0);
  });
});

describe('/api/tenant/audit/export — same-family admin-only gate (#2274)', () => {
  beforeEach(() => {
    vi.resetModules();
    state.selectQueue = [];
    state.selectCalls = 0;
    mockRateLimit.mockResolvedValue(null);
    mockLogError.mockResolvedValue(undefined);
  });

  it('non-admin manager WITH settings.manage → 403 (old requirePerm gate leaked the bulk export)', async () => {
    mockRequireAuth.mockResolvedValue(managerCtx);
    const res = await callExportGet('?format=csv');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin access required' });
    expect(state.selectCalls).toBe(0);
  });

  it('sales rep → 403', async () => {
    mockRequireAuth.mockResolvedValue(repCtx);
    const res = await callExportGet();
    expect(res.status).toBe(403);
    expect(state.selectCalls).toBe(0);
  });

  it('admin → 200 with entries', async () => {
    mockRequireAuth.mockResolvedValue(adminCtx);
    state.selectQueue.push([
      {
        id: 'log-1',
        action: 'update',
        entityType: 'contact',
        entityId: 'contact-1',
        userId: 'admin-1',
        userEmail: 'admin@test.com',
        userName: 'Admin User',
        metadata: null,
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-08-01'),
      },
    ]);
    const res = await callExportGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });

  it('unauthenticated → 401 short-circuit preserved', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));
    const res = await callExportGet();
    expect(res.status).toBe(401);
  });
});
