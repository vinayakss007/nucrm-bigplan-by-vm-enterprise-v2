/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for custom_fields on `deals` and `tasks`.
 *
 * Background: `contacts`, `companies` and `leads` have carried a first-class
 * `custom_fields` jsonb column since 0000_init. `deals` and `tasks` never did —
 * they only had `metadata`. The inbound webhook handler nonetheless built
 * `customFields: typeof d['customFields'] === 'object' ? d['customFields'] : {}`
 * into its deal payload and handed it to Drizzle on both the insert and the
 * update path. Drizzle only emits columns it knows about, so the value was
 * silently discarded and the caller still got a 200 — data loss with no error.
 *
 * 0048_deals_tasks_custom_fields adds the column to both tables, the schema
 * declares it, and handleTask now reads it too. These tests pin all three:
 * the column exists on every entity table, and the handler actually writes it.
 *
 * The db mock follows tests/unit/pipelines-stage-safety.test.ts — a local
 * ordered-queue mock with an ops recorder — rather than tests/helpers/db-mock.ts,
 * because these assertions are about the *payload handed to Drizzle*, which is
 * what the recorder captures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getTableColumns } from 'drizzle-orm';
import { contacts, companies, leads, deals, tasks } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; table?: unknown; payload?: unknown }>,
  apiKeyRow: null as unknown,
  findFirst: {} as Record<string, unknown>,
  returningQueue: [] as unknown[][],
  stageId: '55555555-5555-4555-8555-555555555555',
  pipelineId: '66666666-6666-4666-8666-666666666666',
}));

