/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Built-in modules have no row in `public.modules` until installed, so pricing
 * UPDATEs can match zero rows. The bulk route used to answer `{ok:true,count:N}`
 * with N requested rather than written, hiding a settings save that never happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  executeResults: [] as unknown[],
  audits: [] as unknown[],
}));

const mockRequireAuth = vi.fn();
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: (...args: unknown[]) => mockRequireAuth(...args) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C,>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({
      execute: async () => h.executeResults.shift(),
    }),
  },
}));
vi.mock('@/lib/audit/super-admin', () => ({
  logSuperAdminAction: (...args: unknown[]) => { h.audits.push(args); return Promise.resolve(true); },
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

import { PATCH } from '@/app/api/superadmin/modules/bulk/route';

const URL = 'http://localhost:3000/api/superadmin/modules/bulk';
const request = (updates: unknown[]) => new NextRequest(URL, {
  method: 'PATCH',
  body: JSON.stringify({ updates }),
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  h.executeResults = [];
  h.audits = [];
  mockRequireAuth.mockResolvedValue({
    userId: 'admin-1', tenantId: 't-1', isSuperAdmin: true, isAdmin: true,
    user: { email: 'admin@example.test' },
  });
});

describe('module bulk pricing save (#3964 follow-up)', () => {
  it('reports only rows actually written', async () => {
    h.executeResults = [
      { rowCount: 1, rows: [{ id: 'mod-1' }] },
      { rowCount: 1, rows: [{ id: 'mod-2' }] },
    ];
    const res = (await PATCH(request([
      { id: 'mod-1', pricing: { seat: 10 } },
      { id: 'mod-2', pricing: { seat: 20 } },
    ]), {} as never)) as NextResponse;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 2 });
    expect(h.audits).toHaveLength(1);
  });

  it('rejects and audits no success when an UPDATE matched zero rows', async () => {
    h.executeResults = [
      { rowCount: 1, rows: [{ id: 'mod-1' }] },
      { rowCount: 0, rows: [] },
    ];
    const res = (await PATCH(request([
      { id: 'mod-1', pricing: { seat: 10 } },
      { id: 'not-installed', pricing: { seat: 20 } },
    ]), {} as never)) as NextResponse;

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, moduleId: 'not-installed' });
    expect(h.audits).toHaveLength(0);
  });
});
