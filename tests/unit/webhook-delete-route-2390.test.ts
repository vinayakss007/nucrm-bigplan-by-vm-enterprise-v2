/**
 * #2390 — the webhook HTTP surface must treat a tombstone as gone.
 *
 * `DELETE /api/tenant/webhooks/[id]` writes `integrations.deleted_at` and nothing
 * else, so:
 *   - the list kept showing removed webhooks (and let PATCH bring one back),
 *   - the DELETE answered `200 {ok:true}` even when it wrote nothing,
 *   - and every `failed` queue row belonging to it stayed retryable forever,
 *     because the FK that would have removed them is `ON DELETE cascade` and a
 *     tombstone is an UPDATE.
 *
 * Statements are asserted as rendered SQL against the real schema; the DELETE
 * handler's two writes are asserted as *recorded calls*, so "it ran the drain"
 * cannot be faked by a mock's return value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain
type Any = any;

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const HOOK = '33333333-3333-4333-8333-333333333333';

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ kind: string; table: unknown; where?: unknown; set?: unknown }>,
  selectRows: [] as unknown[],
  updateRows: [] as unknown[],
  findFirst: null as unknown,
  findFirstWhere: undefined as unknown,
  txUsed: false,
}));

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as Any).sql;

function makeChain(kind: string, table: unknown): Any {
  let where: unknown;
  let set: unknown;
  const record = () => h.nodes.push({ kind, table, where, set });
  const self: Any = {
    from: (t: unknown) => makeChain(kind, t),
    where: (w: unknown) => { where = w; return self; },
    set: (s: unknown) => { set = s; return self; },
    values: () => self,
    orderBy: () => self,
    limit: () => self,
    offset: () => self,
    groupBy: () => self,
    returning: () => { record(); return Promise.resolve(h.updateRows); },
    then: (res: Any, rej?: Any) => {
      record();
      return Promise.resolve(kind.endsWith('update') ? h.updateRows : h.selectRows).then(res, rej);
    },
    catch: (rej: Any) => Promise.resolve(h.selectRows).catch(rej),
  };
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => { const c = makeChain('select', undefined); c.from = (t: unknown) => makeChain('select', t); return c; },
    update: (t: unknown) => makeChain('update', t),
    insert: (t: unknown) => makeChain('insert', t),
    transaction: (fn: Any) => {
      h.txUsed = true;
      return fn({
        select: () => { const c = makeChain('tx.select', undefined); c.from = (t: unknown) => makeChain('tx.select', t); return c; },
        update: (t: unknown) => makeChain('tx.update', t),
        insert: (t: unknown) => makeChain('tx.insert', t),
      });
    },
    query: { integrations: { findFirst: (opts: Any) => { h.findFirstWhere = opts?.where; return Promise.resolve(h.findFirst); } } },
  },
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T, >(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: USER, tenantId: TENANT, email: 'a@b.com', isAdmin: true, isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: (req: Request) => Promise.resolve(req.json().catch(() => ({}))),
  // `validateBody` is synchronous in the real module; returning a Promise here
  // would make `validated.data` undefined and turn the route into a 500.
  validateBody: (_schema: Any, body: Any) => ({ data: body ?? {} }),
}));
vi.mock('@/lib/api/schemas', () => ({
  createWebhookSchema: {}, updateWebhookSchema: {},
}));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: () => Promise.resolve(null) }));
vi.mock('@/lib/security/ssrf', () => ({ checkSaveTimeUrlSafety: () => null }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }),
}));

function req(url: string, init?: Any) {
  return new Request(url, init) as unknown as NextRequest;
}
const params = { params: Promise.resolve({ id: HOOK }) };

function stmts(kind: string, table: unknown) {
  const found = h.nodes.filter((n) => n.kind === kind && n.table === table);
  expect(found.length, `expected at least one ${kind} against the expected table`).toBeGreaterThan(0);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.nodes = [];
  h.selectRows = [];
  h.updateRows = [];
  h.findFirst = null;
  h.findFirstWhere = undefined;
  h.txUsed = false;
});

describe('GET /api/tenant/webhooks (#2390)', () => {
  it('hides tombstones from both the page and the total', async () => {
    h.selectRows = [{ count: 0 }];
    const { GET } = await import('@/app/api/tenant/webhooks/route');
    const res = await GET(req('http://x/api/tenant/webhooks'));
    expect(res.status).toBe(200);

    const againstIntegrations = stmts('select', integrations);
    expect(againstIntegrations.length, 'count and list should each be one statement').toBe(2);
    for (const node of againstIntegrations) {
      const sql = render(node.where);
      expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
      expect(sql).toMatch(/"?tenant_id"?\s*=/i);
    }
  });
});

describe('PATCH /api/tenant/webhooks/[id] (#2390)', () => {
  it('excludes tombstones from the read that decides whether the row exists', async () => {
    h.findFirst = null;
    const { PATCH } = await import('@/app/api/tenant/webhooks/[id]/route');
    await PATCH(req('http://x/api/tenant/webhooks/' + HOOK, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_active: true }),
    }), params);
    // A mocked findFirst cannot answer "was the deleted row visible?", so assert
    // the predicate the read actually passed down to the database.
    const sql = render(h.findFirstWhere);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
  });

  it('404s a tombstone instead of reviving it', async () => {
    h.findFirst = null;   // the read filters the tombstone out
    const { PATCH } = await import('@/app/api/tenant/webhooks/[id]/route');
    const res = await PATCH(req('http://x/api/tenant/webhooks/' + HOOK, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_active: true }),
    }), params);
    expect(res.status).toBe(404);
    // Nothing may be written for a row the read already rejected.
    expect(h.nodes.filter((n) => n.kind === 'update')).toHaveLength(0);
  });

  it('scopes the write itself, so a delete landing mid-PATCH cannot be undone', async () => {
    h.findFirst = { id: HOOK, tenantId: TENANT, type: 'webhook', name: 'w', config: {}, isActive: true };
    h.updateRows = [{ id: HOOK, tenantId: TENANT, config: {}, name: 'w' }];
    const { PATCH } = await import('@/app/api/tenant/webhooks/[id]/route');
    await PATCH(req('http://x/api/tenant/webhooks/' + HOOK, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'renamed' }),
    }), params);

    const upd = stmts('update', integrations)[0];
    const sql = render(upd.where);
    expect(sql).toMatch(/"?deleted_at"?\s+is null/i);
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
  });
});

describe('DELETE /api/tenant/webhooks/[id] (#2390)', () => {
  async function del(updateRows: unknown[]) {
    h.updateRows = updateRows;
    const { DELETE } = await import('@/app/api/tenant/webhooks/[id]/route');
    return DELETE(req('http://x/api/tenant/webhooks/' + HOOK, { method: 'DELETE' }), params);
  }

  it('retires the queue in the same transaction as the tombstone', async () => {
    const res = await del([{ id: HOOK }, { id: 'q1' }, { id: 'q2' }]);
    expect(res.status).toBe(200);
    expect(h.txUsed, 'the two writes must not be separate statements').toBe(true);

    const tombstone = stmts('tx.update', integrations)[0];
    expect(render(tombstone.where)).toMatch(/"?deleted_at"?\s+is null/i);

    const drain = stmts('tx.update', webhookQueue)[0];
    expect(drain.set).toMatchObject({ status: 'dead_letter', nextRetryAt: null });
    const sql = render(drain.where);
    // Tenant-scoped on the write, not only on a read: RLS must not be the only
    // thing between this UPDATE and another tenant's rows.
    expect(sql).toMatch(/"?tenant_id"?\s*=/i);
    expect(sql).toMatch(/"?webhook_id"?\s*=/i);
    expect(sql).toMatch(/"?status"?\s*=\s*\$/i);
  });

  it('reports how many queued deliveries it retired', async () => {
    const res = await del([{ id: HOOK }, { id: 'q1' }]);
    const body = await res.json();
    // two rows came back: the tombstone's RETURNING plus one retired queue row
    expect(body.ok).toBe(true);
    expect(typeof body.retired_deliveries).toBe('number');
  });

  it('404s when there was no live webhook to delete, and drains nothing', async () => {
    // The tombstone UPDATE matches nothing -> returning [] -> the drain must not run.
    h.nodes = [];
    const { DELETE } = await import('@/app/api/tenant/webhooks/[id]/route');
    const res = await DELETE(req('http://x/api/tenant/webhooks/' + HOOK, { method: 'DELETE' }), params);
    expect(res.status).toBe(404);
    expect(h.nodes.filter((n) => n.kind === 'tx.update' && n.table === webhookQueue)).toHaveLength(0);
  });
});
