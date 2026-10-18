/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2530 (part 2) — a `compliance_requests` row that dies mid-flight said
 * `processing` forever.
 *
 * Both compliance routes insert a `processing` row, do the work, then write a
 * terminal marker. Anything that dies between those writes — SIGTERM past the
 * drain deadline, an OOM kill, a redeploy, or the marker `UPDATE` itself
 * throwing — left the row saying `processing` with no path out, because nothing
 * else in the tree ever writes that column except the request that is already
 * gone. For a `gdpr_delete` the log is the deliverable: an unresolved Article 17
 * request cannot be told apart from one that never ran.
 *
 * The second defect was inside the first. The `completed` marker sat in the same
 * `try` as the work, whose `catch` writes `failed`. So a request whose erasure
 * RAN and whose marker write then threw was recorded as `failed` — the log
 * asserting that an erasure had not happened, when it had. Every test in the
 * "POST" blocks below exists to keep that inversion from coming back.
 *
 * What is asserted is behaviour, not source text: which statements reached the
 * client, with what `set`, on which connection, and what the caller was told.
 * The reaper's `UPDATE` is rendered to SQL (`PgDialect`) to prove its `WHERE`
 * carries the id, the tenant and the `status = 'processing'` compare — the CAS
 * that makes the reaper unable to overwrite a marker that landed first.
 *
 * The status vocabulary is read out of the migration chain rather than hardcoded
 * here: `chk_compliance_requests_status` (`0050_data_validation_checks.sql`)
 * rejects anything else at write time, so this file cannot say "the reaper is
 * legal" from a list it invented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbClient } from '@/drizzle/db';

interface Stmt {
  op: 'insert' | 'update';
  table: string;
  set: Record<string, unknown>;
  where?: unknown;
}

const H = vi.hoisted(() => ({
  state: {
    statements: [] as Stmt[],
    /** popped, one per `db.select()…limit()` — the GETs issue two */
    selectQueue: [] as unknown[][],
    /** an `UPDATE` whose `set.status` equals this throws instead of landing */
    failStatus: null as string | null,
  },
  tableOf: (table: unknown): string => {
    const name = (table as Record<symbol, unknown> | undefined)?.[Symbol.for('drizzle:Name')];
    return typeof name === 'string' ? name : 'unknown';
  },
}));

vi.mock('@/drizzle/db', () => {
  // A rejected promise that is still a thenable: the caller `await`s the whole
  // chain, so the injected failure must surface from that await.
  const fail = () => Promise.reject(new Error('injected marker write failure'));

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(H.state.selectQueue.shift() ?? []),
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          H.state.statements.push({ op: 'insert', table: H.tableOf(table), set: values });
          return Promise.resolve([{ id: REQUEST_ID, ...values }]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (whereClause: unknown) => {
          H.state.statements.push({ op: 'update', table: H.tableOf(table), set: values, where: whereClause });
          return H.state.failStatus === values.status ? fail() : Promise.resolve({ rowCount: 1 });
        },
      }),
    }),
    execute: () => Promise.resolve({ rows: [] }),
  };

  return { db };
});

const mockExport = vi.hoisted(() => vi.fn());
const mockAnonymize = vi.hoisted(() => vi.fn());
const mockSoc2 = vi.hoisted(() => vi.fn());
// #2611's bulk sweep runs ahead of the read in both routes. This file is about
// the read-time reaper and the terminal markers; the bulk statement is pinned
// against a real drizzle in compliance-stale-reap-2530.test.ts.
const mockBulkReap = vi.hoisted(() => vi.fn(async () => 0));

vi.mock('@/lib/compliance/stale-requests', () => ({
  reapStaleProcessingRequests: mockBulkReap,
  STALE_PROCESSING_MS: 15 * 60 * 1000,
}));
vi.mock('@/lib/compliance/gdpr', () => ({
  exportTenantData: mockExport,
  anonymizeTenantData: mockAnonymize,
}));
vi.mock('@/lib/compliance/soc2', () => ({ generateSOC2Report: mockSoc2 }));

