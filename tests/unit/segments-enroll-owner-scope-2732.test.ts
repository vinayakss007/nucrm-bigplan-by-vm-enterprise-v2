/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2732 — `segments/[id]/enroll` enrolled a segment's members by tenant alone.
 *
 * The route's only gate is `automations.manage`, then it reads
 * `segment_members` for the tenant and filters those ids on
 * `tenant_id + deleted_at IS NULL + do_not_contact + unsubscribed` before
 * inserting into `sequence_enrollments`. Nothing asked whether the caller may
 * see the contact — so a `sales_rep`, whose `contacts.view_all` is explicitly
 * false (`lib/permissions/definitions.ts:133`) and whom `contacts/[id]:82-87`
 * answers 404 for a colleague's row, could put that contact into a live mail
 * sequence by naming a segment that contains it.
 *
 * The reader answers the rendered predicate the way Postgres would: the bound
 * ids, the tenant, the compliance terms, and whether the query narrows to the
 * caller. Red against the old route, not red because a call was missing.
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

const SEG = '55555555-5555-4555-8555-555555555555';
const SEG_ELSEWHERE = '66666666-6666-4666-8666-666666666666';
const SEG_COMPANY = '77777777-7777-4777-8777-777777777777';
const SEG_TRASHED = '88888888-8888-4888-8888-888888888888';
const SEG_EMPTY = '99999999-9999-4999-8999-999999999999';
const SEQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEQ_PAUSED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEQ_ELSEWHERE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CONTACT_MINE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONTACT_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CONTACT_MINE_DNC = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CONTACT_MINE_UNSUBSCRIBED = '12121212-1212-4112-8112-121212121212';
const CONTACT_MINE_TRASHED = '13131313-1313-4113-8113-131313131313';

const dialect = new PgDialect({} as never);
const OWNER_CLAUSE = /"contacts"\."assigned_to" = .* or "contacts"\."created_by" = /i;

type Q = { sql: string; params: unknown[]; table: string };
type Contact = {
  id: string; tenantId: string; assignedTo: string | null; createdBy: string | null;
  doNotContact: boolean; unsubscribed: boolean; deletedAt: Date | null;
};
type Segment = { id: string; tenantId: string; entityType: string; deletedAt: Date | null; members: string[] };
type Sequence = { id: string; tenantId: string; status: string; deletedAt: Date | null };
type Enrollment = { tenantId: string; sequenceId: string; contactId: string; status: string };

let reads: Q[] = [];
let written: { contactId: string; sequenceId: string }[] = [];
let audits: Record<string, unknown>[] = [];
let contacts_: Record<string, Contact> = {};
let segments_: Record<string, Segment> = {};
let sequences_: Record<string, Sequence> = {};
let enrollments: Enrollment[] = [];
let body: Record<string, unknown> = {};

function render(predicate: unknown, table: string): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table };
}

function boundValue(query: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`, 'i').exec(query.sql);
  return m ? query.params[Number(m[1]) - 1] : undefined;
}

/** The values an `in (...)` term binds — the member id set, in order. */
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
    case 'segments': {
      const seg = segments_[String(boundValue(query, 'id'))];
      if (!seg || seg.tenantId !== tenant) return [];
      if (termPresent(query, /"deleted_at" is null/i) && seg.deletedAt) return [];
      return [{ id: seg.id, entityType: seg.entityType }];
    }
    case 'sequences': {
      const seq = sequences_[String(boundValue(query, 'id'))];
      if (!seq || seq.tenantId !== tenant) return [];
      if (termPresent(query, /"deleted_at" is null/i) && seq.deletedAt) return [];
      return [{ id: seq.id, status: seq.status }];
    }
    case 'segment_members': {
      const seg = segments_[String(boundValue(query, 'segment_id'))];
      if (!seg || seg.tenantId !== tenant) return [];
      return seg.members.map((entityId) => ({ entityId }));
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

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let table: string | undefined;
  let where: Q | undefined;
  builder['from'] = (t: object) => { table = getTableName(t as never); return builder; };
  for (const m of ['leftJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    where = render(predicate, table as string);
    reads.push(where);
    return builder;
  };
  const resolve = () => (where ? answer(where) : []);
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(() => makeSelectBuilder()),
  insert: vi.fn((t: object) => ({
    values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(rows) ? rows : [rows];
      if (getTableName(t as never) === 'sequence_enrollments') {
        for (const r of list) written.push({ contactId: String(r.contactId), sequenceId: String(r.sequenceId) });
        for (const r of list) {
          enrollments.push({
            tenantId: String(r.tenantId), sequenceId: String(r.sequenceId),
            contactId: String(r.contactId), status: String(r.status),
          });
        }
      }
      return Promise.resolve();
    },
  })),
  update: vi.fn(), delete: vi.fn(), transaction: vi.fn(), execute: vi.fn(), query: {},
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
vi.mock('@/lib/audit', () => ({
  logAudit: (entry: Record<string, unknown>) => { audits.push(entry); return Promise.resolve(); },
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const enroll = await import('@/app/api/tenant/segments/[id]/enroll/route');

const REP = { 'automations.manage': true, 'contacts.view_all': false };
const SEES_ALL = { 'automations.manage': true, 'contacts.view_all': true };
const NO_RIGHTS: Record<string, boolean> = {};

type Perms = Record<string, boolean>;

async function send(perms: Perms, segmentId: string, payload: Record<string, unknown> = { sequence_id: SEQ }) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions: perms,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
  body = payload;
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/segments/${segmentId}/enroll`), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (enroll.POST as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: segmentId }) },
  );
}

