/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3147 — `POST /api/tenant/import` is the generic JSON-array twin of the CSV
 * importers, and it was the un-gated one: it inserted up to 1000 rows per
 * request outside any transaction, never read `plans.maxContacts`, and never
 * maintained `tenants.currentContacts`.
 *
 * So any `settings.manage` member could admit unlimited contacts to a
 * plan-capped tenant (1000 per call, repeatable) — the exact hole #3080 closed
 * on the CSV door — and every generic import silently desynced the counter that
 * later single-record creates enforce their quota against.
 *
 * The property these tests hold is #3080's rule: the `FOR UPDATE` read, the
 * quota test, the writes and the counter bump are ONE transaction, the quota is
 * priced against the rows that are actually valid, and the bump is SQL-side.
 * `companies` owns no counter and must not be gated or bumped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  /** Results for successive select() chains, in call order. */
  selects: [] as unknown[][],
  /** Rows handed to an insert, with the table they were aimed at. */
  inserts: [] as Array<{ table: string; rows: unknown[] }>,
  /** Objects handed to an update().set(). */
  patches: [] as Record<string, unknown>[],
  /** What each `.for(…)` was called with — the lock is part of the contract. */
  locks: [] as unknown[][],
  /** Table names whose insert rejects, to exercise the per-batch error path. */
  failOn: new Set<string>(),
  permDeny: null as NextResponse | null,
}));

function next(): unknown[] {
  return h.selects.length ? (h.selects.shift() as unknown[]) : [];
}

/** Mirrors the real chain: the same object is thenable AND `.limit`/`.for`-capable. */
function makeChain(label: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.for = vi.fn((mode: unknown) => {
    h.locks.push([mode]);
    return Promise.resolve(next());
  });
  chain.then = (ok?: (v: unknown) => unknown, err?: (reason: unknown) => unknown) =>
    Promise.resolve(next()).then(ok, err);

  chain.insert = vi.fn((table: { __name?: string }) => ({
    values: (rows: unknown[]) => {
      const name = table?.__name ?? label;
      h.inserts.push({ table: name, rows });
      if (h.failOn.has(name)) return Promise.reject(new Error(`duplicate key value violates unique constraint (on ${name})`));
      return Promise.resolve([{ id: 'row' }]);
    },
  }));

  chain.update = vi.fn(() => ({
    set: (values: Record<string, unknown>) => {
      h.patches.push(values);
      return { where: () => Promise.resolve({ rowCount: 1 }) };
    },
  }));

  // A nested transaction is drizzle's SAVEPOINT; the fake just reuses the chain.
  chain.transaction = vi.fn(async (cb: (tx: Record<string, unknown>) => unknown) => cb(chain));
  return chain;
}

