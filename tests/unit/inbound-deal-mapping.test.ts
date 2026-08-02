/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for handleDeal() in app/api/webhooks/inbound/route.ts.
 *
 * Background: the handler built its deal payload out of keys that match no
 * `deals` column — `value`, `stage`, `probability` and `notes`. Drizzle emits
 * only columns it knows about, so on the UPDATE path the amount, stage,
 * probability and notes were all silently discarded while the caller still got a
 * 200. On the CREATE path it was worse: the insert passed `stageId: ''` as a
 * literal placeholder, and because `deals.stage_id` is a NOT NULL uuid Postgres
 * rejected it with `invalid input syntax for type uuid: ""` — creating a deal
 * through the inbound webhook could not succeed at all.
 *
 * The handler now maps onto real columns: `value`/`amount` → `amount` (a decimal
 * written as a string), `stage`/`stage_id` → a tenant-scoped `stageId` plus the
 * matching `pipelineId`, and `probability`/`notes` → keys folded into the
 * `customFields` jsonb so no caller data is dropped.
 *
 * The db mock follows tests/unit/deals-tasks-custom-fields.test.ts — a local
 * ordered-queue mock with an ops recorder — because these assertions are about
 * the *payload handed to Drizzle*, which is what the recorder captures. Selects
 * are served from an ordered queue since stage resolution issues several
 * different queries in sequence (stage by id or name, then the default pipeline,
 * then that pipeline's first stage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { deals, dealStages, pipelines, webhookInboundLogs, webhookFieldMappings } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; table?: unknown; payload?: unknown; where?: unknown }>,
  apiKeyRow: null as unknown,
  findFirst: {} as Record<string, unknown>,
  selectQueue: [] as unknown[][],
  returningQueue: [] as unknown[][],
}));

vi.mock('@/drizzle/db', () => {
  const reader = () => {
    const rec: any = { op: 'select' };
    const self: any = {
      from: (t: unknown) => {
        rec.table = t;
        h.ops.push(rec);
        return self;
      },
      where: (c: unknown) => {
        rec.where = c;
        return self;
      },
      then: (res: any, rej?: any) => {
        // Field-mapping lookups are incidental to this suite — they must not
        // consume a queued stage/pipeline row.
        if (rec.table === webhookFieldMappings) {
          return Promise.resolve([]).then(res, rej);
        }
        return Promise.resolve(h.selectQueue.shift() ?? []).then(res, rej);
      },
    };
    for (const m of ['innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit', 'offset']) {
      self[m] = () => self;
    }
    return self;
  };

  const record = (op: string, table: unknown) => {
    const rec: any = { op, table };
    h.ops.push(rec);
    const chain: any = {
      set: (p: unknown) => {
        rec.payload = p;
        return chain;
      },
      values: (p: unknown) => {
        rec.payload = p;
        return chain;
      },
      where: () => chain,
      returning: async () => h.returningQueue.shift() ?? [{ id: 'new-id' }],
      then: (res: any, rej?: any) => Promise.resolve(undefined).then(res, rej),
    };
    return chain;
  };

  const db: any = {
    select: () => reader(),
    insert: (table: unknown) => record('insert', table),
    update: (table: unknown) => record('update', table),
    delete: (table: unknown) => record('delete', table),
    query: {
      apiKeys: { findFirst: async () => h.apiKeyRow },
      contacts: { findFirst: async () => h.findFirst['contacts'] },
      companies: { findFirst: async () => h.findFirst['companies'] },
      leads: { findFirst: async () => h.findFirst['leads'] },
      deals: { findFirst: async () => h.findFirst['deals'] },
      tasks: { findFirst: async () => h.findFirst['tasks'] },
    },
    transaction: async (cb: any) => cb(db),
  };
  return { db };
});

vi.mock('@/lib/rate-limit', () => ({
  RateLimiter: class {
    async enforce() {
      return undefined;
    }
  },
  getRateLimitHeaders: () => ({}),
}));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { request: vi.fn() } }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';

