/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3290 — `worker.ts` ran tenant-scoped INSERT/SELECT/UPDATE on the bare pool.
 *
 * A job payload says *which* tenant it means by carrying a `tenantId` field. That is a claim, not a
 * check: `notifications`, `integrations` and `lead_warming_messages` all carry `tenant_isolation`
 * (0019 for the first, 0031 for the other two) whose USING/WITH CHECK arms compare `tenant_id` to
 * `current_setting('app.current_tenant')`, and `lib/db/pool.ts` clears every `app.*` GUC on acquire
 * AND release. So the pool connection a job runs on has no tenant, and:
 *
 *   - the `notifications` INSERT violates WITH CHECK and raises 42501 — measured in the issue, twice,
 *     and the job lands in the failed set after BullMQ's three attempts;
 *   - the `integrations` SELECT matches nothing, so lead warming takes the "no WhatsApp configured"
 *     branch, writes `failed` (also 0 rows), and returns `{sent:false}` as if it had tried;
 *   - the claim-then-send UPDATE at `worker.ts:324` matches 0 rows, which the code reads as
 *     "already processed" and logs as a skip. No WhatsApp message was ever dispatched.
 *
 * That last one is the reason this file exists at all: it is #3280's shape inside a background
 * process — a *success-looking* log line for work that did not happen — and there is no request
 * lifecycle here to pin a connection. The HTTP surface gets its tenant GUC from
 * `lib/db/request-connection.ts`; a BullMQ processor has nothing equivalent, so the context has to
 * be opened per job, out of the payload, by the handler.
 *
 * THE HARNESS, AND WHY IT IS BUILT THIS WAY
 * -----------------------------------------
 * `worker.ts` is importable: `bullmq`'s `Worker` is mocked to capture each processor, which then
 * runs against a real job object (the same trick `worker-email-result-2998.test.ts` uses). The DB is
 * a real `drizzle()` instance over a fake `pg` client, because the statement drizzle *sends* is what
 * Postgres evaluates — hand-waving the builder would let this test pass on a shape production never
 * sees. The fake client then interprets the rendered SQL the way the shipped policies do: a row is
 * visible only when the connection holds `app.current_tenant` equal to its `tenant_id`, and an INSERT
 * whose row does not satisfy that raises 42501. Nothing is mocked out of the failure path; the only
 * way a job gets its row written is by earning the privilege first.
 *
 * `lib/db/rls.ts` and `lib/notifications.ts` are NOT mocked. `withTenantContext` and the sanctioned
 * `createNotification` wrapper run for real, so "the handler obtains its handle from a tenant context"
 * is checked as behaviour rather than as a string in the file.
 *
 * Proprietary & confidential. NuCRM Enterprise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableName } from 'drizzle-orm';
import * as realSchema from '@/drizzle/schema';
import { notifications, integrations, leadWarmingMessages } from '@/drizzle/schema';

type Row = Record<string, unknown>;
type Call = { text: string; params: unknown[]; rowMode?: string };
type JobProcessor = (job: { id: string; data: Record<string, unknown> }) => Promise<unknown>;

const TENANT_A = '817bd1b1-1111-4111-8111-00000000000a';
const TENANT_B = '817bd1b1-2222-4222-8222-00000000000b';
const USER_1 = '27fa31df-3333-4333-8333-00000000000c';
const CAMPAIGN = '40000000-0000-4000-8000-000000000001';
const CONTACT = '50000000-0000-4000-8000-000000000002';

const H = vi.hoisted(() => ({
  processors: new Map<string, JobProcessor>(),
  /** Ordered log of what the pool was asked to do, so a test can read the transaction shape. */
  ops: [] as string[],
  calls: [] as Call[],
  rows: {} as Record<string, Row[]>,
  fetches: [] as { url: string; body: string }[],
}));

