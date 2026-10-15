/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2560 — the integrations Active/Disabled toggle 500ed forever.
 *
 * `PATCH /api/tenant/plugin-engine` guarded on `body['enabled'] !== undefined`
 * but assigned `body['isActive']`, a key no caller sends (the only caller,
 * `app/tenant/integrations/page.tsx`, posts `{ id, enabled }`). The update set
 * became `{ isActive: undefined }`, drizzle threw while building the query, and
 * the UI showed "Failed" on every toggle attempt.
 *
 * The assertions here are on the object handed to `db.update().set()` — the
 * exact spot where `undefined` used to land. A route that regresses to reading
 * a wire name nobody sends produces `{ isActive: undefined }` again, which is
 * what these cases reject.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextRequest as NextRequestCtor } from 'next/server';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';
const ROW_ID = '30000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-15T00:00:00.000Z');

const harness = vi.hoisted(() => ({
  state: {
    updateCalls: [] as unknown[],
  },
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => Promise.resolve([{ config: null }]);
      return chain;
    },
    update: () => ({
      set: (patch: unknown) => {
        harness.state.updateCalls.push(patch);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: ROW_ID, updatedAt: NOW }]),
          }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/middleware')>();
  return {
    ...actual,
    // api_key auth: CSRF stays real but is exempted by authMethod, so this
    // file tests the toggle mapping alone. CSRF itself is pinned in
    // plugin-engine-csrf-2561.test.ts.
    requireAuth: vi.fn(async () => ({
      tenantId: TENANT_ID,
      userId: USER_ID,
      isAdmin: true,
      user: { email: 'rep@example.com' },
      authMethod: 'api_key',
    })),
  };
});

vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function patchBody(body: Record<string, unknown>): NextRequest {
  return new NextRequestCtor('http://localhost/api/tenant/plugin-engine', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function callPATCH(body: Record<string, unknown>) {
  const mod = await import('@/app/api/tenant/plugin-engine/route');
  const res = await (mod.PATCH as unknown as (r: NextRequest) => Promise<Response>)(patchBody(body));
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('plugin-engine PATCH maps the `enabled` wire name to is_active (#2560)', () => {
  beforeEach(() => {
    harness.state.updateCalls = [];
  });

  it('PATCH { enabled: false } writes isActive:false — the exact call the toggle page makes', async () => {
    const res = await callPATCH({ id: ROW_ID, enabled: false });
    expect(res.status).toBe(200);
    expect(harness.state.updateCalls).toHaveLength(1);
    expect(harness.state.updateCalls[0]).toEqual({ isActive: false });
  });

  it('PATCH { enabled: true } writes isActive:true', async () => {
    const res = await callPATCH({ id: ROW_ID, enabled: true });
    expect(res.status).toBe(200);
    expect(harness.state.updateCalls[0]).toEqual({ isActive: true });
  });

  it('PATCH { enabled: false, name } updates both, never an undefined isActive', async () => {
    const res = await callPATCH({ id: ROW_ID, name: 'Renamed', enabled: false });
    expect(res.status).toBe(200);
    const patch = harness.state.updateCalls[0] as Record<string, unknown>;
    expect(patch['name']).toBe('Renamed');
    expect(patch['isActive']).toBe(false);
    expect(patch).not.toHaveProperty('enabled');
  });

  it('PATCH without `enabled` leaves is_active untouched', async () => {
    const res = await callPATCH({ id: ROW_ID, name: 'Only renamed' });
    expect(res.status).toBe(200);
    const patch = harness.state.updateCalls[0] as Record<string, unknown>;
    expect('isActive' in patch).toBe(false);
  });
});
