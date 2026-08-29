/**
 * End-to-end proof that a REAL, converted production route file runs its whole
 * handler body inside the per-request pinned connection scope (#1615 — review v2
 * follow-up).
 *
 * The v2 review noted that while the withApiRoute unit test drives a synthetic
 * handler, "no converted production route is exercised" — so a regression in a
 * specific converted route's export form (e.g. accidentally reverting it to a
 * bare `export async function`) would not be caught. This test closes that gap
 * by importing the ACTUAL exported GET from
 * app/api/tenant/analytics/stats/route.ts and asserting that at the point the
 * route runs its own logic (here, its requireAuth call), a client IS pinned.
 *
 * FAIL-WITHOUT-FIX / PASS-WITH-FIX
 * --------------------------------
 * We spy on the REAL withPinnedConnection primitive (only pg pool.connect is
 * mocked) and on requireAuth. Inside the requireAuth mock — which the route
 * calls as the first thing in its body — we snapshot getPinnedClient(). On the
 * pre-fix code the route was `export async function GET(...)` with no wrapper,
 * so its body ran OUTSIDE any pin and getPinnedClient() would be undefined at
 * that point → the `toBe(fakeClient)` assertion FAILS. With the route wrapped in
 * withApiRoute the pin encloses the whole body → it PASSES. If someone reverts
 * the route's export form, this test fails, catching the regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeClient = {
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
};

// Mock ONLY the pg pool so the real withPinnedConnection can "acquire" a fake
// client without a live database. The ALS scope, getPinnedClient, the wrapper
// and the route file itself are all the real implementation.
vi.mock('../../lib/db/pool', () => ({
  getPool: vi.fn(() => ({
    connect: vi.fn(async () => fakeClient),
  })),
}));

// requireAuth is the first call in the route body. We capture the pinned client
// at that moment (proves the route body runs inside the pin) and return a
// minimal auth context so the route proceeds to its NextResponse.json.
let pinnedWhenRouteRan: unknown = 'sentinel';
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => {
    const { getPinnedClient } = await import('../../lib/db/request-connection');
    pinnedWhenRouteRan = getPinnedClient();
    return { tenantId: 't-1', userId: 'u-1' };
  }),
}));

describe('a real converted route runs inside the pinned scope (#1615)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PGBOUNCER_ENABLED;
    pinnedWhenRouteRan = 'sentinel';
  });

  it('app/api/tenant/analytics/stats GET pins a client for its whole body', async () => {
    // Import the ACTUAL production route export (post-conversion form).
    const route = await import('../../app/api/tenant/analytics/stats/route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    const res = await route.GET(
      { url: 'http://localhost/api/tenant/analytics/stats' } as never,
      undefined as never
    );

    // The route's body (its requireAuth call) ran while a client was pinned.
    // FAILS on the pre-fix bare-export route (undefined at that point).
    expect(pinnedWhenRouteRan).toBe(fakeClient);
    // Response is preserved unchanged by the wrapper.
    expect(res).toBeDefined();
    const body = await (res as Response).json();
    expect(body.data).toBeDefined();
    // The pinned client was released once the handler returned (scope closed).
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(getPinnedClient()).toBeUndefined();
  });
});