vi.mock('@/lib/api-error', () => ({
  // Distinct body on purpose: a test that says "the marker failure did not reach
  // apiError" is only meaningful if the two 500s are tellable apart.
  apiError: () => Response.json({ error: 'fell through to apiError' }, { status: 500 }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    userId: 'user-1',
    tenantId: TENANT_ID,
    email: 'a@b.c',
    role: 'admin',
    isAdmin: true,
    isSuperAdmin: false,
  })),
}));
vi.mock('@/lib/modules/gate', () => ({ requireModule: vi.fn(async () => null) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: async (req: Request) => req.json(),
}));

import {
  PROCESSING_DEADLINE_MS,
  STALE_PROCESSING_MESSAGE,
  isStaleProcessing,
  markRequestCompleted,
  markRequestFailed,
  reapStaleProcessing,
} from '@/lib/compliance/request-lifecycle';
import { GET as GDPR_GET, POST as GDPR_POST } from '@/app/api/tenant/compliance/gdpr/route';
import { GET as SOC2_GET, POST as SOC2_POST } from '@/app/api/tenant/compliance/soc2/route';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_TENANT_ID = '20000000-0000-4000-8000-000000000002';
const REQUEST_ID = '30000000-0000-4000-8000-000000000003';

const sqlText = (arg: unknown): string =>
  new PgDialect().sqlToQuery(arg as Parameters<PgDialect['sqlToQuery']>[0]).sql;

/** The four values the live CHECK constraint accepts, read from the chain. */
function statusVocabulary(): string[] {
  const dir = path.join(process.cwd(), 'drizzle', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // Last writer wins, exactly as `scripts/migrate.ts` applies them.
  let defining: string | null = null;
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    if (text.includes('chk_compliance_requests_status')) defining = text;
  }
  if (!defining) throw new Error('no migration in the chain defines chk_compliance_requests_status');
  const match = /chk_compliance_requests_status[\s\S]{0,200}?IN\s*\(([^)]*)\)/.exec(defining);
  if (!match) throw new Error('chk_compliance_requests_status matched but its IN (…) list did not parse');
  return [...match[1].matchAll(/'([^']+)'/g)].map((g) => g[1]);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  tenantId: TENANT_ID,
  type: 'gdpr_export',
  status: 'processing',
  createdAt: new Date(),
  ...over,
});

const stale = (over: Record<string, unknown> = {}) =>
  row({ createdAt: new Date(Date.now() - PROCESSING_DEADLINE_MS - 60_000), ...over });

/** Local recorder for the helper units, so the SQL assertions have one source. */
function recorder(opts: { throwing?: boolean } = {}) {
  const writes: { set: Record<string, unknown>; where: unknown }[] = [];
  const client = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (whereClause: unknown) => {
          writes.push({ set: values, where: whereClause });
          expect(H.tableOf(table)).toBe('compliance_requests');
          return opts.throwing
            ? Promise.reject(new Error('injected update failure'))
            : Promise.resolve({ rowCount: 1 });
        },
      }),
    }),
  } as unknown as DbClient;
  return { client, writes };
}

function get(url: string): Promise<Response> {
  return Promise.resolve(
    (url.includes('soc2') ? SOC2_GET : GDPR_GET)(new Request(`http://x${url}`) as never),
  ) as Promise<Response>;
}

function post(url: string, body: unknown): Promise<Response> {
  const handler = url.includes('soc2') ? SOC2_POST : GDPR_POST;
  const request = new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
  return Promise.resolve(handler(request)) as Promise<Response>;
}

const updates = () => H.state.statements.filter((s) => s.op === 'update');
const json = (res: Response) => res.json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  // Truncated in place. Every read in the doubles goes through `H.state.<field>`
  // at call time, so a test may also replace one wholesale (the GETs below do
  // exactly that for `selectQueue`) without orphaning anything.
  H.state.statements.length = 0;
  H.state.selectQueue.length = 0;
  H.state.failStatus = null;
});

