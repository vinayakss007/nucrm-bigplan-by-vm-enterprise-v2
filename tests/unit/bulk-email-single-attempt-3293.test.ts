/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3293 — a bulk campaign is queued for ONE attempt, because the worker restarts
 * the recipient list at index 0.
 *
 * `lib/queue/index.ts` gives every job `attempts: 3` with exponential backoff. For
 * a job whose side effect is "mail these N people" that is not a safety net: the
 * `send-bulk-emails` processor walks `recipients` from `i = 0`, keeps no claim per
 * recipient, and masks the addresses it collected into the result set (#1292), so
 * a retry cannot be resumed — it re-sends everyone who already got the mail, up to
 * twice more. Both enqueue sites now pass `attempts: 1`, and these tests prove the
 * option actually reaches the two providers that honor a retry policy, because a
 * job option nothing reads is decoration.
 *
 * One correction to the report's own model, pinned rather than argued: a provider
 * rejection for one recipient does NOT fail the job — `Promise.allSettled` collects
 * it and the processor resolves (`tests/unit/worker-email-result-2998.test.ts:96`).
 * So the re-mail storm needed a job-level death (OOM, drain deadline, a throwing
 * import), not a bouncy address. `attempts: 1` removes exactly that path, which is
 * why it is the whole fix and not the first third of one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const CONTACT_A = '77777777-7777-4777-8777-777777777777';
const CONTACT_B = '88888888-8888-4888-8888-888888888888';

const dialect = new PgDialect({} as never);

type Q = { sql: string; params: unknown[]; table: string };
type Contact = {
  id: string; tenantId: string; email: string | null;
  firstName: string; lastName: string; unsubscribed: boolean;
};

let reads: Q[] = [];
let jobs: { name: string; data: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
let contacts_: Contact[] = [];
let body: Record<string, unknown> = {};

function render(predicate: unknown, table: string): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table };
}

/** Ids the query binds — an `in (...)` spreads them, a pg `= ANY($n)` passes an array. */
function boundIds(query: Q): Set<unknown> {
  return new Set(query.params.flatMap((p) => (Array.isArray(p) ? p : [p])));
}

function answer(query: Q): unknown[] {
  if (query.table === 'email_templates') {
    return query.params.includes(TEMPLATE) && query.params.includes(TENANT)
      ? [{ id: TEMPLATE, tenantId: TENANT, subject: 'Q3 update', bodyHtml: '<p>Hello {first_name}</p>', bodyText: '' }]
      : [];
  }
  if (query.table !== 'contacts') return [];
  const ids = boundIds(query);
  return contacts_.filter((row) =>
    ids.has(row.id) && query.params.includes(row.tenantId) && row.email);
}

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  let table: string | undefined;
  let where: Q | undefined;
  builder['from'] = (t: object) => { table = getTableName(t as never); return builder; };
  for (const m of ['leftJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning']) builder[m] = () => builder;
  builder['where'] = (predicate: unknown) => {
    where = render(predicate, table as string);
    reads.push(where);
    return builder;
  };
  builder['then'] = (done: (v: unknown) => unknown) =>
    Promise.resolve(where ? answer(where) : []).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeSelectBuilder()),
  insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn(), execute: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined), tenantMeta: () => ({}) }));
vi.mock('@/lib/api-error', () => ({
  // rethrow so a real defect surfaces as a failed test, not a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => body };
});
vi.mock('@/lib/queue', () => ({
  addJob: (name: string, data: Record<string, unknown>, options?: Record<string, unknown>) => {
    jobs.push({ name, data, options });
    return Promise.resolve();
  },
}));

// The real adapters, for the provider half below: the routes see the recorder
// above, and `importActual` hands the same specifier's untouched module to us.
const realQueue = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue');

type Fake = { add?: ReturnType<typeof vi.fn>; send?: ReturnType<typeof vi.fn> };
let redisQueues: Fake[] = [];
let bossInstances: Fake[] = [];

vi.mock('ioredis', () => ({
  default: class { ping() { return Promise.resolve('PONG'); } quit() { return Promise.resolve(); } },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    add: ReturnType<typeof vi.fn>;
    constructor() {
      this.add = vi.fn(() => Promise.resolve({}));
      redisQueues.push(this as unknown as Fake);
    }
    close() { return Promise.resolve(); }
  },
}));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    send: ReturnType<typeof vi.fn>;
    constructor() {
      this.send = vi.fn(() => Promise.resolve('job-id'));
      bossInstances.push(this as unknown as Fake);
    }
    start() { return Promise.resolve(true); }
    createQueue() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
  },
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const emailBulk = await import('@/app/api/tenant/email/bulk/route');
const templateBulkSend = await import('@/app/api/tenant/email/templates/bulk-send/route');

const ADMIN = {
  userId: '33333333-3333-4333-8333-333333333333',
  tenantId: TENANT,
  roleSlug: 'admin',
  permissions: {},
  isAdmin: true,
  isSuperAdmin: false,
};

async function post(path: string, payload: Record<string, unknown>, handler: (req: NextRequest) => Promise<Response>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN as unknown as AuthContext);
  body = payload;
  const req = new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return handler(req);
}