// A stage the caller names or references by id.
const STAGE_ID = '44444444-4444-4444-8444-444444444444';
const PIPELINE_ID = '55555555-5555-4555-8555-555555555555';
// The default pipeline's lowest-order stage, used as the fallback.
const DEFAULT_STAGE_ID = '66666666-6666-4666-8666-666666666666';
const DEFAULT_PIPELINE_ID = '77777777-7777-4777-8777-777777777777';
// Belongs to some other tenant — must never be trusted.
const FOREIGN_STAGE_ID = '88888888-8888-4888-8888-888888888888';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function req(body: unknown) {
  return new NextRequest('http://localhost/api/webhooks/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  });
}

/** Send one { action, entity, data } item through the route. */
async function post(action: string, data: Record<string, unknown>) {
  const { POST } = await import('@/app/api/webhooks/inbound/route');
  return POST(req({ action, entity: 'deal', data }));
}

/** The payload handed to Drizzle for a given op/table, ignoring the log insert. */
function payload(op: string, table: unknown): Record<string, unknown> | undefined {
  const rec = h.ops.find((o) => o.op === op && o.table === table);
  return rec?.payload as Record<string, unknown> | undefined;
}

/** Every select recorded against a table, in order. */
function selects(table: unknown) {
  return h.ops.filter((o) => o.op === 'select' && o.table === table);
}

/** The error message the route recorded for a failed item. */
function loggedError(): string | undefined {
  const rec = h.ops.find((o) => o.op === 'insert' && o.table === webhookInboundLogs);
  return (rec?.payload as Record<string, unknown> | undefined)?.['errorMessage'] as string | undefined;
}

/**
 * Column names a Drizzle condition actually references. Walks `queryChunks` only
 * and stops at column nodes instead of descending into their `table` back-link,
 * so an unrelated column on the same table cannot produce a false positive.
 */
function referencedColumns(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) referencedColumns(n, out, depth + 1);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['columnType'] === 'string' && typeof rec['name'] === 'string') {
    out.push(rec['name'] as string);
    return out;
  }
  if (Array.isArray(rec['queryChunks'])) referencedColumns(rec['queryChunks'], out, depth + 1);
  if (rec['encoder']) referencedColumns(rec['encoder'], out, depth + 1);
  return out;
}

/** Queue the two selects the default-pipeline fallback issues. */
function queueDefaultPipelineFallback() {
  h.selectQueue.push([{ id: DEFAULT_PIPELINE_ID }]);
  h.selectQueue.push([{ id: DEFAULT_STAGE_ID, pipelineId: DEFAULT_PIPELINE_ID }]);
}

/** Queue the single select a resolvable stage id/name lookup issues. */
function queueStageHit() {
  h.selectQueue.push([{ id: STAGE_ID, pipelineId: PIPELINE_ID }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ops = [];
  h.selectQueue = [];
  h.returningQueue = [];
  h.findFirst = {};
  h.apiKeyRow = {
    id: 'key-1',
    tenantId: TENANT_ID,
    userId: USER_ID,
    prefix: 'nuk_test',
    name: 'Test key',
    isActive: true,
    expiresAt: null,
  };
});

// ── 1. value / amount → the `amount` decimal column ───────────────────────────

describe('handleDeal amount mapping', () => {
  it('writes value: 5000 to the amount column as a string', async () => {
    queueDefaultPipelineFallback();

    const res = await post('create', { title: 'Value deal', value: 5000 });

    expect(res.status).toBe(200);
    expect(payload('insert', deals)!['amount']).toBe('5000');
  });

  it('does not send a "value" key to Drizzle at all (there is no such column)', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Value deal', value: 5000 });

    const written = payload('insert', deals)!;
    expect(written).not.toHaveProperty('value');
    expect(written).not.toHaveProperty('stage');
    expect(written).not.toHaveProperty('probability');
    expect(written).not.toHaveProperty('notes');
  });

  it('accepts amount: 5000 as well', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Amount deal', amount: 5000 });

    expect(payload('insert', deals)!['amount']).toBe('5000');
  });

  it('lets amount win when both amount and value are sent', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Both', amount: 7000, value: 5000 });

    expect(payload('insert', deals)!['amount']).toBe('7000');
  });

  it('keeps the scale of a numeric string: "2500.50" stays "2500.50"', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Stringy amount', value: '2500.50' });

    expect(payload('insert', deals)!['amount']).toBe('2500.50');
  });

  it('turns a non-numeric value into "0", never "NaN"', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Bad amount', value: 'lots' });

    const amount = payload('insert', deals)!['amount'];
    expect(amount).toBe('0');
    expect(amount).not.toBe('NaN');
  });

  it('defaults to "0" when no money field is sent', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'No amount' });

    expect(payload('insert', deals)!['amount']).toBe('0');
  });
});