/**
 * Tables in play here that carry `tenant_isolation`. 0019 for `notifications`, 0031 for the other
 * two; both arms compare `tenant_id` with `current_setting('app.current_tenant')`, which is empty on
 * a pool connection.
 */
const TENANT_SCOPED = new Set(['notifications', 'integrations', 'lead_warming_messages']);

/** The privileges one connection currently holds. `''` means the GUC is not set. */
interface Conn { tenant: string }
const blank = (): Conn => ({ tenant: '' });
/** The pool as `lib/db/pool.ts` hands it out: nothing set, and never grantable from outside. */
const BARE: Conn = blank();

/** Stack of transaction connections; `begin` pushes, `commit`/`rollback` pops. */
let stack: Conn[] = [];
const current = (): Conn => stack[stack.length - 1] ?? BARE;

function normalize(input: unknown, values?: unknown[]): Call {
  const cfg = typeof input === 'string' ? { text: input } : (input as { text: string; rowMode?: string });
  return { text: cfg.text, params: values ?? [], rowMode: cfg.rowMode };
}

/** `"a"."b" as "c"` / `"b"` / `b` → the source column and the key it is returned under. */
function projection(fragment: string): { col: string; as: string } {
  const aliased = /\s+as\s+"([^"]+)"$/i.exec(fragment);
  const bare = fragment.replace(/\s+/g, ' ').trim();
  const parts = (aliased ? bare.slice(0, aliased.index) : bare).split('.');
  const col = (parts.pop() ?? '').replace(/"/g, '');
  return { col, as: aliased ? aliased[1] : col };
}

const eqConditions = (clause: string, params: unknown[]) =>
  [...clause.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)]
    .map((m) => ({ col: m[2], value: params[Number(m[3]) - 1] }));

/** The shipped USING arm, evaluated: a row is visible only to a connection holding its tenant. */
const visible = (conn: Conn, row: Row, table: string) =>
  !TENANT_SCOPED.has(table) || (conn.tenant !== '' && String(row['tenant_id']) === conn.tenant);

