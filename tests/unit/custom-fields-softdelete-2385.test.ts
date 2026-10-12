/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2385 / #2386 — app/api/tenant/custom-fields must treat tombstones as
 * invisible AND inert.
 *
 * The route soft-deletes field definitions (`DELETE` → set({deletedAt})) and
 * writes entity metadata onto tables that also carry deleted_at, but nothing in
 * it filtered on that column. Reading a predicate's MOCK RETURN VALUE proves
 * nothing, so every assertion here renders the actual SQL: raw `db.execute`
 * templates are flattened from their queryChunks, and drizzle predicates are
 * inspected. Inertness is proven by call counts — if the tombstone probe finds
 * no row, the UPDATE must never be issued at all.
 *
 * #2386 is pinned in the same file because it lives in the same handler: the
 * existence pre-check compared the RAW fieldKey while the INSERT stored a
 * lowercased one, and a local field-type whitelist had drifted from both the
 * zod enum and the DB CHECK constraint (0050_data_validation_checks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { customFieldDefs } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  executes: [] as unknown[],
  executeRows: [] as unknown[][],
  defWheres: [] as unknown[],
  inserts: [] as Array<{ table: unknown; payload: any }>,
  updates: [] as Array<{ table: unknown; payload: any; where: unknown }>,
  defRow: null as unknown,
  defRows: [] as unknown[][],
}));

