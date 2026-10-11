/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2560 — `PATCH /api/tenant/plugin-engine` guarded on `body['enabled']` (the key
 * the only caller sends) and then assigned from `body['isActive']` (a key no
 * caller has ever sent), so the integrations Active/Disabled toggle produced
 * `{ isActive: undefined }`, drizzle threw `No values to set`, and `apiError`
 * answered 500 *and paged* — for a button that had never once worked.
 *
 * Part A pins what drizzle actually does with those payloads, measured offline:
 * a real `drizzle()` client over a `pg.Pool` that is never connected, so
 * `.toSQL()` runs the same `mapUpdateSet` the server would and no database is
 * required. That is the evidence that the fix is a property-name bug and not a
 * mapping bug — `set({ isActive: false })` renders `set "is_active" = $1`
 * perfectly on the broken build too.
 *
 * Part B drives the handler and asserts on the object it hands to `.set()`,
 * because the two failure shapes are different: toggle-only threw, and
 * toggle-plus-config answered `success: true` for a half-applied write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integrations } from '@/drizzle/schema';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';

let setPayloads: Record<string, unknown>[] = [];
let updateCalls = 0;

const mockDb = {
  update: vi.fn(() => {
    updateCalls += 1;
    const builder: Record<string, unknown> = {};
    builder['set'] = (payload: Record<string, unknown>) => {
      setPayloads.push(payload);
      return builder;
    };
    builder['where'] = () => builder;
    builder['returning'] = () => Promise.resolve([{ id: 'integration-1', updatedAt: new Date(0) }]);
    return builder;
  }),
  insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })) })),
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
  query: {},
};

const mockRequireAuth = vi.fn();

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(() => undefined) }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(() => undefined) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

function patchReq(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/tenant/plugin-engine'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
}

async function patch(body: unknown) {
  const { PATCH } = await import('@/app/api/tenant/plugin-engine/route');
  return PATCH(patchReq(body)) as Promise<{ status: number; json: () => Promise<unknown> }>;
}

describe('#2560 — what drizzle does with the payloads this route used to build', () => {
  // Never connected: `new Pool()` opens no socket until a query runs, and
  // `.toSQL()` runs `mapUpdateSet` — the exact code that threw in production.
  const db = drizzle(new Pool({ connectionString: 'postgres://unused:unused@127.0.0.1:1/unused' }));
  const build = (set: Record<string, unknown>) => {
    try {
      return { sql: db.update(integrations).set(set as never).toSQL().sql };
    } catch (err) {
      return { thrown: (err as Error).message };
    }
  };

  it('throws "No values to set" for the payload the buggy line produced', () => {
    // `{ isActive: undefined }` is what `{ id, enabled: false }` became, because
    // the guard read `enabled` and the assignment read `isActive`.
    expect(build({ isActive: undefined })).toEqual({ thrown: 'No values to set' });
  });

  it('renders is_active correctly when the value is actually assigned', () => {
    // The column mapping was never the bug: the property name was.
    expect(build({ isActive: false }).sql).toContain('set "is_active" = $1');
    expect(build({ isActive: true }).sql).toContain('set "is_active" = $1');
  });

  it('silently DROPS the flag when another field is present — the half-applied write', () => {
    // This is the worse of the two shapes: no throw, `success: true`, and the
    // toggle never happens.
    const sql = build({ name: 'Renamed', isActive: undefined }).sql;
    expect(sql).toBe('update "integrations" set "name" = $1');
    expect(sql).not.toContain('is_active');
  });
});

describe('#2560 — PATCH /api/tenant/plugin-engine assigns the field it guards on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPayloads = [];
    updateCalls = 0;
    mockRequireAuth.mockResolvedValue({
      userId: USER_A,
      tenantId: TENANT_A,
      roleSlug: 'admin',
      permissions: {},
      isAdmin: true,
      isSuperAdmin: false,
    });
  });

  it('toggle OFF writes isActive:false — the key the page sends', async () => {
    // `app/tenant/integrations/page.tsx:61` posts exactly `{ id, enabled }`.
    const res = await patch({ id: 'integration-1', enabled: false });
    expect(res.status).toBe(200);
    expect(updateCalls).toBe(1);
    expect(setPayloads[0]).toEqual({ isActive: false });
  });

  it('toggle ON writes isActive:true', async () => {
    const res = await patch({ id: 'integration-1', enabled: true });
    expect(res.status).toBe(200);
    expect(setPayloads[0]).toEqual({ isActive: true });
  });

  it('accepts the sibling route\'s spellings too', async () => {
    // `PATCH /api/tenant/integrations/[id]` reads `is_active` off the body, so a
    // client that learned the wire shape there must not silently no-op here.
    await patch({ id: 'integration-1', isActive: false });
    expect(setPayloads[0]).toEqual({ isActive: false });
    await patch({ id: 'integration-1', is_active: false });
    expect(setPayloads[1]).toEqual({ isActive: false });
  });

  it('the guarded key wins when both spellings arrive', async () => {
    // Pins the guard/assignment pairing: reading a different key than the one
    // checked is the whole bug, and this is the shape that hid it.
    await patch({ id: 'integration-1', enabled: false, isActive: true });
    expect(setPayloads[0]).toEqual({ isActive: false });
  });

  it('answers 400 instead of 500 when nothing was sent to change', async () => {
    // `{ id }` only — previously `{}` reached drizzle and threw. A client-input
    // answer, not a server fault: `apiError` pages on any status >= 500.
    const res = await patch({ id: 'integration-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no fields to update' });
    expect(updateCalls).toBe(0);
  });

  it('400s on a falsy-only body as well, and never touches the database', async () => {
    // `{ enabled: undefined }` is `undefined` in JSON terms; `{ name: '' }` is
    // falsy and was never assigned. Both used to be a 500 plus a page.
    const res = await patch({ id: 'integration-1', name: '' });
    expect(res.status).toBe(400);
    expect(updateCalls).toBe(0);
  });

  it('name + toggle in one request applies both', async () => {
    const res = await patch({ id: 'integration-1', name: 'Renamed', enabled: false });
    expect(res.status).toBe(200);
    expect(setPayloads[0]).toEqual({ name: 'Renamed', isActive: false });
  });

  it('config + toggle applies BOTH — the half-applied write cannot recur', async () => {
    const res = await patch({
      id: 'integration-1',
      config: { url: 'https://example.test/hook' },
      enabled: true,
    });
    expect(res.status).toBe(200);
    expect(setPayloads[0]).toEqual({
      config: { url: 'https://example.test/hook' },
      isActive: true,
    });
  });

  it('still requires an id before anything else', async () => {
    const res = await patch({ enabled: false });
    expect(res.status).toBe(400);
    expect(updateCalls).toBe(0);
  });
});
