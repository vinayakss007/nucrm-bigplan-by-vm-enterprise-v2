/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2737 — `POST /api/tenant/sequences/[id]/enroll` never enrolled anybody.
 *
 * Each contact was handed to `public.enroll_contact_in_sequence(…)` with four
 * uuid arguments; the function is defined with two
 * (`drizzle/migrations/0032_missing_db_functions.sql:50-59`), so Postgres raised
 * "function does not exist" every time. The route caught it per contact, dropped
 * the failures in its `enrolled` filter and answered **200** `{ ok: true,
 * enrolled: [], skipped: N }` — an entire batch vanishing inside a counter that
 * also covers ordinary duplicate-skipping.
 *
 * These tests drive the rendered SQL the way Postgres would — bound id list,
 * bound tenant, the compliance terms, the owner clause — and assert the rows that
 * are actually written. Against the old route they are red because nothing was
 * ever written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const SEQ = '55555555-5555-4555-8555-555555555555';
const SEQ_PAUSED = '66666666-6666-4666-8666-666666666666';
const SEQ_ELSEWHERE = '77777777-7777-4777-8777-777777777777';
const SEQ_TRASHED = '88888888-8888-4888-8888-888888888888';

const CONTACT_MINE = '99999999-9999-4999-8999-999999999999';
const CONTACT_OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT_MINE_DNC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_MINE_UNSUB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTACT_MINE_TRASHED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOT_A_UUID = '00000000-0000-0000-0000-00000000000z';

const dialect = new PgDialect({} as never);
const OWNER_CLAUSE = /"contacts"\."assigned_to" = .* or "contacts"\."created_by" = /i;

type Q = { sql: string; params: unknown[]; table: string };
type Contact = {
  id: string; tenantId: string; assignedTo: string | null; createdBy: string | null;
  doNotContact: boolean; unsubscribed: boolean; deletedAt: Date | null;
};
type Sequence = { id: string; tenantId: string; status: string; deletedAt: Date | null; enrollCount: number };
type Enrollment = { tenantId: string; sequenceId: string; contactId: string; status: string };
type Written = { contactId: string; row: Record<string, unknown> };

let reads: Q[] = [];
let written: Written[] = [];
let counterBumps: { sequenceId: unknown; sql: string }[] = [];
let executes: unknown[] = [];
let contacts_: Record<string, Contact> = {};
let sequences_: Record<string, Sequence> = {};
let enrollments: Enrollment[] = [];
let body: Record<string, unknown> = {};
let failInsert = false;
let enrollmentSeq = 0;

function render(predicate: unknown, table: string): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table };
}