const contact = (id: string, assignedTo: string | null, createdBy: string | null, over: Partial<Contact> = {}): Contact => ({
  id, tenantId: TENANT, assignedTo, createdBy,
  doNotContact: false, unsubscribed: false, deletedAt: null, ...over,
});

/** The ids the route actually wrote. */
function wroteIds() {
  return written.map((w) => w.contactId).sort();
}

async function data(res: Response) {
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

const contactReads = () => reads.filter((q) => q.table === 'contacts');

beforeEach(() => {
  reads = [];
  written = [];
  audits = [];
  body = {};
  contacts_ = {
    [CONTACT_MINE]: contact(CONTACT_MINE, MINE, OTHER),
    [CONTACT_OTHER]: contact(CONTACT_OTHER, OTHER, OTHER),
    [CONTACT_MINE_DNC]: contact(CONTACT_MINE_DNC, MINE, MINE, { doNotContact: true }),
    [CONTACT_MINE_UNSUBSCRIBED]: contact(CONTACT_MINE_UNSUBSCRIBED, MINE, MINE, { unsubscribed: true }),
    [CONTACT_MINE_TRASHED]: contact(CONTACT_MINE_TRASHED, MINE, MINE, { deletedAt: new Date('2026-10-01') }),
  };
  segments_ = {
    [SEG]: { id: SEG, tenantId: TENANT, entityType: 'contact', deletedAt: null, members: [CONTACT_MINE, CONTACT_OTHER] },
    [SEG_ELSEWHERE]: { id: SEG_ELSEWHERE, tenantId: ELSEWHERE, entityType: 'contact', deletedAt: null, members: [CONTACT_MINE] },
    [SEG_COMPANY]: { id: SEG_COMPANY, tenantId: TENANT, entityType: 'company', deletedAt: null, members: [CONTACT_MINE] },
    [SEG_TRASHED]: { id: SEG_TRASHED, tenantId: TENANT, entityType: 'contact', deletedAt: new Date('2026-10-02'), members: [CONTACT_MINE] },
    [SEG_EMPTY]: { id: SEG_EMPTY, tenantId: TENANT, entityType: 'contact', deletedAt: null, members: [] },
  };
  sequences_ = {
    [SEQ]: { id: SEQ, tenantId: TENANT, status: 'active', deletedAt: null },
    [SEQ_PAUSED]: { id: SEQ_PAUSED, tenantId: TENANT, status: 'paused', deletedAt: null },
    [SEQ_ELSEWHERE]: { id: SEQ_ELSEWHERE, tenantId: ELSEWHERE, status: 'active', deletedAt: null },
  };
  enrollments = [];
});

describe('an enroll reaches only the contacts the caller may touch (#2732)', () => {
  it('a mixed segment enrolls the caller\'s own row and leaves the colleague\'s alone', async () => {
    const r = await data(await send(REP, SEG));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.enrolled).toBe(1);
    expect(wroteIds()).toEqual([CONTACT_MINE]);
  });

  it('the member set is narrowed by the contact rule before anything is written', async () => {
    await send(REP, SEG);
    const read = contactReads()[0];
    expect(read).toBeDefined();
    expect(read.sql).toMatch(OWNER_CLAUSE);
    expect(read.sql).toMatch(/"contacts"\."id" in \(/i);
    expect(read.params).toContain(TENANT);
  });

  it('a member the caller cannot see is reported as such, not as an opt-out', async () => {
    segments_[SEG].members = [CONTACT_OTHER, CONTACT_MINE_DNC];
    const r = await data(await send(REP, SEG));
    expect(r.json.data).toMatchObject({
      enrolled: 0, skipped_not_owned: 1, skipped_opt_out: 1, skipped_existing: 0, total_members: 2,
    });
    expect(written).toHaveLength(0);
  });

  it('a caller who owns none of the segment writes nothing at all', async () => {
    segments_[SEG].members = [CONTACT_OTHER];
    const r = await data(await send(REP, SEG));
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ enrolled: 0, skipped_not_owned: 1, total_members: 1 });
    expect(wroteIds()).toEqual([]);
    expect(audits).toHaveLength(0);
  });

  it('an existing enrollment on a foreign contact is not counted for the rep either', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_OTHER, status: 'active' }];
    const r = await data(await send(REP, SEG));
    expect(r.json.data).toMatchObject({ enrolled: 1, skipped_existing: 0 });
    expect(wroteIds()).toEqual([CONTACT_MINE]);
  });

  it('a contacts.view_all holder is untouched: one contacts read, no owner term, whole set enrolled', async () => {
    const r = await data(await send(SEES_ALL, SEG));
    expect(r.status).toBe(200);
    expect(contactReads()).toHaveLength(1);
    expect(contactReads()[0].sql).not.toMatch(OWNER_CLAUSE);
    expect(contactReads()[0].params).not.toContain(MINE);
    expect(r.json.data).toMatchObject({ enrolled: 2, skipped_not_owned: 0, total_members: 2 });
    expect(wroteIds()).toEqual([CONTACT_MINE, CONTACT_OTHER].sort());
  });
});

