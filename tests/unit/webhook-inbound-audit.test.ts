/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for the inbound webhook audit log
 * (POST /api/webhooks/inbound → webhook_inbound_logs).
 *
 * Three defects are pinned here:
 *
 * 1. `record_id` is a uuid column (drizzle/schema/comm.ts), but logWebhookDelivery
 *    used to insert `Number(input.recordId)`. Every real id is a uuid, so that
 *    expression was always NaN, Postgres rejected the row, and the surrounding
 *    try/catch swallowed the error into console.error. Only the *success* path
 *    passes a record id — so the audit trail recorded failures and silently lost
 *    every successful write. The `as unknown as $inferInsert` cast on `.values()`
 *    is what hid the type mismatch from tsc; it is gone now.
 *
 * 2. The `payload` and `headers` jsonb columns existed but were never populated,
 *    so a payload we failed to map was unrecoverable and undebuggable.
 *
 * 3. Entity handlers build their inserts from a fixed allowlist of keys, so any
 *    other top-level key was dropped with zero visibility. `collectIgnoredKeys`
 *    now records what was thrown away (visibility only — unmapped values are
 *    still never written to the record).
 *
 * A local db mock is used rather than tests/helpers/db-mock.ts because these
 * assertions are about the *values handed to* `.insert().values()`, so the mock
 * has to capture each insert payload and the table it targeted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { webhookInboundLogs, contacts } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: unknown; values: any }>,
  returningQueue: [] as unknown[][],
  /** Insert against this table rejects, simulating a Postgres error. */
  failInsertTable: null as unknown,
  apiKeyRow: null as unknown,
  contactRow: undefined as unknown,
}));

vi.mock('@/drizzle/db', () => {
  const db: any = {
    insert: (table: unknown) => {
      const chain: any = {
        values: (payload: unknown) => {
          h.inserts.push({ table, values: payload });
          if (h.failInsertTable !== null && table === h.failInsertTable) {
            const rejected: any = {
              returning: () => Promise.reject(new Error('null value in column "record_id"')),
              then: (res: any, rej?: any) =>
                Promise.reject(new Error('null value in column "record_id"')).then(res, rej),
            };
            return rejected;
          }
          return chain;
        },
        returning: async () => h.returningQueue.shift() ?? [],
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    update: () => {
      const chain: any = {
        set: () => chain,
        where: () => chain,
        then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
      };
      return chain;
    },
    select: () => ({
      from: () => ({
        where: () => ({
          then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej),
        }),
      }),
    }),
    query: {
      apiKeys: { findFirst: async () => h.apiKeyRow },
      contacts: { findFirst: async () => h.contactRow },
      leads: { findFirst: async () => undefined },
      deals: { findFirst: async () => undefined },
      companies: { findFirst: async () => undefined },
      tasks: { findFirst: async () => undefined },
    },
    transaction: async (cb: any) => cb(db),
  };
  return { db };
});

vi.mock('@/lib/rate-limit', () => ({
  RateLimiter: class {
    async enforce(): Promise<void> {
      return undefined;
    }
  },
  getRateLimitHeaders: () => ({}),
}));

vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { request: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

const RECORD_UUID = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const API_KEY_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

/** Rows inserted into webhook_inbound_logs by the code under test. */
function logRows(): any[] {
  return h.inserts.filter((i) => i.table === webhookInboundLogs).map((i) => i.values);
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    apiKeyId: API_KEY_ID,
    action: 'create',
    entity: 'contact',
    status: 'success',
    statusCode: 200,
    errorMessage: null,
    recordId: RECORD_UUID,
    payloadSize: 42,
    ...over,
  } as Parameters<typeof import('@/app/api/webhooks/inbound/route').logWebhookDelivery>[0];
}

async function route() {
  return await import('@/app/api/webhooks/inbound/route');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.inserts = [];
  h.returningQueue = [];
  h.failInsertTable = null;
  h.contactRow = undefined;
  h.apiKeyRow = {
    id: API_KEY_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    prefix: 'nucrm_ab12',
    name: 'Test Key',
    isActive: true,
    expiresAt: null,
  };
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ── 1. record_id corruption ────────────────────────────────────────────

describe('webhook_inbound_logs.record_id', () => {
  it('stores a uuid record id unchanged, never as a number or NaN', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ recordId: RECORD_UUID }));

    const [row] = logRows();
    expect(row.recordId).toBe(RECORD_UUID);
    expect(typeof row.recordId).toBe('string');
    // The old code did Number(uuid) === NaN, which Postgres rejects.
    expect(Number.isNaN(row.recordId as unknown as number)).toBe(false);
    expect(row.recordId).not.toBe(Number(RECORD_UUID));
  });

  it('accepts an uppercase uuid', async () => {
    const upper = RECORD_UUID.toUpperCase();
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ recordId: upper }));

    expect(logRows()[0].recordId).toBe(upper);
  });

  it('stores a non-uuid record id as null rather than corrupting the column', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ recordId: 'abc' }));

    expect(logRows()[0].recordId).toBeNull();
  });

  it('stores a numeric-looking record id as null (it is not a uuid)', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ recordId: '123' }));

    const [row] = logRows();
    expect(row.recordId).toBeNull();
    expect(row.recordId).not.toBe(123);
  });

  it('leaves a null record id as null', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ recordId: null, status: 'error' }));

    expect(logRows()[0].recordId).toBeNull();
  });

  it('toUuidOrNull passes uuids through and rejects everything else', async () => {
    const { toUuidOrNull } = await route();
    expect(toUuidOrNull(RECORD_UUID)).toBe(RECORD_UUID);
    expect(toUuidOrNull('abc')).toBeNull();
    expect(toUuidOrNull('123')).toBeNull();
    expect(toUuidOrNull('')).toBeNull();
    expect(toUuidOrNull(null)).toBeNull();
    expect(toUuidOrNull(42)).toBeNull();
    expect(toUuidOrNull(`${RECORD_UUID}-extra`)).toBeNull();
  });
});