function boundValue(query: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`, 'i').exec(query.sql);
  return m ? query.params[Number(m[1]) - 1] : undefined;
}

/** The values an `in (...)` term binds — the requested id set, in order. */
function boundList(query: Q, column: string): unknown[] | undefined {
  const m = new RegExp(`"${column}" in \\(([^)]*)\\)`, 'i').exec(query.sql);
  if (!m) return undefined;
  return m[1].split(',').map((term) => {
    const d = /\$(\d+)/.exec(term);
    return d ? query.params[Number(d[1]) - 1] : undefined;
  });
}

const narrowed = (query: Q) => OWNER_CLAUSE.test(query.sql) && query.params.includes(MINE);
const owned = (row: Contact) => row.assignedTo === MINE || row.createdBy === MINE;
const termPresent = (query: Q, re: RegExp) => re.test(query.sql);

function answer(query: Q): unknown[] {
  const tenant = boundValue(query, 'tenant_id');
  switch (query.table) {
    case 'sequences': {
      const seq = sequences_[String(boundValue(query, 'id'))];
      if (!seq || seq.tenantId !== tenant) return [];
      if (termPresent(query, /"deleted_at" is null/i) && seq.deletedAt) return [];
      return [seq];
    }
    case 'contacts': {
      const ids = boundList(query, 'id');
      if (!ids) return [];
      return Object.values(contacts_).filter((row) =>
        ids.includes(row.id)
        && row.tenantId === tenant
        && (termPresent(query, /"deleted_at" is null/i) ? row.deletedAt === null : true)
        && (boundValue(query, 'do_not_contact') === undefined
          ? true
          : row.doNotContact === boundValue(query, 'do_not_contact'))
        && (boundValue(query, 'unsubscribed') === undefined
          ? true
          : row.unsubscribed === boundValue(query, 'unsubscribed'))
        && (!narrowed(query) || owned(row))).map((row) => ({ id: row.id }));
    }
    case 'sequence_enrollments': {
      const sequenceId = boundValue(query, 'sequence_id');
      const status = boundValue(query, 'status');
      const ids = boundList(query, 'contact_id');
      return enrollments.filter((e) =>
        e.tenantId === tenant
        && e.sequenceId === sequenceId
        && (status === undefined ? true : e.status === status)
        && (ids ? ids.includes(e.contactId) : true)).map((e) => ({ contactId: e.contactId }));
    }
    default:
      return [];
  }
}

function makeSelectBuilder(onQuery?: (q: Q) => unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let table: string | undefined;
  let where: Q | undefined;
  builder['from'] = (t: object) => { table = getTableName(t as never); return builder; };
  for (const m of ['leftJoin', 'orderBy', 'groupBy', 'limit', 'offset']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    where = render(predicate, table as string);
    reads.push(where);
    return builder;
  };
  const resolve = () => (where ? (onQuery ?? answer)(where) : []);
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

/** A drizzle insert chain. `.onConflictDoNothing()` is in it because #2740's unique index made
 * the route tolerate a racing duplicate, and it has to sit before `.returning()`. */
function insertChain(resolve: () => Promise<unknown>): Record<string, unknown> {
  const chain: Record<string, unknown> = { returning: resolve };
  chain['onConflictDoNothing'] = () => chain;
  return chain;
}

function makeTx() {
  const tx: Record<string, unknown> = {};
  tx['select'] = () => makeSelectBuilder();
  tx['insert'] = (t: object) => ({
    values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const table = getTableName(t as never);
      if (failInsert) return insertChain(() => Promise.reject(new Error('insert exploded')));
      const list = Array.isArray(rows) ? rows : [rows];
      if (table !== 'sequence_enrollments') return insertChain(() => Promise.resolve([]));
      const out: { id: string; contactId: string }[] = [];
      for (const row of list) {
        const id = `enr-${++enrollmentSeq}`;
        written.push({ contactId: String(row.contactId), row });
        enrollments.push({
          tenantId: String(row.tenantId), sequenceId: String(row.sequenceId),
          contactId: String(row.contactId), status: String(row.status),
        });
        out.push({ id, contactId: String(row.contactId) });
      }
      return insertChain(() => Promise.resolve(out));
    },
  });
  tx['update'] = (t: object) => ({
    set: (set: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        const q = render(predicate, getTableName(t as never));
        counterBumps.push({ sequenceId: q.params[0], sql: dialect.sqlToQuery(set.enrollCount as never).sql });
        return Promise.resolve();
      },
    }),
  });
  return tx;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeSelectBuilder()),
  insert: vi.fn(() => { throw new Error('writes must go through the transaction'); }),
  update: vi.fn(), delete: vi.fn(), execute: vi.fn((q: unknown) => { executes.push(q); return Promise.reject(new Error('function public.enroll_contact_in_sequence(uuid, uuid, uuid, uuid) does not exist')); }),
  transaction: vi.fn((cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(makeTx())),
  query: {
    sequences: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        const q = render(where, 'sequences');
        reads.push(q);
        return answer(q)[0];
      }),
    },
  },
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
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const seqRoute = await import('@/app/api/tenant/sequences/[id]/route');

const REP = { 'automations.manage': true, 'contacts.view_all': false };
const SEES_ALL = { 'automations.manage': true, 'contacts.view_all': true };
const NO_RIGHTS: Record<string, boolean> = {};

type Perms = Record<string, boolean>;

async function send(perms: Perms, sequenceId: string, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions: perms,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
  body = payload;
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/sequences/${sequenceId}/enroll`), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (seqRoute.POST as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: sequenceId }) },
  );
}

