/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const fakeClient = {
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
};

const fakePool = {
  connect: vi.fn(async () => fakeClient),
};

vi.mock('../../lib/db/pool', () => ({
  getPool: vi.fn(() => fakePool),
}));

describe('Issue #3538: Lazy connection pinning in withApiRoute and requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PGBOUNCER_ENABLED;
  });

  it('unauthenticated 401 request NEVER checks out a pool connection', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    let clientSeenInside: unknown;
    const GET = withApiRoute(async (_req: NextRequest) => {
      clientSeenInside = getPinnedClient();
      // Simulate requireAuth returning 401 due to missing token
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    });

    const req = new NextRequest('http://localhost/api/tenant/contacts');
    const res = await GET(req, undefined as never);

    expect(res).toBeDefined();
    expect((res as Response).status).toBe(401);
    expect(clientSeenInside).toBeDefined();
    // CRITICAL: pool.connect was NEVER called — no connection exhaustion vector
    expect(fakePool.connect).not.toHaveBeenCalled();
    expect(fakeClient.query).not.toHaveBeenCalled();
    expect(fakeClient.release).not.toHaveBeenCalled();
    expect(getPinnedClient()).toBeUndefined();
  });

  it('early 400 validation rejection NEVER checks out a pool connection', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    const POST = withApiRoute(async (_req: NextRequest) => {
      // Simulate body validation failure before DB access
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    });

    const req = new NextRequest('http://localhost/api/tenant/contacts', { method: 'POST' });
    const res = await POST(req, undefined as never);

    expect((res as Response).status).toBe(400);
    expect(fakePool.connect).not.toHaveBeenCalled();
    expect(fakeClient.release).not.toHaveBeenCalled();
    expect(getPinnedClient()).toBeUndefined();
  });

  it('checks out connection lazily on the first query and releases it on exit', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { getPinnedClient } = await import('../../lib/db/request-connection');

    const GET = withApiRoute(async (_req: NextRequest) => {
      // Simulate authenticated route executing its first DB query
      const client = getPinnedClient();
      expect(fakePool.connect).not.toHaveBeenCalled();
      await (client as { query: (s: string) => Promise<unknown> }).query('SELECT 1');
      expect(fakePool.connect).toHaveBeenCalledTimes(1);
      return NextResponse.json({ data: 'ok' });
    });

    const req = new NextRequest('http://localhost/api/tenant/contacts');
    const res = await GET(req, undefined as never);

    expect((res as Response).status).toBe(200);
    expect(fakePool.connect).toHaveBeenCalledTimes(1);
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.current_tenant', ''")
    );
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
    expect(getPinnedClient()).toBeUndefined();
  });

  it('retains one single connection across multiple queries and nested scopes', async () => {
    const { withApiRoute } = await import('../../lib/api/with-api-route');
    const { withPinnedConnection, getPinnedClient } = await import('../../lib/db/request-connection');

    const GET = withApiRoute(async (_req: NextRequest) => {
      const client = getPinnedClient();
      // Nested pin scope (e.g. requireAuth wrapping)
      await withPinnedConnection(async () => {
        await (client as { query: (s: string) => Promise<unknown> }).query('SELECT query_1');
        await (client as { query: (s: string) => Promise<unknown> }).query('SELECT query_2');
      });
      return NextResponse.json({ data: 'ok' });
    });

    const req = new NextRequest('http://localhost/api/tenant/contacts');
    await GET(req, undefined as never);

    // Exactly one connection acquired and released
    expect(fakePool.connect).toHaveBeenCalledTimes(1);
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });
});
