/**
 * Unit proof that withApiRoute() runs the ENTIRE route handler body inside a
 * single pinned connection scope (#1615 — review v1 follow-up, issue #1/#2).
 *
 * WHY THIS MATTERS
 * ----------------
 * The review found that wrapping only requireAuth()/requireTenantCtx() leaves
 * the handler's own db queries running OUTSIDE any pinned scope — so RLS stays
 * non-functional for exactly the surface #1615 is about. withApiRoute() fixes
 * that by enclosing the whole handler body.
 *
 * FAIL-WITHOUT-FIX / PASS-WITH-FIX
 * --------------------------------
 * These tests assert that at the point the wrapped handler runs its "later db
 * query" (simulated by reading getPinnedClient()), a client IS pinned. On the
 * pre-fix code (bare `export async function GET`, no wrapper) the handler body
 * ran with NO pin, so getPinnedClient() would be undefined at that point and the
 * `toBeDefined()` assertion would FAIL. With withApiRoute the pin is present for
 * the whole body, so it PASSES. We use the REAL withPinnedConnection primitive
 * (only the pg pool.connect is mocked), not a stub, so this exercises the actual
 * wrapper wiring end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ONLY the pg pool so withPinnedConnection can "acquire" a fake client
// without a real database. Everything else (the ALS scope, getPinnedClient, the
// wrapper) is the real implementation.
const fakeClient = {
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
};

vi.mock('../../lib/db/pool', () => ({
  getPool: vi.fn(() => ({
    connect: vi.fn(async () => fakeClient),
  })),
}));

describe('withApiRoute pins the whole handler body (#1615)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PGBOUNCER_ENABLED;
  });

  it('a pinned client is present when the handler runs its later db query', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    let pinnedDuringAuth: unknown;
    let pinnedDuringHandlerQuery: unknown;

    const GET = withApiRoute(async () => {
      // Simulates requireAuth()'s setTenantContext running on the pinned client.
      pinnedDuringAuth = getPinnedClient();
      // Simulates the handler's OWN later db query (the #1615 surface). On the
      // unfixed code this ran outside any pin → getPinnedClient() === undefined.
      pinnedDuringHandlerQuery = getPinnedClient();
      return new Response('ok');
    });

    const res = await GET({} as never, undefined as never);

    // A client IS pinned for the whole body (undefined pre-fix). The pinned
    // client is a transparent serialization wrapper over the acquired client
    // (per-pinned-client query serialization), so it is not the fakeClient by
    // reference identity — assert it is defined and delegates to the fake.
    expect(pinnedDuringAuth).toBeDefined();
    expect(pinnedDuringHandlerQuery).toBeDefined(); // FAILS pre-fix (undefined)
    // The wrapper delegates .query() to the underlying fake client.
    await (pinnedDuringHandlerQuery as { query: (sql: string) => Promise<unknown> }).query('SELECT 1');
    expect(fakeClient.query).toHaveBeenCalledWith('SELECT 1');
    expect(res).toBeInstanceOf(Response);
  });

  it('releases the pinned client and resets GUCs after the handler returns', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    const GET = withApiRoute(async () => new Response('done'));
    await GET({} as never, undefined as never);

    // GUC reset issued and client released exactly once in the finally block.
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.current_tenant', ''")
    );
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    // Scope has closed: no pin leaks past the handler.
    expect(getPinnedClient()).toBeUndefined();
  });

  it('passes the request and route-context (params) through unchanged', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');

    const request = { url: 'http://x/y' };
    const context = { params: Promise.resolve({ id: 'abc' }) };
    let seenReq: unknown;
    let seenCtx: unknown;

    const GET = withApiRoute(async (req: unknown, ctx: { params: Promise<{ id: string }> }) => {
      seenReq = req;
      seenCtx = ctx;
      const { id } = await ctx.params;
      return new Response(id);
    });

    const res = await GET(request as never, context as never);

    expect(seenReq).toBe(request);
    expect(seenCtx).toBe(context);
    expect(await res.text()).toBe('abc');
  });

  it('propagates thrown errors while still releasing the pinned client', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');

    const boom = new Error('handler blew up');
    const GET = withApiRoute(async () => {
      throw boom;
    });

    await expect(GET({} as never, undefined as never)).rejects.toBe(boom);
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  it('pins the client under PgBouncer too (session pooling)', async () => {
    process.env.PGBOUNCER_ENABLED = 'true';
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    let pinnedInside: unknown = 'sentinel';
    const GET = withApiRoute(async () => {
      pinnedInside = getPinnedClient();
      return new Response('pgbouncer');
    });

    const res = await GET({} as never, undefined as never);

    // Pre-prod PgBouncer runs in SESSION pooling mode, so the pin applies
    // there too — otherwise the tenant GUC is lost between pool checkouts.
    expect(pinnedInside).toBeDefined();
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('pgbouncer');
  });

  it('records http_requests_total with normalized path and final status', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { metrics, exportPrometheusMetrics } = await import('../../lib/metrics');
    metrics.reset();

    const ok = withApiRoute(async () => new Response(null, { status: 201 }));
    await ok(new Request('http://x/api/tenant/contacts/42/notes', { method: 'GET' }) as never, undefined as never);
    const boom = withApiRoute(async () => { throw new Error('x'); });
    await expect(boom(new Request('http://x/api/tenant/deals/0f51db8c-1d42-4f4c-9be6-a5fbc5f7d31a', { method: 'DELETE' }) as never, undefined as never)).rejects.toThrow('x');

    const out = exportPrometheusMetrics();
    // Numeric and UUID segments collapse to [id] so series cardinality is
    // bounded by route shape; thrown handlers count as 500.
    expect(out).toContain('http_requests_total{method="GET",path="/api/tenant/contacts/[id]/notes",status="201"} 1');
    expect(out).toContain('http_requests_total{method="DELETE",path="/api/tenant/deals/[id]",status="500"} 1');
    metrics.reset();
  });

  it('maps Postgres uuid-cast failures on non-uuid ids to 404 (GET) / 400 (POST)', async () => {
    // Sentry NUCRM-Y/W/X class: ~30 [id] routes without isEntityId guards
    // used to answer 500 for /api/tenant/<thing>/foobar.
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const castErr = () => {
      const e = new Error('invalid input syntax for type uuid: "foobar"') as Error & { code: string };
      e.code = '22P02';
      return e;
    };
    const GET = withApiRoute(async () => { throw castErr(); });
    const POST = withApiRoute(async () => { throw castErr(); });

    const resGet = await GET(new Request('http://x/api/tenant/tasks/foobar', { method: 'GET' }) as never, undefined as never);
    expect(resGet!.status).toBe(404);
    expect(await resGet!.json()).toEqual({ error: 'Not found' });

    const resPost = await POST(new Request('http://x/api/tenant/tasks', { method: 'POST' }) as never, undefined as never);
    expect(resPost!.status).toBe(400);

    // Non-22P02 and non-uuid 22P02 errors must still propagate as 500s.
    const Other = withApiRoute(async () => {
      const e = new Error('invalid input syntax for type integer: "x"') as Error & { code: string };
      e.code = '22P02';
      throw e;
    });
    await expect(Other(new Request('http://x/api/tenant/tasks/1', { method: 'GET' }) as never, undefined as never)).rejects.toThrow();

    // Constraint escapes become proper client-error statuses too.
    const mk = (code: string, msg: string) => withApiRoute(async () => {
      const e = new Error(msg) as Error & { code: string };
      e.code = code;
      throw e;
    });
    const dup = await mk('23505', 'duplicate key value violates unique constraint "roles_name_tenant_key"')(
      new Request('http://x/api/tenant/roles', { method: 'POST' }) as never, undefined as never);
    expect(dup!.status).toBe(409);
    expect(await dup!.json()).toEqual({ error: 'Conflict: value already exists' });

    const fk = await mk('23503', 'violates foreign key constraint "tasks_contact_id_fkey"')(
      new Request('http://x/api/tenant/tasks', { method: 'PUT' }) as never, undefined as never);
    expect(fk!.status).toBe(400);
    expect(await fk!.json()).toEqual({ error: 'Invalid reference' });
  });

  it('pool checkout timeout fast-fails as 503 with Retry-After (#2122)', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const GET = withApiRoute(async () => {
      // Exact error text pg-pool throws when connectionTimeoutMillis elapses.
      throw new Error('timeout exceeded when trying to connect');
    });
    const res = await GET(
      new Request('http://x/api/tenant/contacts', { method: 'GET' }) as never, undefined as never);
    expect(res!.status).toBe(503);
    expect(res!.headers.get('retry-after')).toBe('2');
    expect(await res!.json()).toEqual({ error: 'Service temporarily overloaded, please retry' });
  });
});