const contact = (id: string, assignedTo: string | null, createdBy: string | null, over: Partial<Contact> = {}): Contact => ({
  id, tenantId: TENANT, assignedTo, createdBy,
  doNotContact: false, unsubscribed: false, deletedAt: null, ...over,
});

function wroteIds() {
  return written.map((w) => w.contactId).sort();
}

async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

const contactRead = () => reads.find((q) => q.table === 'contacts');

beforeEach(() => {
  reads = [];
  written = [];
  counterBumps = [];
  executes = [];
  body = {};
  failInsert = false;
  enrollmentSeq = 0;
  contacts_ = {
    [CONTACT_MINE]: contact(CONTACT_MINE, MINE, OTHER),
    [CONTACT_OTHER]: contact(CONTACT_OTHER, OTHER, OTHER),
    [CONTACT_MINE_DNC]: contact(CONTACT_MINE_DNC, MINE, MINE, { doNotContact: true }),
    [CONTACT_MINE_UNSUB]: contact(CONTACT_MINE_UNSUB, MINE, MINE, { unsubscribed: true }),
    [CONTACT_MINE_TRASHED]: contact(CONTACT_MINE_TRASHED, MINE, MINE, { deletedAt: new Date('2026-10-01') }),
  };
  sequences_ = {
    [SEQ]: { id: SEQ, tenantId: TENANT, status: 'active', deletedAt: null, enrollCount: 0 },
    [SEQ_PAUSED]: { id: SEQ_PAUSED, tenantId: TENANT, status: 'paused', deletedAt: null, enrollCount: 0 },
    [SEQ_ELSEWHERE]: { id: SEQ_ELSEWHERE, tenantId: ELSEWHERE, status: 'active', deletedAt: null, enrollCount: 0 },
    [SEQ_TRASHED]: { id: SEQ_TRASHED, tenantId: TENANT, status: 'active', deletedAt: new Date('2026-10-02'), enrollCount: 0 },
  };
  enrollments = [];
});

describe('the batch is written, not swallowed (#2737)', () => {
  it('a valid batch enrols: rows land in sequence_enrollments with the tenant on them', async () => {
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_OTHER] }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(wroteIds()).toEqual([CONTACT_MINE, CONTACT_OTHER].sort());
    expect(written[0].row).toMatchObject({ tenantId: TENANT, sequenceId: SEQ, status: 'active', currentStep: 1, enrolledBy: MINE });
  });

  it('the response carries the enrollment ids it promised', async () => {
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] }));
    expect(r.json.enrolled).toEqual([{ contact_id: CONTACT_MINE, enrollment_id: 'enr-1' }]);
    expect(r.json.skipped).toBe(0);
  });

  it('no contact is enrolled through db.execute any more', async () => {
    await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] });
    expect(executes).toHaveLength(0);
  });

  it('the sequence counter moves by exactly the rows written', async () => {
    await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_OTHER, CONTACT_MINE_DNC] });
    expect(counterBumps).toHaveLength(1);
    expect(counterBumps[0].sequenceId).toBe(SEQ);
    expect(counterBumps[0].sql).toMatch(/coalesce\("sequences"\."enroll_count", 0\) \+ \$\d+/i);
  });

  it('a write that explodes is a 500, not an empty success', async () => {
    failInsert = true;
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] }));
    expect(r.status).toBe(500);
    expect(written).toHaveLength(0);
  });

  it('the same id twice in one request enrols once', async () => {
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_MINE] }));
    expect(wroteIds()).toEqual([CONTACT_MINE]);
    expect(r.json.skipped).toBe(0);
  });
});