describe('#2530 the deadline rule', () => {
  it('fires strictly after the deadline, not at it', () => {
    const now = 1_800_000_000_000;
    expect(isStaleProcessing(row({ createdAt: new Date(now - PROCESSING_DEADLINE_MS) }), now)).toBe(false);
    expect(
      isStaleProcessing(row({ createdAt: new Date(now - PROCESSING_DEADLINE_MS - 1) }), now),
    ).toBe(true);
  });

  it('only `processing` is ever abandoned', () => {
    const now = 1_800_000_000_000;
    for (const status of ['completed', 'failed', 'pending']) {
      expect(isStaleProcessing(row({ status, createdAt: new Date(0) }), now)).toBe(false);
    }
  });

  it('a row with no readable created_at cannot claim processing forever', () => {
    for (const createdAt of [null, undefined, 'not a date']) {
      expect(isStaleProcessing(row({ createdAt } as never))).toBe(true);
    }
  });
});

describe('#2530 reapStaleProcessing', () => {
  it('reports an abandoned row as failed and keeps every other column', async () => {
    const { client, writes } = recorder();
    const source = stale({ type: 'gdpr_delete', metadata: { reason: 'subject request' } });

    const result = await reapStaleProcessing({ rows: [source], tenantId: TENANT_ID, dbOrTx: client });

    expect(result.rows[0]).toMatchObject({
      id: REQUEST_ID,
      type: 'gdpr_delete',
      status: 'failed',
      stale: true,
      staleReason: STALE_PROCESSING_MESSAGE,
    });
    // The rest of the row survives: the console still has to render it.
    expect((result.rows[0] as { metadata: unknown }).metadata).toEqual({ reason: 'subject request' });
    expect(result.reaped).toEqual([REQUEST_ID]);
    expect(writes).toHaveLength(1);
  });

  it('persists a status the database will accept', async () => {
    const { client, writes } = recorder();
    const vocabulary = statusVocabulary();

    await reapStaleProcessing({ rows: [stale()], tenantId: TENANT_ID, dbOrTx: client });

    // Fail loudly rather than vacuously if the constraint is renamed away.
    expect(vocabulary.length).toBeGreaterThan(0);
    expect(vocabulary).toContain('processing');
    expect(vocabulary).toContain((writes[0]!.set as { status: string }).status);
  });

  it('never mints a completion timestamp for a request that never completed', async () => {
    const { client, writes } = recorder();

    await reapStaleProcessing({ rows: [stale()], tenantId: TENANT_ID, dbOrTx: client });

    expect(writes[0]!.set).not.toHaveProperty('completedAt');
    expect(writes[0]!.set).not.toHaveProperty('result');
  });

  it('pins its own UPDATE to id + tenant + the status it is replacing', async () => {
    const { client, writes } = recorder();

    await reapStaleProcessing({ rows: [stale()], tenantId: OTHER_TENANT_ID, dbOrTx: client });

    const sql = sqlText(writes[0]!.where);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"status"');
    expect(sql).toContain('$3');
    // CAS: a `completed` marker that landed while we were reading wins — the
    // reaper can only move a row it still finds in `processing`.
    expect(writes[0]!.where).toBeTruthy();
  });

  it('leaves a row that reached a terminal status alone', async () => {
    const { client, writes } = recorder();
    const done = row({ status: 'completed', createdAt: new Date(0) });

    const result = await reapStaleProcessing({ rows: [done], tenantId: TENANT_ID, dbOrTx: client });

    expect(result.rows[0]).toBe(done);
    expect(result.rows[0]).not.toHaveProperty('stale');
    expect(writes).toEqual([]);
    expect(result.reaped).toEqual([]);
  });

  it('tells the caller the truth when the record cannot be repaired', async () => {
    const { client, writes } = recorder({ throwing: true });

    const result = await reapStaleProcessing({ rows: [stale()], tenantId: TENANT_ID, dbOrTx: client });

    expect(writes).toHaveLength(1);
    expect(result.persistenceFailures).toBe(1);
    expect(result.reaped).toEqual([]);
    // The answer this caller received is still correct; only the stored row lags.
    expect(result.rows[0]).toMatchObject({ status: 'failed', stale: true });
  });

  it('reaps only what is abandoned when a page mixes the two', async () => {
    const { client, writes } = recorder();
    const fresh = row();
    const old = stale({ id: '40000000-0000-4000-8000-000000000004' });

    const result = await reapStaleProcessing({ rows: [fresh, old], tenantId: TENANT_ID, dbOrTx: client });

    expect(result.rows[0]).toBe(fresh);
    expect(result.rows[1]).toMatchObject({ status: 'failed', stale: true });
    expect(result.reaped).toEqual([old.id]);
    expect(writes).toHaveLength(1);
  });
});