describe('the compliance and existence terms this route already got right still stand (#2732)', () => {
  it('opt-out, unsubscribe and tombstone are all refused and counted for a view_all holder', async () => {
    segments_[SEG].members = [CONTACT_MINE, CONTACT_MINE_DNC, CONTACT_MINE_UNSUBSCRIBED, CONTACT_MINE_TRASHED];
    const r = await data(await send(SEES_ALL, SEG));
    expect(r.json.data).toMatchObject({ enrolled: 1, skipped_opt_out: 3, total_members: 4 });
    expect(wroteIds()).toEqual([CONTACT_MINE]);
  });

  it('a contact already active in the sequence is not re-added', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_MINE, status: 'active' }];
    const r = await data(await send(SEES_ALL, SEG));
    expect(r.json.data).toMatchObject({ enrolled: 1, skipped_existing: 1 });
    expect(wroteIds()).toEqual([CONTACT_OTHER]);
  });

  it('a completed enrollment does not block a re-enroll', async () => {
    enrollments = [{ tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_MINE, status: 'completed' }];
    const r = await data(await send(SEES_ALL, SEG));
    expect(r.json.data.enrolled).toBe(2);
  });

  it('without automations.manage nothing is read at all', async () => {
    const r = await data(await send(NO_RIGHTS, SEG));
    expect(r.status).toBe(403);
    expect(reads).toHaveLength(0);
  });

  it('a missing sequence_id is a 400 before anything is read', async () => {
    const r = await data(await send(SEES_ALL, SEG, {}));
    expect(r.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('a segment from another workspace is a 404 before its members are read', async () => {
    const r = await data(await send(SEES_ALL, SEG_ELSEWHERE));
    expect(r.status).toBe(404);
    expect(reads.map((q) => q.table)).toEqual(['segments']);
    expect(written).toHaveLength(0);
  });

  it('a trashed segment is a 404 and a company segment is a 422', async () => {
    expect((await data(await send(SEES_ALL, SEG_TRASHED))).status).toBe(404);
    const r = await data(await send(SEES_ALL, SEG_COMPANY));
    expect(r.status).toBe(422);
    expect(reads.some((q) => q.table !== 'segments')).toBe(false);
  });

  it('a sequence from another workspace is a 404, a paused one a 400', async () => {
    expect((await data(await send(SEES_ALL, SEG, { sequence_id: SEQ_ELSEWHERE }))).status).toBe(404);
    expect((await data(await send(SEES_ALL, SEG, { sequence_id: SEQ_PAUSED }))).status).toBe(400);
  });

  it('an unrefreshed segment says so and enrols nothing', async () => {
    const r = await data(await send(SEES_ALL, SEG_EMPTY));
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ enrolled: 0, total_members: 0 });
    expect(r.json.message).toMatch(/refresh/i);
    expect(written).toHaveLength(0);
  });

  it('the audit reports the enrollments that were actually written', async () => {
    await send(SEES_ALL, SEG);
    expect(audits[0]).toMatchObject({ tenantId: TENANT, userId: MINE, action: 'enroll', entityType: 'segment', entityId: SEG });
    expect((audits[0]?.newData as Record<string, unknown>).enrolled).toBe(2);
  });
});