describe('the batch is resolved against contacts the caller may act on (#2737)', () => {
  it('opt-out, unsubscribe and tombstone are refused and named', async () => {
    const r = await json(await send(SEES_ALL, SEQ, {
      contact_ids: [CONTACT_MINE, CONTACT_MINE_DNC, CONTACT_MINE_UNSUB, CONTACT_MINE_TRASHED],
    }));
    expect(wroteIds()).toEqual([CONTACT_MINE]);
    expect(r.json).toMatchObject({ skipped: 3, skipped_opted_out: 3 });
  });

  it('a contact in another workspace is never resolved, whatever it is named as', async () => {
    contacts_[CONTACT_OTHER] = contact(CONTACT_OTHER, OTHER, OTHER, { tenantId: ELSEWHERE });
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_OTHER] }));
    expect(r.status).toBe(404);
    expect(written).toHaveLength(0);
  });

  it('a caller without contacts.view_all cannot enrol a colleague\'s contact', async () => {
    const r = await json(await send(REP, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_OTHER] }));
    expect(r.status).toBe(200);
    expect(wroteIds()).toEqual([CONTACT_MINE]);
    expect(contactRead()!.sql).toMatch(OWNER_CLAUSE);
  });

  it('a caller who owns none of them gets a 404 and no rows', async () => {
    const r = await json(await send(REP, SEQ, { contact_ids: [CONTACT_OTHER] }));
    expect(r.status).toBe(404);
    expect(written).toHaveLength(0);
  });

  it('a contacts.view_all holder is untouched: no owner term in the contact read', async () => {
    await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_OTHER] });
    expect(contactRead()!.sql).not.toMatch(OWNER_CLAUSE);
    expect(contactRead()!.params).not.toContain(MINE);
  });
});

describe('a contact already in the sequence is not enrolled twice (#2737)', () => {
  it('an active enrollment is skipped by the read, not by a rejected insert', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_MINE, status: 'active' }];
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE, CONTACT_OTHER] }));
    expect(wroteIds()).toEqual([CONTACT_OTHER]);
    expect(r.json).toMatchObject({ skipped: 1, skipped_existing: 1 });
  });

  it('a completed enrollment does not block a re-enroll', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_MINE, status: 'completed' }];
    await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] });
    expect(wroteIds()).toEqual([CONTACT_MINE]);
  });

  it('an active enrollment in another sequence does not block this one', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ_PAUSED, contactId: CONTACT_MINE, status: 'active' }];
    await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] });
    expect(wroteIds()).toEqual([CONTACT_MINE]);
  });

  it('a batch that is entirely already-enrolled writes nothing and still answers 200', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_MINE, status: 'active' }];
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [CONTACT_MINE] }));
    expect(r.status).toBe(200);
    expect(r.json.enrolled).toEqual([]);
    expect(r.json.skipped_existing).toBe(1);
    expect(counterBumps).toHaveLength(0);
  });
});

describe('what the route refused before it touched the database still stands (#2737)', () => {
  it('a malformed id is a 400, not a swallowed SQL error', async () => {
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: [NOT_A_UUID] }));
    expect(r.status).toBe(400);
    expect(reads).toHaveLength(0);
    expect(executes).toHaveLength(0);
  });

  it('a missing or empty contact_ids is a 400', async () => {
    expect((await json(await send(SEES_ALL, SEQ, {}))).status).toBe(400);
    expect((await json(await send(SEES_ALL, SEQ, { contact_ids: [] }))).status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('a batch larger than the bulk ceiling is refused', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r = await json(await send(SEES_ALL, SEQ, { contact_ids: tooMany }));
    expect(r.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('without automations.manage nothing is read at all', async () => {
    const r = await json(await send(NO_RIGHTS, SEQ, { contact_ids: [CONTACT_MINE] }));
    expect(r.status).toBe(403);
    expect(reads).toHaveLength(0);
  });

  it('a sequence from another workspace, a trashed one, or an unknown one is a 404 before contacts are read', async () => {
    for (const id of [SEQ_ELSEWHERE, SEQ_TRASHED, 'ffffffff-ffff-4fff-8fff-fffffffffff0']) {
      reads = [];
      const r = await json(await send(SEES_ALL, id, { contact_ids: [CONTACT_MINE] }));
      expect(r.status, id).toBe(404);
      expect(reads.map((q) => q.table)).toEqual(['sequences']);
    }
  });

  it('a paused sequence is a 400', async () => {
    const r = await json(await send(SEES_ALL, SEQ_PAUSED, { contact_ids: [CONTACT_MINE] }));
    expect(r.status).toBe(400);
    expect(written).toHaveLength(0);
  });
});