describe('#2530 markers are best-effort and outcome-preserving', () => {
  it('markRequestCompleted records the result and its timestamp', async () => {
    const { client, writes } = recorder();

    expect(
      await markRequestCompleted(REQUEST_ID, TENANT_ID, { summary: { totalRecords: 4 } }, client),
    ).toBe(true);
    expect(writes[0]!.set).toMatchObject({ status: 'completed' });
    expect(writes[0]!.set!.completedAt).toBeInstanceOf(Date);
    expect(writes[0]!.set!.result).toEqual({ summary: { totalRecords: 4 } });
  });

  it('markRequestFailed records the reason it was handed', async () => {
    const { client, writes } = recorder();

    expect(await markRequestFailed(REQUEST_ID, TENANT_ID, 'smtp down', client)).toBe(true);
    expect(writes[0]!.set).toMatchObject({ status: 'failed', errorMessage: 'smtp down' });
  });

  it('a marker pins id + tenant and holds no status CAS', async () => {
    const { client, writes } = recorder();

    await markRequestCompleted(REQUEST_ID, TENANT_ID, {}, client);

    const sql = sqlText(writes[0]!.where);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"tenant_id"');
    // The asymmetry with the reaper is the point: a request that outlived the
    // deadline was reaped as `failed`, and its real `completed` result must be
    // allowed to overwrite that. A status guard here would lock the lie in.
    expect(sql).not.toContain('"status"');
    expect(sql).not.toContain('$3');
  });

  it('a marker that throws reports failure instead of throwing', async () => {
    const { client } = recorder({ throwing: true });

    expect(await markRequestCompleted(REQUEST_ID, TENANT_ID, {}, client)).toBe(false);
    expect(await markRequestFailed(REQUEST_ID, TENANT_ID, 'x', client)).toBe(false);
  });
});

describe('#2530 GET /api/tenant/compliance/gdpr', () => {
  it('surfaces an abandoned export as failed, and repairs the row', async () => {
    H.state.selectQueue = [[stale()], []];

    const res = await get('/api/tenant/compliance/gdpr');
    const body = await json(res);

    expect(res.status).toBe(200);
    expect((body.data as { exports: Record<string, unknown>[] }).exports[0]).toMatchObject({
      status: 'failed',
      stale: true,
    });
    const repaired = updates().filter((s) => s.set.status === 'failed');
    expect(repaired).toHaveLength(1);
    expect(repaired[0]!.set!.errorMessage).toBe(STALE_PROCESSING_MESSAGE);
  });

  it('reaps both lists, independently', async () => {
    H.state.selectQueue = [
      [stale({ id: REQUEST_ID })],
      [stale({ id: '50000000-0000-4000-8000-000000000005', type: 'gdpr_delete' })],
    ];

    const body = await json(await get('/api/tenant/compliance/gdpr'));

    const { exports, deletions } = body.data as {
      exports: Record<string, unknown>[];
      deletions: Record<string, unknown>[];
    };
    expect(exports[0]).toMatchObject({ status: 'failed', stale: true });
    expect(deletions[0]).toMatchObject({ status: 'failed', stale: true });
    expect(updates().filter((s) => s.set.status === 'failed')).toHaveLength(2);
  });

  it('leaves a request that is genuinely running saying processing', async () => {
    H.state.selectQueue = [[row()], []];

    const body = await json(await get('/api/tenant/compliance/gdpr'));

    expect((body.data as { exports: Record<string, unknown>[] }).exports[0]).toMatchObject({
      status: 'processing',
    });
    expect(H.state.statements).toEqual([]);
  });

  it('still answers 200 when the repair write fails', async () => {
    H.state.selectQueue = [[stale()], []];
    H.state.failStatus = 'failed';

    const res = await get('/api/tenant/compliance/gdpr');
    const body = await json(res);

    expect(res.status).toBe(200);
    // The read told the truth; the row stays broken until the next read retries.
    expect((body.data as { exports: Record<string, unknown>[] }).exports[0]).toMatchObject({
      status: 'failed',
      stale: true,
    });
  });
});