const grant = (conn: Conn, text: string, params: unknown[]) => {
  const m = /set_config\('app\.current_tenant', \$(\d+)/.exec(text);
  if (m) conn.tenant = String(params[Number(m[1]) - 1] ?? '');
  return /^select set_config/i.test(text);
};

function interpret(call: Call): Row[] | unknown[][] {
  const { text, params } = call;
  const conn = current();
  const flat = text.replace(/\s+/g, ' ').trim();
  H.calls.push(call);

  if (/^select set_config/i.test(flat)) {
    grant(conn, flat, params);
    H.ops.push('set_config:app.current_tenant');
    return [];
  }

  const insert = /^insert into "([a-z_]+)" \(([^)]*)\) values \(([^)]*)\)( returning (.*))?$/is.exec(flat);
  if (insert) {
    const table = insert[1]!;
    const cols = insert[2]!.split(',').map((c) => c.replace(/"/g, '').trim());
    const vals = insert[3]!.split(',').map((v) => v.trim());
    const row: Row = {};
    cols.forEach((col, i) => {
      const v = vals[i] ?? 'default';
      const bind = /\$(\d+)/.exec(v);
      if (bind) row[col] = params[Number(bind[1]) - 1];
      else if (v !== 'default') row[col] = v;
    });
    // WITH CHECK: the row the job claims to write must live in the tenant this connection holds.
    if (TENANT_SCOPED.has(table) && !(conn.tenant !== '' && String(row['tenant_id']) === conn.tenant)) {
      throw Object.assign(
        new Error(`new row violates row-level security policy for table "${table}"`),
        { code: '42501' },
      );
    }
    H.rows[table] ??= [];
    row['id'] ??= `${table}-${H.rows[table]!.length + 1}`;
    H.rows[table]!.push(row);
    H.ops.push(`insert:${table}`);
    return [];
  }

  const update = /^update "([a-z_]+)" set (.+?)( where (.+?))( returning (.+))?$/is.exec(flat)
    ?? /^update "([a-z_]+)" set (.+?)( returning (.+))?$/is.exec(flat);
  if (update) {
    const table = update[1]!;
    const setPairs = [...update[2]!.matchAll(/"([a-z_]+)" = \$(\d+)/g)]
      .map((m) => ({ col: m[1]!, value: params[Number(m[2]) - 1] }));
    const where = update[4] ?? '';
    const conds = eqConditions(where, params);
    const matched = (H.rows[table] ?? []).filter((r) =>
      visible(conn, r, table) && conds.every((c) => String(r[c.col]) === String(c.value)));
    for (const row of matched) {
      for (const s of setPairs) row[s.col] = s.value;
    }
    H.ops.push(`update:${table}:${matched.length}`);
    const returning = update[6];
    if (!returning) return [];
    const proj = returning.split(',').map(projection);
    return shape(matched, proj, call);
  }

  const select = /^select (.+?) from "([a-z_]+)"(?: where (.+?))?(?: order by .*)?(?: limit .*)?$/is.exec(flat);
  if (select) {
    const table = select[2]!;
    const conds = eqConditions(select[3] ?? '', params);
    const matched = (H.rows[table] ?? []).filter((r) =>
      visible(conn, r, table) && conds.every((c) => String(r[c.col]) === String(c.value)));
    H.ops.push(`select:${table}:${matched.length}`);
    const proj = select[1]!.split(',').map(projection);
    return shape(matched, proj, call);
  }

  // An unparsed statement must never answer "no rows": under this bug class, emptiness is exactly
  // what gets mistaken for success.
  throw new Error(`harness: cannot interpret statement: ${flat.slice(0, 200)}`);
}

function shape(rows: Row[], proj: { col: string; as: string }[], call: Call): Row[] | unknown[][] {
  if (call.rowMode === 'array') return rows.map((r) => proj.map(({ col }) => r[col]));
  return rows.map((r) => Object.fromEntries(proj.map(({ col, as }) => [as, r[col]])));
}

const fakeClient = {
  query: (input: unknown, values?: unknown[]) => {
    const call = normalize(input, values);
    const low = call.text.trim().toLowerCase();
    if (low === 'begin') { stack.push(blank()); H.ops.push('BEGIN'); return Promise.resolve({ rows: [], rowCount: 0 }); }
    if (low === 'commit' || low === 'rollback') { stack.pop(); H.ops.push(low.toUpperCase()); return Promise.resolve({ rows: [], rowCount: 0 }); }
    const rows = interpret(call);
    return Promise.resolve({ rows, rowCount: rows.length });
  },
};

// A real drizzle instance: whatever the handler builds, the pool sees the same SQL Postgres would.
const fakeDb = drizzle(fakeClient as never, { schema: realSchema });

vi.mock('@/drizzle/db', () => ({ db: fakeDb }));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function MockWorker(name: string, processor: JobProcessor) {
    H.processors.set(name, processor);
    return { on: vi.fn(), close: vi.fn(async () => {}), isRunning: () => true };
  }),
  QueueEvents: vi.fn(function MockQueueEvents() {
    return { on: vi.fn(), close: vi.fn(async () => {}) };
  }),
  Queue: vi.fn(function MockQueue() {
    return { getJob: async () => null, close: async () => {} };
  }),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return { on: vi.fn(), quit: vi.fn(async () => {}), disconnect: vi.fn(), set: vi.fn(async () => 'OK') };
  }),
  Redis: vi.fn(function MockRedis() {
    return { on: vi.fn(), quit: vi.fn(async () => {}), publish: vi.fn(async () => 0) };
  }),
}));

