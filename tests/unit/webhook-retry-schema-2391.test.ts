/**
 * #2391 — POST /api/tenant/webhooks/retry must execute, and must only ever send
 * to a webhook that is still alive and enabled.
 *
 * The handler used to query `webhook_deliveries`, which has none of the columns
 * it referenced (`url`, `headers`, `attempts`, `last_attempt_at`,
 * `delivered_at`, `error_message`): Postgres answered 42703 for every input.
 * These tests assert against the *rendered* SQL of the real drizzle schema, so
 * a future column rename fails CI here instead of on the first retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles stand in for Drizzle's builder chain
type Any = any;

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const USER = '22222222-2222-4222-8222-222222222222';
const QUEUE_ID = '44444444-4444-4444-8444-444444444444';
const HOOK_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'whsec_test_secret';

const dialect = new PgDialect();
const render = (node: unknown) => dialect.sqlToQuery(node as Any).sql;
const paramsOf = (node: unknown) => dialect.sqlToQuery(node as Any).params;

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ kind: string; table: unknown; where?: unknown; set?: unknown }>,
  // Which rows each SELECT answers, chosen by the table it reads from.
  rows: { webhookQueue: [] as unknown[], integrations: [] as unknown[] },
  sent: [] as Array<{ url: string; init: Any }>,
  // What an UPDATE ... RETURNING answers. `[]` means "the write matched no row",
  // which the handler has to be able to observe. Reset per case in beforeEach,
  // because this object survives across tests in the file.
  returning: [{ id: 'written' }] as unknown[],
  respond: { ok: true, status: 200 } as { ok: boolean; status: number },
  throwKind: null as string | null,
}));

function makeChain(kind: string, table: unknown): Any {
  let where: unknown;
  let set: unknown;
  const record = () => h.nodes.push({ kind, table, where, set });
  const self: Any = {
    from: (t: unknown) => makeChain(kind, t),
    where: (w: unknown) => { where = w; return self; },
    set: (s: unknown) => { set = s; return self; },
    limit: () => self,
    orderBy: () => self,
    returning: () => { record(); return Promise.resolve(h.returning); },
    then: (res: Any, rej?: Any) => {
      record();
      const rows = kind === 'select'
        ? (table === webhookQueue ? h.rows.webhookQueue : h.rows.integrations)
        : [{}];
      return Promise.resolve(rows).then(res, rej);
    },
    catch: (rej: Any) => Promise.resolve([]).catch(rej),
  };
  return self;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => { const c = makeChain('select', undefined); c.from = (t: unknown) => makeChain('select', t); return c; },
    update: (t: unknown) => makeChain('update', t),
    insert: (t: unknown) => makeChain('insert', t),
    // Raw SQL is how this endpoint broke: `db.execute(sql`…`)` is invisible to
    // the compiler, so a renamed column only shows up at runtime. Recording the
    // call lets a test fail the moment anyone reaches for it again here.
    execute: (node: unknown) => { h.nodes.push({ kind: 'execute', table: undefined, where: node }); return Promise.resolve({ rows: [] }); },
    query: {},
  },
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T, >(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ userId: USER, tenantId: TENANT, email: 'a@b.com', isAdmin: true, isSuperAdmin: false }),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: (req: Request) => Promise.resolve(req.json().catch(() => ({}))),
}));
vi.mock('@/lib/errors-server', () => ({ logError: () => Promise.resolve(undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }),
}));

// The real SsrfBlockedError class must come through, or the blocked-target
// branch is untestable; only the socket is faked.
vi.mock('@/lib/security/ssrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ssrf')>();
  return {
    ...actual,
    safeFetch: async (url: string, init: Any) => {
      h.sent.push({ url, init });
      if (h.throwKind === 'ssrf') throw new actual.SsrfBlockedError('private address');
      if (h.throwKind === 'network') throw new Error('fetch failed: ECONNREFUSED');
      return new Response(h.respond.ok ? 'ok' : 'nope', { status: h.respond.status });
    },
  };
});

const queueRow = (over: Any = {}) => ({
  id: QUEUE_ID,
  webhookId: HOOK_ID,
  url: 'https://hooks.example/crm',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-NuCRM-Event': 'deal.won', 'X-NuCRM-Delivery': 'stale-delivery-id', 'X-NuCRM-Signature': 'sha256=stale' },
  payload: { event: 'deal.won', data: { id: 'deal-1' } },
  status: 'failed',
  attempt: 1,
  ...over,
});
const parentRow = (over: Any = {}) => ({
  id: HOOK_ID, isActive: true, deletedAt: null, config: { url: 'https://hooks.example/crm', secret: SECRET },
  ...over,
});

function req(body: unknown) {
  return new Request('http://x/api/tenant/webhooks/retry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
const call = async (body: unknown) => {
  const { POST } = await import('@/app/api/tenant/webhooks/retry/route');
  return POST(req(body));
};

function stmts(kind: string, table: unknown) {
  const found = h.nodes.filter((n) => n.kind === kind && n.table === table);
  expect(found.length, `expected at least one ${kind} against the expected table`).toBeGreaterThan(0);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.nodes = [];
  h.rows = { webhookQueue: [queueRow()], integrations: [parentRow()] };
  h.sent = [];
  h.returning = [{ id: 'written' }];
  h.respond = { ok: true, status: 200 };
  h.throwKind = null;
});

describe('the retry read targets the table that has the columns', () => {
  it('reads webhook_queue, scoped to the tenant, for a retryable status only', async () => {
    await call({ delivery_id: QUEUE_ID });
    const read = stmts('select', webhookQueue)[0];
    const sql = render(read.where);
    expect(sql).toMatch(/"?webhook_queue"?\."?id"?\s*=/i);
    expect(sql).toMatch(/"?webhook_queue"?\."?tenant_id"?\s*=/i);
    expect(sql).toMatch(/"?webhook_queue"?\."?status"?\s+in\s*\(/i);
    // 'error' was the old filter and nothing ever wrote it.
    expect(paramsOf(read.where)).toContain('failed');
    expect(paramsOf(read.where)).toContain('dead_letter');
    expect(paramsOf(read.where)).not.toContain('error');
    // Never a cross-tenant read: the tenant id is a bound parameter.
    expect(paramsOf(read.where)).toContain(TENANT);
  });

  it('never names webhook_deliveries, whose columns the old SQL did not have', async () => {
    await call({ delivery_id: QUEUE_ID });
    expect(
      h.nodes.filter((n) => n.kind === 'execute'),
      'raw SQL is what let this endpoint drift from the schema: tsc cannot see inside sql`…`'
    ).toHaveLength(0);
    expect(h.nodes.map((n) => render(n.where ?? 'x')).join('\n')).not.toMatch(/webhook_deliveries/i);
  });

  it('404s an id it cannot resolve, and sends nothing', async () => {
    h.rows.webhookQueue = [];
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(404);
    expect(h.sent, 'a 404 must not have POSTed anywhere').toHaveLength(0);
    expect(h.nodes.filter((n) => n.kind === 'update')).toHaveLength(0);
  });

  it('400s without an id', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(h.sent).toHaveLength(0);
  });
});

describe('the parent webhook still has to be worth delivering to', () => {
  it('refuses a deleted webhook instead of undoing the delete', async () => {
    h.rows.integrations = [parentRow({ deletedAt: new Date() })];
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(410);
    expect(h.sent).toHaveLength(0);
    expect(h.nodes.filter((n) => n.kind === 'update')).toHaveLength(0);
  });

  it('refuses a disabled webhook and leaves the queue row alone', async () => {
    h.rows.integrations = [parentRow({ isActive: false })];
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(409);
    expect(h.sent).toHaveLength(0);
  });

  it('treats a parent from another tenant as gone', async () => {
    // The parent read is tenant-scoped, so another tenant's integration is not
    // found at all rather than silently approving the send.
    h.rows.integrations = [];
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(410);
    expect(h.sent).toHaveLength(0);
    const parentRead = stmts('select', integrations)[0];
    expect(render(parentRead.where)).toMatch(/"?integrations"?\.("?tenant_id"?|"?id"?)?/i);
    expect(paramsOf(parentRead.where)).toContain(TENANT);
    expect(paramsOf(parentRead.where)).not.toContain(OTHER);
  });
});

describe('a successful retry', () => {
  it('writes delivered with a tenant predicate on the update', async () => {
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('delivered');

    const upd = stmts('update', webhookQueue)[0];
    expect(upd.set).toMatchObject({ status: 'delivered', responseStatus: 200 });
    expect(render(upd.where)).toMatch(/"?webhook_queue"?\.("?tenant_id"?|"?id"?)\s*=/i);
    expect(paramsOf(upd.where)).toContain(TENANT);
    expect(paramsOf(upd.where)).toContain(QUEUE_ID);
  });

  it('re-signs the body it actually sends, and gives the delivery a new id', async () => {
    await call({ delivery_id: QUEUE_ID });
    expect(h.sent).toHaveLength(1);
    const { url, init } = h.sent[0]!;
    expect(url).toBe('https://hooks.example/crm');

    const expected = 'sha256=' + createHmac('sha256', SECRET).update(init.body as string).digest('hex');
    expect(init.headers['X-NuCRM-Signature']).toBe(expected);
    expect(init.headers['X-NuCRM-Delivery']).not.toBe('stale-delivery-id');
    // The stored event header is still replayed so the receiver sees the same event.
    expect(init.headers['X-NuCRM-Event']).toBe('deal.won');
  });

  it('drops the signature when the webhook has no secret any more', async () => {
    h.rows.integrations = [parentRow({ config: { url: 'https://hooks.example/crm' } })];
    await call({ delivery_id: QUEUE_ID });
    expect(h.sent[0]!.init.headers['X-NuCRM-Signature']).toBeUndefined();
  });
});

describe('a retry that fails', () => {
  it('keeps a failed row on the automatic track with the shared backoff', async () => {
    h.respond = { ok: false, status: 500 };
    const before = Date.now();
    const res = await call({ delivery_id: QUEUE_ID });
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.response_status).toBe(500);

    const upd = stmts('update', webhookQueue)[0];
    expect(upd.set).toMatchObject({ status: 'failed', responseStatus: 500, attempt: 2 });
    const next = (upd.set as { nextRetryAt: Date }).nextRetryAt;
    expect(next.getTime()).toBeGreaterThan(before);
    expect(next.getTime()).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 5000);
  });

  it('puts a dead-lettered row straight back on the shelf after one manual shot', async () => {
    h.rows.webhookQueue = [queueRow({ status: 'dead_letter', attempt: 5 })];
    h.respond = { ok: false, status: 503 };
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('dead_letter');

    const upd = stmts('update', webhookQueue)[0];
    expect(upd.set).toMatchObject({ status: 'dead_letter', nextRetryAt: null });
  });

  it('dead-letters an SSRF-blocked target and reports it as a failed retry', async () => {
    h.throwKind = 'ssrf';
    const res = await call({ delivery_id: QUEUE_ID });
    const body = await res.json();
    expect(body.data.status).toBe('dead_letter');
    expect(body.error).toMatch(/SSRF/i);

    const upd = stmts('update', webhookQueue)[0];
    expect((upd.set as { errorMessage: string }).errorMessage).toMatch(/Blocked by SSRF protection/);
    expect((upd.set as { nextRetryAt: unknown }).nextRetryAt).toBeNull();
  });

  it('records a transport failure on the normal backoff track, not as a broken endpoint', async () => {
    h.throwKind = 'network';
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.error).toMatch(/ECONNREFUSED/);

    const set = stmts('update', webhookQueue)[0].set as Record<string, unknown>;
    expect(set).toMatchObject({ status: 'failed', attempt: 2, responseStatus: null });
    expect((set.nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('404s when the row was purged between the read and the write', async () => {
    // Retention hard-deletes queue rows (webhook_queue has no deleted_at), so a
    // 0-row update is a real outcome and must not be reported as a retry.
    h.returning = [];
    const res = await call({ delivery_id: QUEUE_ID });
    expect(res.status).toBe(404);
    expect(h.sent, 'it did send; only the bookkeeping failed').toHaveLength(1);
    const body = await res.json();
    expect(body.error).toMatch(/no longer exists/i);
  });
});