describe('#2530 GET /api/tenant/compliance/soc2', () => {
  it('surfaces an abandoned report as failed', async () => {
    H.state.selectQueue = [[stale({ type: 'soc2_report' })]];

    const body = await json(await get('/api/tenant/compliance/soc2'));

    expect(body.data).toMatchObject([{ status: 'failed', stale: true }]);
    expect(updates()).toHaveLength(1);
  });

  it('does not touch a report that finished', async () => {
    H.state.selectQueue = [[row({ type: 'soc2_report', status: 'completed' })]];

    const body = await json(await get('/api/tenant/compliance/soc2'));

    expect(body.data).toMatchObject([{ status: 'completed' }]);
    expect(H.state.statements).toEqual([]);
  });
});

describe('#2530 POST /api/tenant/compliance/gdpr records what actually happened', () => {
  const exportBody = { type: 'export' };

  it('opens the row as processing, closes it as completed', async () => {
    mockExport.mockResolvedValue({ tenantId: TENANT_ID, categories: {}, metadata: { totalRecords: 2 } });

    const res = await post('/api/tenant/compliance/gdpr', exportBody);
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(H.state.statements[0]).toMatchObject({ op: 'insert', set: { status: 'processing' } });
    expect(updates()[0]!.set).toMatchObject({ status: 'completed', completedAt: expect.any(Date) });
    expect(body.data).toMatchObject({ status: 'completed', recordUpdateFailed: false });
  });

  it('a completed erasure is NEVER recorded as failed when the marker throws', async () => {
    mockAnonymize.mockResolvedValue({ tenantId: TENANT_ID, categories: { contacts: 3 }, anonymizedRecords: 3 });
    H.state.failStatus = 'completed';

    const res = await post('/api/tenant/compliance/gdpr', { type: 'delete' });
    const body = await json(res);

    expect(res.status).toBe(201);
    // The defect: this statement used to be the `catch`'s, turning a real
    // Article 17 erasure into a log entry saying it had failed.
    expect(updates().map((s) => s.set.status)).toEqual(['completed']);
    expect(body.data).toMatchObject({ status: 'completed', recordUpdateFailed: true });
  });

  it('a failed erasure is recorded as failed with its reason', async () => {
    mockAnonymize.mockRejectedValue(new Error('contacts table missing'));

    const res = await post('/api/tenant/compliance/gdpr', { type: 'delete' });

    expect(res.status).toBe(500);
    expect(updates()[0]!.set).toMatchObject({ status: 'failed', errorMessage: 'contacts table missing' });
  });

  it('a work failure whose marker also fails still answers the work failure', async () => {
    mockExport.mockRejectedValue(new Error('query flood'));
    H.state.failStatus = 'failed';

    const res = await post('/api/tenant/compliance/gdpr', exportBody);
    const body = await json(res);

    expect(res.status).toBe(500);
    // Not apiError's body: the caller learns the export failed, not that the
    // route itself broke, and the row is left for the reaper.
    expect(body.error).toBe('Request processing failed');
    expect(H.state.statements.filter((s) => s.op === 'update')).toHaveLength(1);
  });
});

describe('#2530 POST /api/tenant/compliance/soc2 records what actually happened', () => {
  it('a finished report is not demoted when the marker throws', async () => {
    mockSoc2.mockResolvedValue({ controls: [], periodDays: 90 });
    H.state.failStatus = 'completed';

    const res = await post('/api/tenant/compliance/soc2', { periodDays: 90 });
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(updates().map((s) => s.set.status)).toEqual(['completed']);
    expect(body.data).toMatchObject({ status: 'completed', recordUpdateFailed: true });
  });

  it('a failed generation records failed and answers 500', async () => {
    mockSoc2.mockRejectedValue(new Error('no evidence collected'));

    const res = await post('/api/tenant/compliance/soc2', { periodDays: 90 });

    expect(res.status).toBe(500);
    expect(updates()[0]!.set).toMatchObject({ status: 'failed', errorMessage: 'no evidence collected' });
  });
});
