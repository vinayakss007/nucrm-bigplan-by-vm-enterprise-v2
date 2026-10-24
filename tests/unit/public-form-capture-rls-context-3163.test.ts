/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3163 — anonymous form capture must establish an RLS context.
 *
 * `forms`, `contacts`, `form_submissions`, `activities` and `leads` are all
 * `FORCE ROW LEVEL SECURITY` (0031 + 0068) and the pool pins `app.current_tenant`
 * to '' on every checkout (lib/db/pool.ts:241, lib/db/request-connection.ts:94),
 * so a contextless read of them is a SILENT ZERO-ROW read and a contextless
 * write is a loud `42501`. Measured on the shipped policy set:
 *
 *   set_config('app.current_tenant','')       -> SELECT count(*) FROM forms = 0
 *   set_config('app.current_tenant', <owner>) -> SELECT count(*) FROM forms = 3
 *   INSERT INTO form_submissions … ctx=''      -> 42501 violates row-level security policy
 *
 * A mocked `db` answers whatever it is told, which is how every one of these
 * routes stayed "green" while the real pool returned nothing. These tests
 * therefore pin the CONTEXT, not the rows: a route that touches a
 * tenant-policyed table without naming the policy's value is red here, which is
 * exactly what all three of them looked like at base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const ROOT = process.cwd();
const TENANT = '10000000-0000-4000-8000-000000000001';
const FORM = '85000000-0000-0000-0000-000000000001';
const CONTACT = 'c0000000-0000-4000-8000-000000000001';
const NO_USER = '00000000-0000-0000-0000-000000000000';

const H = vi.hoisted(() => ({
  /** every set_config-style statement the routes execute, tagged with its tx */
  statements: [] as { tx: number; sql: string; params: unknown[] }[],
  /** one entry per db.transaction() call: ['txN:begin', …ops, 'commit'] */
  txOps: [] as string[][],
  /** statements executed on the shared pool — i.e. with no transaction context */
  poolStatements: [] as { sql: string; params: unknown[] }[],
  /** anything reached on the bare `db`, which for these routes is the bug itself */
  bare: [] as string[],
  formRow: null as unknown,
  tenantRow: null as unknown,
}));

vi.mock('@/drizzle/db', () => {
  const queryOf = (fragment: unknown) =>
    new PgDialect({} as never).sqlToQuery(fragment as Parameters<PgDialect['sqlToQuery']>[0]);

  const rowsChain = (rows: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'returning', 'values', 'set']) b[m] = () => b;
    b['limit'] = () => rows;
    b['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
    return b;
  };

  let txCount = 0;

  const makeTx = (id: number) => {
    const ops: string[] = [`tx${id}:begin`];
    return {
      ops,
      execute: async (fragment: unknown) => {
        const { sql, params } = queryOf(fragment);
        H.statements.push({ tx: id, sql, params });
        ops.push('execute');
        return { rows: [] };
      },
      select: () => { ops.push('select'); return rowsChain(H.formRow ? [H.formRow] : []); },
      insert: (table: unknown) => {
        ops.push(`insert:${getTableName(table as never)}`);
        return {
          values: () => ({
            returning: async () => [{ id: CONTACT }],
            then: (resolve: (v: unknown) => unknown) => resolve([{ id: CONTACT }]),
          }),
        };
      },
      update: (table: unknown) => {
        ops.push(`update:${getTableName(table as never)}`);
        return { set: () => ({ where: async () => [] }) };
      },
      query: {
        forms: { findFirst: async () => { ops.push('query:forms'); return H.formRow; } },
        contacts: { findFirst: async () => { ops.push('query:contacts'); return { id: CONTACT, tags: [], email: 'ada@example.com' }; } },
        companies: { findFirst: async () => { ops.push('query:companies'); return { id: 'a0000000-0000-4000-8000-000000000001' }; } },
        leads: { findFirst: async () => { ops.push('query:leads'); return null; } },
      },
    };
  };

  const pool = (label: string) => {
    H.bare.push(label);
    return rowsChain([]);
  };

  return {
    db: {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const id = txCount;
        txCount += 1;
        const tx = makeTx(id);
        const out = await fn(tx);
        tx.ops.push('commit');
        H.txOps.push(tx.ops);
        return out;
      },
      select: () => pool('select'),
      insert: () => pool('insert'),
      update: () => pool('update'),
      query: {
        forms: { findFirst: async () => { H.bare.push('query.forms'); return H.formRow; } },
        contacts: { findFirst: async () => { H.bare.push('query.contacts'); return null; } },
        tenants: { findFirst: async () => { H.bare.push('query.tenants'); return H.tenantRow; } },
        companies: { findFirst: async () => { H.bare.push('query.companies'); return null; } },
        leads: { findFirst: async () => { H.bare.push('query.leads'); return null; } },
      },
      execute: async (fragment: unknown) => {
        const { sql, params } = queryOf(fragment);
        H.poolStatements.push({ sql, params });
        return { rows: [] };
      },
    },
  };
});

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/formula/sync', () => ({ syncCalculatedFields: vi.fn(async () => undefined) }));