vi.mock('@/lib/secrets-file', () => ({ materializeFileSecrets: vi.fn() }));
vi.mock('@/lib/process-errors', () => ({ registerProcessErrorHandlers: vi.fn() }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/realtime/publish', () => ({ publishNewNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

const NOTIFICATION_JOB = {
  userId: USER_1,
  tenantId: TENANT_A,
  title: 'Birthday greeting queued',
  message: 'Wishing you a great day',
  type: 'system',
  data: { source: 'test' },
};

const WHATSAPP_JOB = {
  type: 'whatsapp',
  tenantId: TENANT_A,
  campaignId: CAMPAIGN,
  contactId: CONTACT,
  phone: '+919876543210',
  message: 'Happy birthday!',
  templateName: null,
  eventName: 'birthday',
};

function seedIntegration(tenantId = TENANT_A) {
  H.rows.integrations = [{
    id: 'int-1',
    tenant_id: tenantId,
    type: 'whatsapp',
    name: 'Meta Cloud',
    is_active: true,
    config: { phone_number_id: 'PN-1', access_token: 'AT-secret-value' },
    created_at: new Date('2026-01-01T00:00:00Z'),
  }];
}

function seedMessage(status: string, tenantId = TENANT_A) {
  H.rows.lead_warming_messages = [{
    id: 'msg-1',
    tenant_id: tenantId,
    campaign_id: CAMPAIGN,
    contact_id: CONTACT,
    channel: 'whatsapp',
    status,
    body: 'Happy birthday!',
    error_message: null,
    sent_at: null,
  }];
}

const run = async (queue: string, data: Record<string, unknown>) => {
  const processor = H.processors.get(queue);
  if (!processor) throw new Error(`worker.ts never registered a processor for ${queue}`);
  return processor({ id: 'job-1', data });
};

beforeEach(async () => {
  H.ops = [];
  H.calls = [];
  H.rows = { notifications: [], integrations: [], lead_warming_messages: [] };
  H.fetches = [];
  stack = [];
  vi.resetModules();
  H.processors.clear();
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    H.fetches.push({ url, body: String(init?.body ?? '') });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OK' }] }) };
  }));
  // worker.ts registers every processor at module scope; the mock of `bullmq` captures them.
  await import('@/worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ask 1 — a tenant id in a job payload has to become an RLS context', () => {
  it('send-notification writes the row instead of being refused by WITH CHECK', async () => {
    const out = await run('send-notification', NOTIFICATION_JOB);
    expect(out).toMatchObject({ sent: true, userId: USER_1 });
    expect(H.rows.notifications).toHaveLength(1);
    expect(H.rows.notifications[0]).toMatchObject({ tenant_id: TENANT_A, user_id: USER_1, title: 'Birthday greeting queued' });
  });

  it('…and earns that write through the tenant the job claims, not by bypassing RLS', async () => {
    await run('send-notification', NOTIFICATION_JOB);
    const setTenant = H.calls.filter((c) => /set_config\('app\.current_tenant'/.test(c.text));
    expect(setTenant.map((c) => c.params[0])).toContain(TENANT_A);
    // Context first, write second — a write that lands without a preceding set_config is the bug.
    expect(H.ops.indexOf('insert:notifications')).toBeGreaterThan(H.ops.indexOf('set_config:app.current_tenant'));
  });

  it('a job whose payload names no tenant fails instead of writing nowhere', async () => {
    await expect(run('send-notification', { ...NOTIFICATION_JOB, tenantId: undefined })).rejects.toThrow();
    expect(H.rows.notifications).toHaveLength(0);
  });

  it('lead warming reads its integration, so it can tell configured from unconfigured', async () => {
    seedIntegration();
    seedMessage('queued');
    const out = await run('send-lead-warming', WHATSAPP_JOB);
    expect(out).toMatchObject({ sent: true });
    expect(H.fetches).toHaveLength(1);
    expect(H.fetches[0]!.url).toContain('/PN-1/messages');
    expect(H.rows.lead_warming_messages[0]).toMatchObject({ status: 'sent' });
  });

  it('the token it sends with comes from the tenant the payload names, never another', async () => {
    seedIntegration(TENANT_B);
    seedMessage('queued', TENANT_B);
    const out = await run('send-lead-warming', { ...WHATSAPP_JOB, tenantId: TENANT_A });
    // Checked context, so "not configured" is now a statement about tenant A rather than about an
    // empty GUC — and tenant A genuinely has nothing configured.
    expect(out).toMatchObject({ sent: false, error: 'WhatsApp not configured' });
    expect(H.fetches).toHaveLength(0);
    // The other tenant's row is not merely unreadable, it is unmarked: the status write claims 0.
    expect(H.ops).toContain('update:lead_warming_messages:0');
    expect(H.rows.lead_warming_messages[0]!.status).toBe('queued');
    // What separates the honest "not configured" from the old one: a context was actually opened,
    // so the read that answered empty was checked, not unprivileged.
    expect(H.calls.some((c) => /set_config\('app\.current_tenant'/.test(c.text) && c.params[0] === TENANT_A)).toBe(true);
    // No credential from tenant B ever reached the wire.
    expect(JSON.stringify(H.fetches)).not.toContain('AT-secret-value');
  });
});

describe('ask 2 — "claim matched 0 rows" is not evidence of a duplicate', () => {
  it('no row at all for that campaign/contact is a failure, not a skip', async () => {
    seedIntegration();
    H.rows.lead_warming_messages = [];
    await expect(run('send-lead-warming', WHATSAPP_JOB)).rejects.toThrow(/no-op claim/);
    expect(H.fetches).toHaveLength(0);
  });

  it('a row already sent is the duplicate the claim was written to detect', async () => {
    seedIntegration();
    seedMessage('sent');
    const out = await run('send-lead-warming', WHATSAPP_JOB);
    expect(out).toMatchObject({ sent: false, skipped: true });
    expect(H.fetches).toHaveLength(0);
  });

  it('nothing is marked sent when the send never happened', async () => {
    seedIntegration();
    seedMessage('queued');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 190, message: 'invalid token' } }) })));
    await expect(run('send-lead-warming', WHATSAPP_JOB)).rejects.toThrow(/invalid token/);
    expect(H.rows.lead_warming_messages[0]!.status).toBe('failed');
  });
});