// ── 2. raw payload + headers persistence ───────────────────────────────

describe('webhook_inbound_logs.payload', () => {
  it('stores the body that was sent', async () => {
    const body = { action: 'create', entity: 'contact', data: { first_name: 'Ada' } };
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ body }));

    expect(logRows()[0].payload).toMatchObject(body);
  });

  it('replaces a payload larger than 64KB with a truncation stub', async () => {
    const body = { action: 'create', entity: 'contact', data: { notes: 'x'.repeat(70_000) } };
    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    expect(size).toBeGreaterThan(64 * 1024);

    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ body }));

    expect(logRows()[0].payload).toEqual({ _truncated: true, _originalSize: size });
  });

  it('stores a payload just under 64KB in full', async () => {
    const filler = 'x'.repeat(64 * 1024 - 200);
    const body = { action: 'create', entity: 'contact', data: { notes: filler } };
    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    expect(size).toBeLessThanOrEqual(64 * 1024);

    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ body }));

    const [row] = logRows();
    expect(row.payload._truncated).toBeUndefined();
    expect(row.payload.data.notes).toBe(filler);
  });

  it('records the payload on the error path too', async () => {
    const body = { action: 'create', entity: 'contact', data: { first_name: 'Ada' } };
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(
      baseInput({ body, status: 'error', statusCode: 400, errorMessage: 'boom', recordId: null })
    );

    const [row] = logRows();
    expect(row.status).toBe('error');
    expect(row.payload).toMatchObject(body);
  });
});

describe('webhook_inbound_logs.headers', () => {
  it('redacts sensitive header values', async () => {
    const headers = new Headers({
      authorization: 'Bearer supersecret',
      'x-api-key': 'nucrm_live_abc123',
      'x-webhook-secret': 'whsec_abc',
      cookie: 'session=abc',
      'content-type': 'application/json',
    });

    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ headers }));

    const stored = logRows()[0].headers;
    expect(stored['authorization']).toBe('[REDACTED]');
    expect(stored['x-api-key']).toBe('[REDACTED]');
    expect(stored['x-webhook-secret']).toBe('[REDACTED]');
    expect(stored['cookie']).toBe('[REDACTED]');
  });

  it('matches sensitive header names case-insensitively', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(
      baseInput({
        headers: {
          Authorization: 'Bearer supersecret',
          'X-API-Key': 'nucrm_live_abc123',
          'Set-Cookie': 'session=abc',
          'Proxy-Authorization': 'Basic abc',
        },
      })
    );

    const stored = logRows()[0].headers;
    expect(stored['Authorization']).toBe('[REDACTED]');
    expect(stored['X-API-Key']).toBe('[REDACTED]');
    expect(stored['Set-Cookie']).toBe('[REDACTED]');
    expect(stored['Proxy-Authorization']).toBe('[REDACTED]');
    expect(Object.values(stored)).not.toContain('Bearer supersecret');
  });

  it('preserves non-sensitive headers verbatim', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(
      baseInput({
        headers: { 'content-type': 'application/json', 'user-agent': 'Zapier/1.0' },
      })
    );

    const stored = logRows()[0].headers;
    expect(stored['content-type']).toBe('application/json');
    expect(stored['user-agent']).toBe('Zapier/1.0');
  });
});

describe('webhook_inbound_logs.processed', () => {
  it('marks a successful write as processed with a timestamp', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ status: 'success' }));

    const [row] = logRows();
    expect(row.processed).toBe(true);
    expect(row.processedAt).toBeInstanceOf(Date);
  });

  it('marks a failed write as unprocessed with a null timestamp', async () => {
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ status: 'error', statusCode: 400, recordId: null }));

    const [row] = logRows();
    expect(row.processed).toBe(false);
    expect(row.processedAt).toBeNull();
  });
});