const contact = (id: string, over: Partial<Contact> = {}): Contact => ({
  id, tenantId: TENANT, email: `${id.slice(0, 4)}@corp.example`,
  firstName: 'First', lastName: 'Last', unsubscribed: false, ...over,
});

/** What each provider was asked for, per job name. */
function bullmqAsks() {
  return redisQueues.flatMap((q) => (q.add?.mock.calls ?? []).map((c) => ({
    name: c[0] as string,
    data: c[1],
    ...(c[2] as { attempts?: number; backoff?: unknown }),
  })));
}

function bossAsks() {
  return bossInstances.flatMap((b) => (b.send?.mock.calls ?? []).map((c) => ({
    name: c[0] as string,
    ...(c[2] as { retryLimit?: number }),
  })));
}

const askOf = (asks: { name: string }[], name: string) => asks.find((a) => a.name === name);

beforeEach(() => {
  vi.clearAllMocks();
  reads = [];
  jobs = [];
  redisQueues = [];
  bossInstances = [];
  contacts_ = [contact(CONTACT_A), contact(CONTACT_B)];
});

describe('both bulk enqueue sites ask for one attempt (#3293)', () => {
  it('app/api/tenant/email/bulk queues send-bulk-emails with attempts: 1', async () => {
    const res = await post('/api/tenant/email/bulk', {
      entity_type: 'contact', entity_ids: [CONTACT_A, CONTACT_B], template_id: TEMPLATE,
    }, emailBulk.POST as (req: NextRequest) => Promise<Response>);

    expect(res.status).toBe(200);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.name).toBe('send-bulk-emails');
    expect(jobs[0]!.options).toEqual({ attempts: 1 });
    // the option is a third argument, not a mutation of the payload
    expect((jobs[0]!.data.recipients as unknown[])).toHaveLength(2);
    expect(jobs[0]!.data).not.toHaveProperty('attempts');
  });

  it('app/api/tenant/email/templates/bulk-send queues the same job with attempts: 1', async () => {
    const res = await post('/api/tenant/email/templates/bulk-send', {
      template_id: TEMPLATE, contact_ids: [CONTACT_A, CONTACT_B], variables: { company: 'Corp' },
    }, templateBulkSend.POST as (req: NextRequest) => Promise<Response>);

    expect(res.status).toBe(200);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.name).toBe('send-bulk-emails');
    expect(jobs[0]!.options).toEqual({ attempts: 1 });
    expect((jobs[0]!.data.recipients as unknown[])).toHaveLength(2);
  });

  it('does not mail a contact the read did not return', async () => {
    contacts_ = [contact(CONTACT_A)];
    await post('/api/tenant/email/bulk', {
      entity_type: 'contact', entity_ids: [CONTACT_A, CONTACT_B], template_id: TEMPLATE,
    }, emailBulk.POST as (req: NextRequest) => Promise<Response>);
    const recipients = jobs[0]!.data.recipients as { contact_id: string }[];
    expect(recipients.map((r) => r.contact_id)).toEqual([CONTACT_A]);
  });
});

describe('the retry policy is honored where it is enforced', () => {
  const savedRedis = process.env.REDIS_URL;
  const savedDb = process.env.DATABASE_URL;

  afterEach(async () => {
    await realQueue.closeQueue().catch(() => undefined);
    if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
    if (savedDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDb;
  });

  it('BullMQ receives attempts: 1 for the bulk job and 3 for a job that says nothing', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await realQueue.addJob('send-bulk-emails', { recipients: [] }, { attempts: 1 });
    await realQueue.addJob('send-notification', { userId: 'u' });
    await realQueue.closeQueue();

    const asks = bullmqAsks();
    expect(askOf(asks, 'send-bulk-emails')).toMatchObject({ attempts: 1, backoff: { type: 'exponential', delay: 1000 } });
    expect(askOf(asks, 'send-notification')?.attempts).toBe(3);
  });

  it('pg-boss maps the same option onto retryLimit', async () => {
    delete process.env.REDIS_URL;
    process.env.DATABASE_URL = 'postgresql://x@localhost:5432/nucrm_test';
    await realQueue.addJob('send-bulk-emails', { recipients: [] }, { attempts: 1 });
    await realQueue.addJob('send-notification', { userId: 'u' });
    await realQueue.closeQueue();

    const asks = bossAsks();
    expect(askOf(asks, 'send-bulk-emails')?.retryLimit).toBe(1);
    expect(askOf(asks, 'send-notification')?.retryLimit).toBe(3);
  });

  it('`attempts: 0` would NOT mean "never retry" — it inherits the default', async () => {
    // Pinned because the tempting edit is to lower the bulk job further than one.
    // `attempts: options?.attempts || 3` reads 0 as "unset", so a 0 here queues
    // THREE attempts — more duplicate mail than doing nothing.
    process.env.REDIS_URL = 'redis://localhost:6379';
    await realQueue.addJob('send-bulk-emails', { recipients: [] }, { attempts: 0 });
    await realQueue.closeQueue();

    expect(bullmqAsks()).toEqual([expect.objectContaining({ name: 'send-bulk-emails', attempts: 3 })]);
  });
});