const statementsIn = (txId: number) => H.statements.filter(s => s.tx === txId);
const contextStmt = (txId: number) => statementsIn(txId).filter(s => /app\.current_tenant/.test(s.sql));
/** `setPortalLookupContext`'s shape passes the GUC NAME as a bind parameter, so
 *  the name is in `params`, not in the rendered text. Match both spellings. */
const isLookup = (s: { sql: string; params: unknown[] }) =>
  /app\.form_lookup_id/.test(s.sql) || s.params.includes('app.form_lookup_id');
const lookupStmt = (txId: number) => statementsIn(txId).filter(isLookup);
/** the transaction id a recorded op list belongs to, from its `txN:begin` marker */
const txIdOf = (ops: string[]) => Number(/^tx(\d+):begin$/.exec(ops[0]!)![1]);

async function callFormsSubmit(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import('@/app/api/forms/submit/route');
  return POST(new NextRequest(new URL('http://localhost/api/forms/submit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never);
}

async function callLeads(body: Record<string, unknown>, method: 'POST' | 'GET' = 'POST'): Promise<Response> {
  const mod = await import('@/app/api/leads/public/route');
  const url = method === 'GET'
    ? new URL(`http://localhost/api/leads/public?email=ada%40example.com&tenant_id=${TENANT}`)
    : new URL('http://localhost/api/leads/public');
  const req = new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest;
  const handler = (method === 'POST' ? mod.POST : mod.GET) as unknown as (r: NextRequest) => Promise<Response>;
  return handler(req);
}

beforeEach(() => {
  H.statements = [];
  H.txOps = [];
  H.poolStatements = [];
  H.bare = [];
  H.formRow = {
    id: FORM, tenantId: TENANT, name: 'Contact Us', isActive: true,
    fields: [], settings: {}, owner_id: null, tenant_status: 'active', tenantStatus: 'active',
  };
  H.tenantRow = { id: TENANT, name: 'Acme', ownerId: null, status: 'active', currentContacts: 1, planId: null };
});

describe('the capture READ is a lookup context, not a context-less pool read (#3163)', () => {
  it('POST /api/forms/submit never reads `forms` on the shared pool', async () => {
    const res = await callFormsSubmit({ form_id: FORM, data: { email: 'ada@example.com' } });
    expect(res.status, 'a published form of a real tenant is not a 404').toBe(200);
    expect(H.bare.filter(b => b.includes('forms'))).toEqual([]);
  });

  it('the form read opens its transaction with app.form_lookup_id, transaction-local', async () => {
    await callFormsSubmit({ form_id: FORM, data: { email: 'ada@example.com' } });
    const set = lookupStmt(txIdOf(H.txOps[0]!));
    expect(set).toHaveLength(1);
    expect(set[0]!.params[0]).toBe('app.form_lookup_id');
    expect(set[0]!.params[1]).toBe(FORM);
    expect(set[0]!.sql).toContain('true');
    expect(set[0]!.sql).not.toContain('false');
    const ops = H.txOps[0]!;
    expect(ops[1], 'the context is the first statement of its transaction').toBe('execute');
    expect(ops[2], '…and only then does the read run').toBe('select');
  });

  it('GET /api/tenant/forms/public/[id] answers 200 through that context', async () => {
    const { GET } = await import('@/app/api/tenant/forms/public/[id]/route');
    const req = new NextRequest(`http://localhost/api/tenant/forms/public/${FORM}`) as never;
    const res = await GET(req, { params: Promise.resolve({ id: FORM }) });
    expect(res.status, JSON.stringify(await res.json())).toBe(200);
    expect(H.bare).toEqual([]);
    expect(lookupStmt(txIdOf(H.txOps[0]!))).toHaveLength(1);
  });

  it('a form id that cannot name a row never reaches the policy cast', async () => {
    const res = await callFormsSubmit({ form_id: 'not-a-uuid', data: {} });
    expect(res.status).toBe(400);
    expect(H.statements.filter(s => /app\.form_lookup_id/.test(s.sql))).toEqual([]);
    expect(H.txOps).toEqual([]);
  });
});

describe('the capture WRITES run under the form tenant (#3163)', () => {
  it('the submission transaction names app.current_tenant = the form tenant before any write', async () => {
    const res = await callFormsSubmit({ form_id: FORM, data: { email: 'ada@example.com', message: 'hi' } });
    expect(res.status).toBe(200);
    const capture = H.txOps.find(o => o.includes('insert:form_submissions'))!;
    expect(capture, 'the submission is written').toBeDefined();
    const ctx = contextStmt(txIdOf(capture));
    expect(ctx, 'a contextless write is 42501: new row violates row-level security policy').toHaveLength(1);
    expect(ctx[0]!.params).toContain(TENANT);
    expect(ctx[0]!.params).toContain(NO_USER);
    expect(ctx[0]!.sql).toContain('true');
    const captureOps = H.txOps[H.txOps.indexOf(capture)];
    expect(captureOps![1], 'the tenant context is this transaction’s first statement').toBe('execute');
    expect(captureOps!.findIndex(o => o.startsWith('insert:')), 'the first write comes after it').toBeGreaterThan(1);
  });

  it('the after-commit note insert gets its own context rather than inheriting none', async () => {
    await callFormsSubmit({ form_id: FORM, data: { email: 'ada@example.com', message: 'a note' } });
    const note = H.txOps.find(o => o.includes('insert:activities') && !o.includes('insert:form_submissions'));
    expect(note, 'a post-commit activities write exists').toBeDefined();
    expect(contextStmt(txIdOf(note!)), 'this one was contextless at base too').toHaveLength(1);
    expect(contextStmt(txIdOf(note!))[0]!.params).toContain(TENANT);
  });

  it('the whole-row contact read is scoped, so the formula engine actually gets input', async () => {
    await callFormsSubmit({ form_id: FORM, data: { email: 'ada@example.com' } });
    const reader = H.txOps.find(o => o.includes('query:contacts') && !o.some(x => x.startsWith('insert:')));
    expect(reader, 'a read-only contact context exists').toBeDefined();
    expect(contextStmt(txIdOf(reader!))[0]!.params).toContain(TENANT);
  });

  it('POST /api/leads/public captures under the organization it verified', async () => {
    const res = await callLeads({
      first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com',
      company: 'Acme', tenant_id: TENANT, form_id: FORM, message: 'hello',
    });
    expect(res.status, 'the capture write used to die on 42501').toBe(201);
    const capture = H.txOps.find(o => o.includes('insert:leads'))!;
    expect(capture).toBeDefined();
    expect(contextStmt(txIdOf(capture))).toHaveLength(1);
    expect(contextStmt(txIdOf(capture))[0]!.params).toContain(TENANT);
    expect(H.bare.filter(b => b.includes('forms')), 'the ownership lookup is not a pool read').toEqual([]);
  });

  it('it still refuses an unknown organization before opening any context', async () => {
    H.tenantRow = null;
    const res = await callLeads({ first_name: 'Ada', email: 'ada@example.com', tenant_id: TENANT });
    expect(res.status).toBe(404);
    expect(H.statements).toEqual([]);
    expect(H.txOps).toEqual([]);
  });

  it('GET /api/leads/public?email=…&tenant_id=… reads contacts under that tenant', async () => {
    const res = await callLeads({}, 'GET');
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('exists');
    expect(H.bare.filter(b => b.includes('contacts')), 'the existence check was a contextless zero').toEqual([]);
    expect(contextStmt(txIdOf(H.txOps[0]!))[0]!.params).toContain(TENANT);
  });
});

describe('the privilege itself (migration 0132 + the GUC reset lists)', () => {
  // Each test reads its own file. A describe-scope readFileSync throws during
  // collection when the migration is absent, which collapses the whole file to
  // "1 failed / no tests ran" and destroys the base RED measurement.
  const grant = () => {
    const up = readFileSync(join(ROOT, 'drizzle/migrations/0132_public_form_capture_lookup.sql'), 'utf8');
    return up.slice(up.indexOf('CREATE POLICY'));
  };
  const down = () => readFileSync(join(ROOT, 'drizzle/migrations/0132_public_form_capture_lookup.down.sql'), 'utf8');

  it('grants SELECT only, keyed on the one id the caller named', () => {
    expect(grant()).toMatch(/FOR SELECT/);
    expect(grant()).toContain("current_setting('app.form_lookup_id', true)");
    expect(grant()).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(grant()).not.toContain('app.is_super_admin');
    expect(grant()).not.toContain('app.current_tenant');
    expect(grant()).not.toContain(' USING (\n  true');
  });

  it('keeps an unpublished or trashed form out of the anonymous read', () => {
    expect(grant()).toContain('is_active = true');
    expect(grant()).toContain('deleted_at IS NULL');
  });

  it('is journaled, so every runner can actually apply it, and reverses cleanly', () => {
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/migrations/meta/_journal.json'), 'utf8')) as
      { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map(e => e.tag)).toContain('0132_public_form_capture_lookup');
    const idxs = journal.entries.map(e => e.idx);
    expect(idxs.every((v, i) => i === 0 || v > idxs[i - 1]!)).toBe(true);
    expect(down()).toContain('DROP POLICY IF EXISTS "forms_public_capture_lookup"');
  });

  it.each([
    ['lib/db/pool.ts'],
    ['lib/db/request-connection.ts'],
  ])('%s resets app.form_lookup_id on checkout, or PgBouncer hands it to the next request', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8'))
      .toContain("set_config('app.form_lookup_id', '', false)");
  });
});