// ── 2. stage / stage_id → the `stageId` uuid column ───────────────────────────

describe('handleDeal stage resolution', () => {
  it('resolves a stage NAME to the matching stageId', async () => {
    queueStageHit();

    const res = await post('create', { title: 'Named stage', stage: 'Negotiation' });

    expect(res.status).toBe(200);
    expect(payload('insert', deals)!['stageId']).toBe(STAGE_ID);
  });

  it('falls back to the default pipeline first stage when the name matches nothing', async () => {
    h.selectQueue.push([]); // name lookup misses
    queueDefaultPipelineFallback();

    const res = await post('create', { title: 'Unknown stage', stage: 'Does Not Exist' });

    expect(res.status).toBe(200);
    expect(payload('insert', deals)!['stageId']).toBe(DEFAULT_STAGE_ID);
  });

  it('uses a caller-supplied stage_id that belongs to this tenant', async () => {
    h.selectQueue.push([{ id: STAGE_ID, pipelineId: PIPELINE_ID }]);

    const res = await post('create', { title: 'By id', stage_id: STAGE_ID });

    expect(res.status).toBe(200);
    expect(payload('insert', deals)!['stageId']).toBe(STAGE_ID);
  });

  it('rejects a stage_id belonging to a DIFFERENT tenant instead of writing it', async () => {
    // The tenant-scoped lookup finds nothing, exactly as it would in Postgres for
    // another tenant's stage.
    h.selectQueue.push([]);
    queueDefaultPipelineFallback(); // must NOT be reached — an explicit id is not guesswork

    const res = await post('create', { title: 'Cross tenant', stage_id: FOREIGN_STAGE_ID });

    expect(res.status).toBe(207);
    expect(await res.json()).toMatchObject({ ok: false, succeeded: 0, failed: 1 });
    expect(payload('insert', deals)).toBeUndefined();
    expect(loggedError()).toContain(FOREIGN_STAGE_ID);
    expect(loggedError()).toMatch(/tenant/i);
  });

  it('scopes both stage lookups to the tenant in SQL', async () => {
    // Sanity-check the helper first: an unscoped condition must not look scoped,
    // otherwise the assertions below would pass vacuously.
    expect(referencedColumns(eq(dealStages.id, STAGE_ID))).not.toContain('tenant_id');

    queueStageHit();
    await post('create', { title: 'By name', stage: 'Negotiation' });
    expect(referencedColumns(selects(dealStages)[0]!.where)).toContain('tenant_id');

    h.ops = [];
    h.selectQueue = [];
    h.selectQueue.push([{ id: STAGE_ID, pipelineId: PIPELINE_ID }]);
    await post('create', { title: 'By id', stage_id: STAGE_ID });
    expect(referencedColumns(selects(dealStages)[0]!.where)).toContain('tenant_id');
  });

  it('uses the default pipeline lowest-order stage when no stage input is given', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'No stage input' });

    const written = payload('insert', deals)!;
    expect(written['stageId']).toBe(DEFAULT_STAGE_ID);
    // Two selects: the pipeline, then its first stage.
    expect(selects(pipelines)).toHaveLength(1);
    expect(selects(dealStages)).toHaveLength(1);
  });

  it('returns a per-item error (not a 500, not a false success) when the tenant has no pipelines', async () => {
    h.selectQueue.push([]); // no pipelines at all

    const res = await post('create', { title: 'Tenantless' });
    const json = await res.json();

    expect(res.status).toBe(207);
    expect(json).toMatchObject({ ok: false, processed: 1, succeeded: 0, failed: 1 });
    expect(json.results[0]).toMatchObject({ entity: 'deal', status: 'error' });
    expect(payload('insert', deals)).toBeUndefined();
  });

  it('throws an actionable message naming what the caller should send', async () => {
    h.selectQueue.push([{ id: DEFAULT_PIPELINE_ID }]);
    h.selectQueue.push([]); // pipeline exists but has no stages

    await post('create', { title: 'Stageless pipeline' });

    const msg = loggedError() ?? '';
    expect(msg).toContain('stage_id');
    expect(msg).toContain('stage');
    expect(payload('insert', deals)).toBeUndefined();
  });

  it('sets pipelineId from the resolved stage', async () => {
    queueStageHit();

    await post('create', { title: 'Pipeline from stage', stage: 'Negotiation' });

    expect(payload('insert', deals)!['pipelineId']).toBe(PIPELINE_ID);
  });

  it('sets stageEnteredAt on create', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Stage clock' });

    expect(payload('insert', deals)!['stageEnteredAt']).toBeInstanceOf(Date);
  });

  it('never lets stageId: "" reach the insert — it is always a real uuid', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'No empty uuid' });

    const stageId = payload('insert', deals)!['stageId'];
    expect(stageId).not.toBe('');
    expect(String(stageId)).toMatch(UUID_RE);
  });

  it('rejects a stage_id that is not a uuid rather than letting Postgres fail', async () => {
    const res = await post('create', { title: 'Bad id', stage_id: 'not-a-uuid' });

    expect(res.status).toBe(207);
    expect(payload('insert', deals)).toBeUndefined();
    expect(loggedError()).toContain('uuid');
  });
});