vi.mock('@/drizzle/db', async () => {
  // handleDeal resolves a real `deals.stage_id` before writing (see
  // tests/unit/inbound-deal-mapping.test.ts), so the route now issues selects
  // against `pipelines` and `deal_stages`. These table-aware defaults just make
  // that resolution succeed; the custom-fields assertions below are unchanged.
  const { dealStages, pipelines } = await import('@/drizzle/schema');

  const reader = () => {
    let table: unknown = null;
    const self: any = {
      from: (t: unknown) => {
        table = t;
        return self;
      },
      then: (res: any, rej?: any) => {
        const rows =
          table === pipelines ? [{ id: h.pipelineId }]
          : table === dealStages ? [{ id: h.stageId, pipelineId: h.pipelineId }]
          : [];
        return Promise.resolve(rows).then(res, rej);
      },
    };
    for (const m of ['where', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit', 'offset']) {
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
const TASK_ID = '44444444-4444-4444-8444-444444444444';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/webhooks/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  });
}

/** Send one { action, entity, data } item through the route. */
async function post(action: string, entity: string, data: Record<string, unknown>) {
  const { POST } = await import('@/app/api/webhooks/inbound/route');
  return POST(req({ action, entity, data }));
}

/** The payload handed to Drizzle for a given op/table, ignoring the log insert. */
function payload(op: string, table: unknown): Record<string, unknown> | undefined {
  const rec = h.ops.find((o) => o.op === op && o.table === table);
  return rec?.payload as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ops = [];
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

// ── 1. Schema ─────────────────────────────────────────────────────────────────

describe('schema: custom_fields column', () => {
  it('deals exposes a customFields column mapped to custom_fields', () => {
    const cols = getTableColumns(deals);
    expect(cols).toHaveProperty('customFields');
    expect(cols.customFields.name).toBe('custom_fields');
  });

  it('tasks exposes a customFields column mapped to custom_fields', () => {
    const cols = getTableColumns(tasks);
    expect(cols).toHaveProperty('customFields');
    expect(cols.customFields.name).toBe('custom_fields');
  });

  it('all five entity tables expose customFields (the gap this closes)', () => {
    const entities = { contacts, companies, leads, deals, tasks };
    const withCustomFields = Object.entries(entities)
      .filter(([, table]) => 'customFields' in getTableColumns(table))
      .map(([name]) => name);

    // Before 0048 this was ['contacts', 'companies', 'leads'] — deals and tasks
    // were the two that silently dropped the value.
    expect(withCustomFields).toEqual(['contacts', 'companies', 'leads', 'deals', 'tasks']);
  });

  it('declares the new columns as jsonb defaulting to {}, like the siblings', () => {
    for (const table of [deals, tasks]) {
      const col = getTableColumns(table).customFields;
      expect(col.dataType).toBe('json');
      expect(col.default).toEqual({});
    }
  });
});

// ── 2. handleDeal ─────────────────────────────────────────────────────────────

describe('handleDeal custom fields', () => {
  it('persists a caller-supplied customFields object on create', async () => {
    const res = await post('create', 'deal', {
      title: 'Enterprise renewal',
      customFields: { contract_ref: 'ACME-2026', seats: 40 },
    });

    expect(res.status).toBe(200);
    expect(payload('insert', deals)).toMatchObject({
      customFields: { contract_ref: 'ACME-2026', seats: 40 },
    });
  });

  it('persists customFields on update', async () => {
    h.findFirst['deals'] = { id: DEAL_ID, tenantId: TENANT_ID };

    const res = await post('update', 'deal', {
      id: DEAL_ID,
      title: 'Enterprise renewal',
      customFields: { renewal_owner: 'jo' },
    });

    expect(res.status).toBe(200);
    expect(payload('update', deals)).toMatchObject({
      customFields: { renewal_owner: 'jo' },
    });
    // Update path must not fall through to an insert.
    expect(payload('insert', deals)).toBeUndefined();
  });

  it('defaults customFields to {} when the caller sends nothing', async () => {
    await post('create', 'deal', { title: 'Bare deal' });
    expect(payload('insert', deals)!['customFields']).toEqual({});
  });

  it('defaults customFields to {} when the caller sends a string', async () => {
    await post('create', 'deal', { title: 'Stringy', customFields: 'not-an-object' });
    expect(payload('insert', deals)!['customFields']).toEqual({});
  });

  it('defaults customFields to {} when the caller sends a number', async () => {
    await post('create', 'deal', { title: 'Numeric', customFields: 42 });
    expect(payload('insert', deals)!['customFields']).toEqual({});
  });

  it('accepts the snake_case custom_fields spelling', async () => {
    await post('create', 'deal', {
      title: 'Snake case',
      custom_fields: { source_system: 'zapier' },
    });
    expect(payload('insert', deals)!['customFields']).toEqual({ source_system: 'zapier' });
  });
});

// ── 3. handleTask ─────────────────────────────────────────────────────────────

describe('handleTask custom fields', () => {
  it('persists a caller-supplied customFields object on create', async () => {
    const res = await post('create', 'task', {
      title: 'Call the customer back',
      customFields: { sla_hours: 4 },
    });

    expect(res.status).toBe(200);
    expect(payload('insert', tasks)).toMatchObject({ customFields: { sla_hours: 4 } });
  });

  it('persists customFields on update', async () => {
    h.findFirst['tasks'] = { id: TASK_ID, tenantId: TENANT_ID };

    const res = await post('update', 'task', {
      id: TASK_ID,
      title: 'Call the customer back',
      customFields: { sla_hours: 1 },
    });

    expect(res.status).toBe(200);
    expect(payload('update', tasks)).toMatchObject({ customFields: { sla_hours: 1 } });
    expect(payload('insert', tasks)).toBeUndefined();
  });

  it('defaults customFields to {} when the caller sends nothing', async () => {
    await post('create', 'task', { title: 'Bare task' });
    expect(payload('insert', tasks)!['customFields']).toEqual({});
  });

  it('defaults customFields to {} when the caller sends a non-object', async () => {
    await post('create', 'task', { title: 'Stringy task', customFields: 'nope' });
    expect(payload('insert', tasks)!['customFields']).toEqual({});
  });
});

// ── 4. The regression itself ──────────────────────────────────────────────────

describe('regression: a deal payload carrying custom fields is not dropped', () => {
  it('round-trips every supplied key into a real deals column', async () => {
    const supplied = { po_number: 'PO-99', region: 'EMEA', nested: { tier: 'gold' } };

    const res = await post('create', 'deal', { title: 'Round trip', customFields: supplied });
    expect(res.status).toBe(200);

    const written = payload('insert', deals)!;
    // The value survives the handler...
    expect(written['customFields']).toEqual(supplied);
    // ...and, unlike before 0048, the key it is written under is a column Drizzle
    // will actually emit, so it reaches the database instead of being discarded.
    expect(Object.keys(getTableColumns(deals))).toContain('customFields');
  });

  it('reports success only because the write really happened', async () => {
    const res = await post('create', 'deal', { title: 'Honest 200', customFields: { a: 1 } });
    const json = await res.json();

    expect(json).toMatchObject({ ok: true, processed: 1, succeeded: 1, failed: 0 });
    expect(payload('insert', deals)!['customFields']).toEqual({ a: 1 });
  });
});