// ── 3. dropped-field visibility ────────────────────────────────────────

describe('collectIgnoredKeys', () => {
  it('reports keys a contact handler never reads', async () => {
    const { collectIgnoredKeys } = await route();
    const ignored = collectIgnoredKeys('contact', {
      first_name: 'Ada',
      email: 'ada@example.com',
      call_duration: 320,
      transcript: 'hello there',
    });

    expect(ignored).toContain('call_duration');
    expect(ignored).toContain('transcript');
    expect(ignored).not.toContain('first_name');
    expect(ignored).not.toContain('email');
  });

  it('returns an empty array when every key is recognised', async () => {
    const { collectIgnoredKeys } = await route();
    expect(
      collectIgnoredKeys('contact', {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        phone: '+1 555 0100',
        lead_source: 'website',
        tags: ['vip'],
        score: 10,
      })
    ).toEqual([]);
  });

  it('treats id and customFields as recognised', async () => {
    const { collectIgnoredKeys } = await route();
    expect(collectIgnoredKeys('contact', { id: RECORD_UUID, customFields: { a: 1 }, first_name: 'Ada' })).toEqual([]);
    expect(collectIgnoredKeys('task', { id: RECORD_UUID, custom_fields: { a: 1 }, title: 'Call' })).toEqual([]);
  });

  it('uses the per-entity key list, so a contact key is ignored on a company', async () => {
    const { collectIgnoredKeys } = await route();
    expect(collectIgnoredKeys('company', { name: 'Acme', industry: 'saas' })).toEqual([]);
    expect(collectIgnoredKeys('company', { name: 'Acme', lead_score: 5 })).toEqual(['lead_score']);
    expect(collectIgnoredKeys('deal', { title: 'Big', value: 10, close_date: 'x' })).toEqual([]);
    expect(collectIgnoredKeys('lead', { first_name: 'Ada', lifecycle_stage: 'lead' })).toEqual([]);
  });

  it('surfaces _ignoredKeys inside the stored payload jsonb', async () => {
    const data = { first_name: 'Ada', call_duration: 320, transcript: 'hi' };
    const body = { action: 'create', entity: 'contact', data };
    const { logWebhookDelivery } = await route();
    await logWebhookDelivery(baseInput({ body, data }));

    const [row] = logRows();
    expect(row.payload._ignoredKeys).toEqual(['call_duration', 'transcript']);
    // ...alongside the body, not instead of it.
    expect(row.payload.data).toEqual(data);
  });

  it('does not copy ignored values into customFields on the record', async () => {
    h.returningQueue = [[{ id: RECORD_UUID }]];
    const { POST } = await route();
    await POST(
      new NextRequest('http://localhost/api/webhooks/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'nucrm_live_abc' },
        body: JSON.stringify({
          action: 'create',
          entity: 'contact',
          data: { first_name: 'Ada', call_duration: 320, transcript: 'hi' },
        }),
      })
    );

    const contactInsert = h.inserts.find((i) => i.table === contacts)?.values;
    expect(contactInsert).toBeDefined();
    expect(contactInsert.customFields).toEqual({});
    expect(JSON.stringify(contactInsert)).not.toContain('transcript');
  });
});

// ── Audit logging must never break the request ─────────────────────────

describe('logWebhookDelivery resilience', () => {
  it('does not propagate a db failure', async () => {
    h.failInsertTable = webhookInboundLogs;
    const { logWebhookDelivery } = await route();

    await expect(logWebhookDelivery(baseInput())).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('lets the webhook request succeed even when the audit insert fails', async () => {
    h.failInsertTable = webhookInboundLogs;
    h.returningQueue = [[{ id: RECORD_UUID }]];

    const { POST } = await route();
    const res = await POST(
      new NextRequest('http://localhost/api/webhooks/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'nucrm_live_abc' },
        body: JSON.stringify({
          action: 'create',
          entity: 'contact',
          data: { first_name: 'Ada', email: 'ada@example.com' },
        }),
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.succeeded).toBe(1);
    expect(logRows()).toHaveLength(1);
  });

  it('logs the request headers redacted when called through the route', async () => {
    h.returningQueue = [[{ id: RECORD_UUID }]];

    const { POST } = await route();
    const res = await POST(
      new NextRequest('http://localhost/api/webhooks/inbound', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'nucrm_live_abc',
          authorization: 'Bearer nope',
        },
        body: JSON.stringify({
          action: 'create',
          entity: 'contact',
          data: { first_name: 'Ada', email: 'ada@example.com' },
        }),
      })
    );

    expect(res.status).toBe(200);
    const [row] = logRows();
    expect(row.headers['x-api-key']).toBe('[REDACTED]');
    expect(row.headers['authorization']).toBe('[REDACTED]');
    expect(row.headers['content-type']).toBe('application/json');
    expect(row.recordId).toBe(RECORD_UUID);
    expect(row.processed).toBe(true);
  });
});