vi.mock('@/drizzle/db', () => {
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => [],
    then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej),
  };
  const db: any = {
    select: () => selectChain,
    execute: (node: unknown) => {
      h.executes.push(node);
      return Promise.resolve({ rows: h.executeRows.shift() ?? [], rowCount: 0 });
    },
    insert: (table: unknown) => {
      const rec = { table, payload: undefined as any };
      h.inserts.push(rec);
      const chain: any = {
        values: (p: unknown) => { rec.payload = p; return chain; },
        returning: async () => [{ id: 'def-1', fieldKey: rec.payload?.fieldKey, fieldType: rec.payload?.fieldType }],
      };
      return chain;
    },
    update: (table: unknown) => {
      const rec = { table, payload: undefined as any, where: undefined as unknown };
      h.updates.push(rec);
      const chain: any = {
        set: (p: unknown) => { rec.payload = p; return chain; },
        where: (w: unknown) => { rec.where = w; return chain; },
        returning: async () => [{ id: 'def-1' }],
      };
      return chain;
    },
    query: {
      customFieldDefs: {
        findFirst: async ({ where }: any) => { h.defWheres.push(where); return h.defRow; },
        findMany: async ({ where }: any) => { h.defWheres.push(where); return h.defRows.shift() ?? []; },
      },
      webhookFieldMappings: { findFirst: async () => null },
      apiKeys: { findFirst: async () => null },
      featureRegistry: { findMany: async () => [] },
    },
    transaction: async (cb: any) => cb(db),
  };
  return { db };
});

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.com',
    isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: () => Promise.resolve(null),
  concurrencyGuardById: () => Promise.resolve(null),
  updatedAtMs: () => undefined,
  checkStaleUpdate: () => null,
}));
vi.mock('@/lib/api-error', () => ({
  // Fail loudly: a handler that throws must not be mistaken for a pass.
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

const LIVE_ROW = [{ id: 'entity-1', metadata: { tier: 'gold' } }];

function req(url: string, body?: unknown) {
  return new Request(`http://localhost/api/tenant/custom-fields${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

function putReq(body: unknown) {
  return new Request('http://localhost/api/tenant/custom-fields', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** The field-mappings route at the bottom shares this file's db mock. */
function mappingReq(body: unknown) {
  return new Request('http://localhost/api/tenant/webhooks/field-mappings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function route() {
  return import('@/app/api/tenant/custom-fields/route');
}

/**
 * Render a drizzle SQL node back to SQL text + bound params. This is the point
 * of the file: the assertions run on what would actually hit Postgres, not on
 * anything a mock chose to return.
 */
const dialect = new PgDialect();
function render(node: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
  return { sql: q.sql, params: q.params ?? [] };
}

function expectTombstoneFilter(node: unknown, label: string) {
  expect(render(node).sql, label).toMatch(/"?deleted_at"?\s+IS\s+NULL/i);
}

/** Raw `db.execute` templates and built predicates both end up here. */
function sqlOf(node: unknown): string {
  return render(node).sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.executes = [];
  h.executeRows = [];
  h.defWheres = [];
  h.inserts = [];
  h.updates = [];
  h.defRow = null;
  h.defRows = [];
});

// ── GET ?action=values ────────────────────────────────────────────────────────

describe('GET ?action=values (#2385)', () => {
  it('reads only a live entity row', async () => {
    h.executeRows = [LIVE_ROW];
    const { GET } = await route();
    const res = await GET(req('?action=values&entityType=contact&entityId=entity-1'));
    expect(res.status).toBe(200);
    expect(h.executes).toHaveLength(1);
    const text = sqlOf(h.executes[0]);
    expect(text).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(text).toContain('tenant_id');
  });

  it('drops deleted field definitions from the label map', async () => {
    h.executeRows = [LIVE_ROW];
    h.defRows = [[{ fieldKey: 'tier', fieldLabel: 'Tier', fieldType: 'text', fieldOptions: null, deletedAt: null }]];
    const { GET } = await route();
    await GET(req('?action=values&entityType=contact&entityId=entity-1'));
    expectTombstoneFilter(h.defWheres[0], 'values field-definition query');
  });

  it.each(['user', 'tenant'])('refuses entityType=%s with 400 instead of a 500 from a missing tenant_id column', async (entityType) => {
    const { GET } = await route();
    const res = await GET(req(`?action=values&entityType=${entityType}&entityId=entity-1`));
    expect(res.status).toBe(400);
    // No SQL at all: the old code reached Postgres and died on 42703.
    expect(h.executes).toHaveLength(0);
  });
});

// ── POST ?action=set-value ────────────────────────────────────────────────────

describe('POST ?action=set-value (#2385)', () => {
  const body = { entityType: 'deal', entityId: 'deal-1', fieldKey: 'Tier', value: 'gold' };

  it('scopes the ownership probe and the write itself', async () => {
    h.executeRows = [[{ id: 'deal-1' }], []];
    const { POST } = await route();
    const res = await POST(req('?action=set-value', body));
    expect(res.status).toBe(200);
    expect(h.executes).toHaveLength(2);

    const probe = sqlOf(h.executes[0]);
    expect(probe).toMatch(/deleted_at\s+IS\s+NULL/i);

    const write = sqlOf(h.executes[1]);
    expect(write, 'UPDATE must not rely on the read above it for tenancy').toMatch(/^UPDATE/i);
    expect(write).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(write).toContain('tenant_id');
  });

  it('is inert for a tombstone: the UPDATE is never issued', async () => {
    h.executeRows = [[]]; // probe finds nothing — deleted_at IS NULL excluded it
    const { POST } = await route();
    const res = await POST(req('?action=set-value', body));
    expect(res.status).toBe(404);
    expect(h.executes).toHaveLength(1);
    // The probe is what excluded the tombstone — that is why no UPDATE ran.
    expect(sqlOf(h.executes[0])).toMatch(/deleted_at\s+IS\s+NULL/i);
  });

  it('rejects a non-string fieldKey with 400, not a TypeError 500', async () => {
    const { POST } = await route();
    const res = await POST(req('?action=set-value', { ...body, fieldKey: 123 }));
    expect(res.status).toBe(400);
    expect(h.executes).toHaveLength(0);
  });

  it('refuses an entity type with no tenant_id column before touching SQL', async () => {
    const { POST } = await route();
    const res = await POST(req('?action=set-value', { ...body, entityType: 'user' }));
    expect(res.status).toBe(400);
    expect(h.executes).toHaveLength(0);
  });
});

// ── POST ?action=set-bulk ─────────────────────────────────────────────────────

describe('POST ?action=set-bulk (#2385)', () => {
  const body = { entityType: 'company', entityId: 'co-1', fields: { tier: 'gold' } };

  it('filters the read and the write', async () => {
    h.executeRows = [LIVE_ROW, []];
    const { POST } = await route();
    const res = await POST(req('?action=set-bulk', body));
    expect(res.status).toBe(200);
    expect(h.executes).toHaveLength(2);
    for (const [i, node] of h.executes.entries()) {
      expect(sqlOf(node), `statement ${i}`).toMatch(/deleted_at\s+IS\s+NULL/i);
      expect(sqlOf(node), `statement ${i}`).toContain('tenant_id');
    }
  });

  it('is inert for a tombstone', async () => {
    h.executeRows = [[]];
    const { POST } = await route();
    const res = await POST(req('?action=set-bulk', body));
    expect(res.status).toBe(404);
    expect(h.executes).toHaveLength(1);
    expect(sqlOf(h.executes[0])).toMatch(/deleted_at\s+IS\s+NULL/i);
  });
});

// ── GET list · PUT · POST create ──────────────────────────────────────────────

describe('field definitions (#2385, #2386)', () => {
  it('hides deleted definitions from the settings list', async () => {
    const { GET } = await route();
    await GET(req('?entityType=contact'));
    expectTombstoneFilter(h.defWheres[0], 'definition list query');
  });

  it('refuses to edit a tombstone', async () => {
    const { PUT } = await route();
    const res = await PUT(putReq({ fieldId: '33333333-3333-4333-8333-333333333333', fieldLabel: 'Renamed' }));
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe(customFieldDefs);
    expectTombstoneFilter(h.updates[0].where, 'PUT update predicate');
  });

  it('compares the key it is about to store, so a case flip cannot reach the unique index', async () => {
    const { POST } = await route();
    const res = await POST(req('', {
      entityType: 'contact', fieldKey: 'FOO', fieldLabel: 'Foo', fieldType: 'text',
    }));
    expect(res.status).toBe(201);
    expect(h.inserts[0].payload.fieldKey).toBe('foo');
    // The pre-check ran against the stored spelling, not the raw request.
    expect(render(h.defWheres[0]).params).toContain('foo');
    expect(render(h.defWheres[0]).params).not.toContain('FOO');
  });

  it('names the tombstone when a deleted field still reserves the key', async () => {
    h.defRow = { id: 'def-1', fieldKey: 'foo', deletedAt: new Date() };
    const { POST } = await route();
    const res = await POST(req('', {
      entityType: 'contact', fieldKey: 'foo', fieldLabel: 'Foo', fieldType: 'text',
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/reserved/i);
    expect(h.inserts).toHaveLength(0);
  });

  it('keeps the plain message for a live duplicate', async () => {
    h.defRow = { id: 'def-1', fieldKey: 'foo', deletedAt: null };
    const { POST } = await route();
    const res = await POST(req('', {
      entityType: 'contact', fieldKey: 'foo', fieldLabel: 'Foo', fieldType: 'text',
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Field 'foo' already exists for contact");
  });

  it('stores currency as currency — the drifted local whitelist used to downgrade it to text (#2386)', async () => {
    const { POST } = await route();
    const res = await POST(req('', {
      entityType: 'contact', fieldKey: 'rate', fieldLabel: 'Rate', fieldType: 'currency',
    }));
    expect(res.status).toBe(201);
    expect(h.inserts[0].payload.fieldType).toBe('currency');
  });
});

// ── The other reader of custom_field_defs ─────────────────────────────────────

describe('POST /api/tenant/webhooks/field-mappings target (#2385)', () => {
  it('refuses to map an inbound key onto a deleted field definition', async () => {
    h.defRow = null; // no LIVE definition — and validateTarget must not see the tombstone
    const { POST } = await import('@/app/api/tenant/webhooks/field-mappings/route');
    const res = await POST(mappingReq({
      entityType: 'contact', sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'tier',
    }));
    expect(res.status).toBe(400);
    expect(h.defWheres).toHaveLength(1);
    expectTombstoneFilter(h.defWheres[0], 'mapping target lookup');
    expect(h.inserts).toHaveLength(0);
  });
});