// ── 3. probability / notes → customFields ─────────────────────────────────────

describe('handleDeal probability and notes', () => {
  it('preserves probability and notes inside customFields', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Folded', probability: 60, notes: 'Met at the expo' });

    expect(payload('insert', deals)!['customFields']).toEqual({
      probability: 60,
      notes: 'Met at the expo',
    });
  });

  it('keeps an explicitly supplied customFields object alongside the folded keys', async () => {
    queueDefaultPipelineFallback();

    await post('create', {
      title: 'Merged',
      customFields: { po_number: 'PO-99' },
      probability: 25,
      notes: 'Waiting on legal',
    });

    expect(payload('insert', deals)!['customFields']).toEqual({
      po_number: 'PO-99',
      probability: 25,
      notes: 'Waiting on legal',
    });
  });

  it('omits both keys when the caller sent neither (no invented probability: null)', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'Nothing folded' });

    const cf = payload('insert', deals)!['customFields'] as Record<string, unknown>;
    expect(cf).toEqual({});
    expect(cf).not.toHaveProperty('probability');
    expect(cf).not.toHaveProperty('notes');
  });

  it('coerces a numeric-string probability to a number', async () => {
    queueDefaultPipelineFallback();

    await post('create', { title: 'String probability', probability: '75' });

    expect(payload('insert', deals)!['customFields']).toEqual({ probability: 75 });
  });
});

// ── 4. The update path ────────────────────────────────────────────────────────

describe('handleDeal update path', () => {
  it('writes amount and stageId on update when the caller supplied them', async () => {
    h.findFirst['deals'] = { id: DEAL_ID, tenantId: TENANT_ID };
    queueStageHit();

    const res = await post('update', {
      id: DEAL_ID,
      title: 'Updated',
      value: 9000,
      stage: 'Negotiation',
    });

    expect(res.status).toBe(200);
    expect(payload('update', deals)).toMatchObject({
      amount: '9000',
      stageId: STAGE_ID,
      pipelineId: PIPELINE_ID,
    });
    expect(payload('insert', deals)).toBeUndefined();
  });

  it('leaves the existing stage alone when the update omits any stage input', async () => {
    h.findFirst['deals'] = { id: DEAL_ID, tenantId: TENANT_ID };

    const res = await post('update', { id: DEAL_ID, title: 'Amount only', value: 100 });

    expect(res.status).toBe(200);
    const written = payload('update', deals)!;
    expect(written['amount']).toBe('100');
    expect(written).not.toHaveProperty('stageId');
    expect(written).not.toHaveProperty('pipelineId');
    // No fallback lookup should even be attempted on update.
    expect(selects(pipelines)).toHaveLength(0);
    expect(selects(dealStages)).toHaveLength(0);
  });

  it('sends only real deals columns on update (the silent-drop regression)', async () => {
    h.findFirst['deals'] = { id: DEAL_ID, tenantId: TENANT_ID };
    queueStageHit();

    await post('update', {
      id: DEAL_ID,
      title: 'Everything',
      value: 1234,
      stage: 'Negotiation',
      probability: 80,
      notes: 'Verbal yes',
    });

    const written = payload('update', deals)!;
    for (const ghost of ['value', 'stage', 'probability', 'notes']) {
      expect(written).not.toHaveProperty(ghost);
    }
    expect(written['amount']).toBe('1234');
    expect(written['stageId']).toBe(STAGE_ID);
    expect(written['customFields']).toEqual({ probability: 80, notes: 'Verbal yes' });
  });
});