describe('the shape of the fix, as a guarantee about the file', () => {
  it('the notification write goes through the one helper that already wraps it', async () => {
    // #3288's lesson: two copies of a write is how one gets fixed and the other stays broken.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('worker.ts', 'utf8');
    expect(src).toContain('createNotification');
    expect(src).not.toMatch(/\bdb\s*\.\s*insert\s*\(\s*notifications\s*\)/);
    expect(src).not.toMatch(/\bdatabase\s*\.\s*(select|update)\s*\(/);
  });

  it('a job that reports success actually wrote, and the two are not confused', async () => {
    const out = await run('send-notification', NOTIFICATION_JOB);
    expect(out).toEqual({ sent: true, userId: USER_1 });
    expect(H.rows.notifications).toHaveLength(1);
  });
});

describe('schema sanity for the harness itself', () => {
  it('the tenant-scoped tables this test enforces really are the ones 0031/0019 named', async () => {
    const { readFileSync } = await import('node:fs');
    const n19 = readFileSync('drizzle/migrations/0019_fix_rls_notifications.sql', 'utf8');
    const n31 = readFileSync('drizzle/migrations/0031_rls_remaining_tables.sql', 'utf8');
    expect(n19).toMatch(/'notifications'/);
    expect(n31).toMatch(/'integrations'/);
    expect(n31).toMatch(/'lead_warming_messages'/);
    expect(getTableName(notifications)).toBe('notifications');
    expect(getTableName(integrations)).toBe('integrations');
    expect(getTableName(leadWarmingMessages)).toBe('lead_warming_messages');
  });
});