const chain = makeChain('default');
vi.mock('@/drizzle/db', () => ({
  db: {
    ...chain,
    transaction: async (cb: (tx: Record<string, unknown>) => unknown) => cb(chain),
  },
}));
vi.mock('@/drizzle/schema', () => ({
  contacts: { __name: 'contacts', id: 'contacts.id', tenantId: 'contacts.tenant_id' },
  companies: { __name: 'companies', id: 'companies.id', tenantId: 'companies.tenant_id' },
  leads: { __name: 'leads', id: 'leads.id', tenantId: 'leads.tenant_id' },
  tenants: {
    id: 'tenants.id', planId: 'tenants.plan_id',
    currentContacts: 'tenants.current_contacts', maxContacts: 'tenants.max_contacts',
  },
  plans: { id: 'plans.id', maxContacts: 'plans.max_contacts' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: Array.from(strings).join('?'), values,
  }),
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: () => Promise.resolve(null) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({ userId: 'u-1', tenantId: 't-1' }),
  requirePerm: () => h.permDeny,
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

function post(body: Record<string, unknown>) {
  return new Request('http://localhost/api/tenant/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** The tenant+plan row the FOR UPDATE read answers with. */
function queuePlan(currentContacts: number | null, maxContacts: number | null): void {
  h.selects.push([{ currentContacts, maxContacts }]);
}

const rec = (over: Record<string, string> = {}) => ({ first_name: 'Ada', email: 'ada@import.test', ...over });
const records = (n: number, over: Record<string, string> = {}) =>
  Array.from({ length: n }, (_, i) => rec({ ...over, first_name: `Ada ${i}` }));

async function runRoute(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import('@/app/api/tenant/import/route');
  return POST(post(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selects = [];
  h.inserts = [];
  h.patches = [];
  h.locks = [];
  h.failOn = new Set();
  h.permDeny = null;
});

describe('the generic importer is gated like the CSV one (#3147)', () => {
  it('refuses a lead import that would cross maxContacts, and writes nothing', async () => {
    queuePlan(100, 100);
    const res = await runRoute({ entity: 'leads', records: records(1) });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('plan limit of 100');
    expect(h.inserts).toEqual([]);
    expect(h.patches).toEqual([]);
  });

  it('prices leads against the contacts pool and says so', async () => {
    queuePlan(98, 100);
    const res = await runRoute({ entity: 'leads', records: records(3) });
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('leads share the contacts pool');
  });

  it('inserts everything the plan allows and bumps currentContacts SQL-side by the count', async () => {
    queuePlan(3, 10);
    const res = await runRoute({ entity: 'contacts', records: records(5) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { imported: number } };
    expect(body.data.imported).toBe(5);

    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.table).toBe('contacts');
    expect(h.inserts[0]!.rows).toHaveLength(5);

    // One update, and it is `COALESCE(current,0) + 5` evaluated by Postgres —
    // not a number this request read, which two concurrent imports would each
    // write back over the other.
    expect(h.patches).toHaveLength(1);
    const bump = h.patches[0]!.currentContacts as { sql: string; values: unknown[] };
    expect(bump.sql).toContain('COALESCE');
    expect(bump.values).toContain(5);
  });

  it('locks the tenant row for the quota read', async () => {
    queuePlan(0, 50);
    await runRoute({ entity: 'contacts', records: records(2) });
    expect(h.locks).toEqual([['update']]);
  });

  it('charges only rows that are actually valid, so rejections free quota', async () => {
    // 5 records, 2 missing first_name: the request costs 3, not 5. On main the
    // gate did not exist at all; a gate priced off records.length would 403 here.
    queuePlan(1, 4);
    const res = await runRoute({
      entity: 'contacts',
      records: [...records(2), rec({ first_name: '' }), rec({ first_name: '' }), rec({ first_name: 'Zoe' })],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { imported: number; errors: unknown[] } };
    expect(body.data.imported).toBe(3);
    expect(body.data.errors).toHaveLength(2);
    expect((h.patches[0]!.currentContacts as { values: unknown[] }).values).toContain(3);
  });

  it('leaves companies out of the gate — no quota read, no counter bump', async () => {
    const res = await runRoute({
      entity: 'companies',
      records: Array.from({ length: 4 }, (_, i) => ({ name: `Acme ${i}` })),
    });
    expect(res.status).toBe(200);
    expect(h.locks).toEqual([]);
    expect(h.selects).toHaveLength(0); // the FOR UPDATE read never happened
    expect(h.inserts[0]!.table).toBe('companies');
    expect(h.patches).toEqual([]);
  });

  it('treats a null maxContacts as unlimited and still maintains the counter', async () => {
    queuePlan(400, null);
    const res = await runRoute({ entity: 'contacts', records: records(60) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { imported: number } };
    expect(body.data.imported).toBe(60);
    // 60 > BATCH_SIZE, so the counter is the sum of both batches, not one.
    expect(h.inserts).toHaveLength(2);
    expect((h.patches[0]!.currentContacts as { values: unknown[] }).values).toContain(60);
  });

  it('keeps the documented partial-success contract when the database refuses a batch', async () => {
    // The response shape promises errors[] per batch; a savepoint keeps that
    // without letting one bad batch take the rest down with it.
    h.failOn.add('leads');
    queuePlan(0, 100);
    const res = await runRoute({ entity: 'leads', records: records(3) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { imported: number; errors: Array<{ error: string }> } };
    expect(body.data.imported).toBe(0);
    expect(body.data.errors[0]!.error).toContain('Batch failed');
    // Nothing landed, so nothing may be counted against the plan.
    expect(h.patches).toEqual([]);
  });

  it('reads a NULL currentContacts as zero, not as an unlimited tenant', async () => {
    // Legacy tenants were created before the counter existed, so the column is
    // nullable; `?? 0` is what keeps a null counter from failing the gate open.
    queuePlan(null, 2);
    const refused = await runRoute({ entity: 'contacts', records: records(3) });
    expect(refused.status).toBe(403);

    queuePlan(null, 2);
    const allowed = await runRoute({ entity: 'contacts', records: records(2) });
    expect(allowed.status).toBe(200);
  });
});
