/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3193 — `sequences.enroll_count` counted accepted enrollment *calls*.
 *
 * `POST /api/tenant/contacts/[id]/enroll` upserted the enrollment and then bumped the
 * counter on the same transaction whatever the upsert did. The INSERT branch (a first
 * enrollment, or a re-activation — #2740's partial unique index only covers
 * `status = 'active' AND deleted_at IS NULL`, so a cancelled row does not conflict)
 * legitimately makes the table grow. The ON CONFLICT DO UPDATE branch does not: it
 * resets `current_step`/`next_step_at` on the row that was already there, so a
 * double-clicked enroll button, or an automation re-enrolling an active contact, moved
 * a number that nothing had to move.
 *
 * Five writers added to it and nothing subtracted — `cancelOpenEnrollments` only ever
 * moves `status` — so the column was neither "active enrollments" nor "enrollments
 * ever", and any reading of it drifted. The definition these tests hold every site to
 * is the one `sequence_enrollments` already carries: **the number of live enrollment
 * rows for the sequence**. The two reads (`GET /api/tenant/sequences`,
 * `GET /api/tenant/sequences/[id]`) derive it from the table — the way
 * `app/tenant/sequences/page.tsx` has always done for the other sequences UI — and
 * the POST bumps the vestigial column only when its insert actually created a row.
 *
 * The fake below is the load-bearing part. It models #2740's partial unique index — a
 * conflicting insert updates the row it found and hands back *that* row's id — and it
 * refuses to answer any predicate or `enroll_count` expression it cannot parse, so a
 * route that stops deriving throws instead of quietly reporting a number the test made
 * up. Every fixture is synthetic: RFC 2606 `.test` addresses and TEST-NET-style uuids.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, is, SQL, Column } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const SEQ = '44444444-4444-4444-8444-444444444444';
const CONTACT_DANA = '55555555-5555-4555-8555-555555555555';
const CONTACT_EVAN = '66666666-6666-4666-8666-666666666666';
const CONTACT_FAY = '77777777-7777-4777-8777-777777777777';

type Rec = Record<string, unknown>;

const h = vi.hoisted(() => ({
  sequences: [] as Rec[],
  contacts: [] as Rec[],
  steps: [] as Rec[],
  enrollments: [] as Rec[],
  bumps: [] as { sql: string; params: unknown[] }[],
  derived: [] as { sql: string; params: unknown[] }[],
}));

const dialect = new PgDialect({} as never);
const render = (node: unknown) => dialect.sqlToQuery(node as never);
const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/**
 * Every `and`-joined term the routes under test emit: `"t"."col" = $n`,
 * `"t"."col" = 'literal'`, `"t"."col" IS NULL`, `"t"."col" IN ($1::uuid, …)`.
 * Anything else — an `or`, a cast comparison, a subquery — throws loudly, because a
 * fake that shrugs at a predicate it does not model would answer reads the real
 * database would refuse.
 */
/** drizzle's `and()` wraps its terms in parens; a term is a column comparison once
 *  those grouping parens are off — and only those, because an `in (…)` list needs
 *  its own. An `or()` survives and trips the throw below, which is the point: the
 *  fake must not answer a predicate it cannot parse. */
function terms(sqlText: string): string[] {
  return sqlText.split(/\s+and\s+/i).map((raw) => {
    let t = raw.trim();
    let open = (t.match(/\(/g) ?? []).length;
    let close = (t.match(/\)/g) ?? []).length;
    while (open > close && t.startsWith('(')) { t = t.slice(1); open -= 1; }
    while (close > open && t.endsWith(')')) { t = t.slice(0, -1); close -= 1; }
    return t.trim();
  });
}

/** `"<table>"."<column>"`, or a bare `"<column>"`. */
const COL = String.raw`(?:"[a-z_]+".)?"([a-z_]+)"`;
const IS_NULL = new RegExp(`^${COL} is null$`, 'i');
const IN_LIST = new RegExp(`^${COL} in \\((.*)\\)$`, 'i');
const EQUALS = new RegExp(`^${COL} = (\\$\\d+|'[^']*')$`, 'i');

function termMatches(term: string, params: unknown[], row: Rec): boolean {
  const isNull = IS_NULL.exec(term);
  if (isNull) return row[camel(isNull[1]!)] === null || row[camel(isNull[1]!)] === undefined;
  const inList = IN_LIST.exec(term);
  if (inList) {
    const values = inList[2]!.split(',').map((item) => {
      const ph = /\$(\d+)/.exec(item);
      return ph ? params[Number(ph[1]) - 1] : item.replace(/::\w+|'/g, '').trim();
    });
    return values.includes(row[camel(inList[1]!)]);
  }
  const eqm = EQUALS.exec(term);
  if (eqm) {
    const right = eqm[2]!.startsWith('$')
      ? params[Number(eqm[2]!.slice(1)) - 1]
      : eqm[2]!.slice(1, -1);
    return row[camel(eqm[1]!)] === right;
  }
  throw new Error(`the fake cannot model this predicate term: ${term}`);
}

/** `getTableName` gives the SQL name; the store is keyed by a short one. */
const STORE: Record<string, keyof typeof h> = {
  sequences: 'sequences',
  contacts: 'contacts',
  sequence_steps: 'steps',
  sequence_enrollments: 'enrollments',
};

function matchingRows(table: string, sqlText: string, params: unknown[]): Rec[] {
  const key = STORE[table];
  if (!key) throw new Error(`the fake has no store for table ${table}`);
  const rows = h[key] as Rec[];
  if (!sqlText.trim()) return [...rows];
  return rows.filter((row) => terms(sqlText).every((term) => termMatches(term, params, row)));
}

/**
 * The derived count, evaluated the way Postgres would for the row being projected.
 * Only one shape is accepted — a correlated `select count(*)::int from
 * "sequence_enrollments" where …` — so a read that goes back to the stored column
 * fails here rather than reporting a stale tally as if it were the truth. The
 * correlation on `"sequences"."id"` is resolved against the outer row, and the
 * tombstone term is honored, which is what makes a re-enrolled contact count once.
 */
function derivedCount(sqlText: string, params: unknown[], outerRow: Rec): number {
  const inner = /\(\s*select count\(\*\)::int from "sequence_enrollments"\s+where ([\s\S]*?)\s*\)/i.exec(sqlText);
  if (!inner) throw new Error(`the fake cannot model this selected expression: ${sqlText}`);
  return h.enrollments.filter((enrollment) => {
    if (/".*"\."sequence_id" = "sequences"\."id"/i.test(sqlText)
      && enrollment.sequenceId !== outerRow.id) return false;
    return terms(inner[1]!).every((term) => {
      if (/^"sequence_enrollments"\."sequence_id" = "sequences"\."id"$/i.test(term)) return true;
      return termMatches(term, params, enrollment);
    });
  }).length;
}

function project(fields: Record<string, unknown>, row: Rec, matchingCount: number): Rec {
  const out: Rec = {};
  for (const [key, value] of Object.entries(fields)) {
    if (is(value as object, Column)) { out[key] = row[key]; continue; }
    if (is(value as object, SQL)) {
      const q = render(value);
      if (/count\(\*\)::int/i.test(q.sql) && !/from/i.test(q.sql)) { out[key] = matchingCount; continue; }
      h.derived.push({ sql: q.sql, params: q.params as unknown[] });
      out[key] = derivedCount(q.sql, q.params as unknown[], row);
      continue;
    }
    throw new Error(`the fake cannot project a selected ${typeof value} (${key})`);
  }
  return out;
}

function selectBuilder(fields?: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  let table = '';
  let where: { sql: string; params: unknown[] } = { sql: '', params: [] };
  let limit: number | null = null;
  b['from'] = (t: object) => { table = getTableName(t as never); return b; };
  b['where'] = (pred: unknown) => { const q = render(pred); where = { sql: q.sql, params: q.params as unknown[] }; return b; };
  for (const m of ['orderBy', 'leftJoin', 'innerJoin', 'groupBy', 'offset']) b[m] = () => b;
  b['limit'] = (n: number) => { limit = n; return b; };
  b['then'] = (done: (v: unknown) => unknown) => {
    const rows = matchingRows(table, where.sql, where.params);
    const sliced = limit === null ? rows : rows.slice(0, limit);
    if (!fields) throw new Error('the fake only projects a named column list, which is what both reads pass');
    const out = sliced.map((row) => project(fields, row, rows.length));
    return Promise.resolve(out).then(done);
  };
  return b;
}

/** `INSERT … ON CONFLICT DO UPDATE`, with #2740's partial index. */
function emulateUpsert(table: string, values: Rec, config: { target: unknown; targetWhere: unknown; set: Rec }) {
  if (table !== 'sequence_enrollments') throw new Error(`the fake does not model an upsert on ${table}`);
  const targetKeys = (Array.isArray(config.target) ? config.target : [config.target] as never[])
    .map((col: { name: string }) => camel(col.name));
  const predicate = render(config.targetWhere);
  const conflicting = h.enrollments.find((row) =>
    targetKeys.every((key) => row[key] === values[key])
    && terms(predicate.sql).every((term) => termMatches(term, predicate.params as unknown[], row)));

  if (conflicting) {
    // The conflict branch applies `set` and keeps the row's own identity: the id it
    // hands back is the id the row already had, which is what tells the route that
    // the table did not grow.
    Object.assign(conflicting, config.set);
    return [{ ...conflicting }];
  }
  const row: Rec = {
    completedAt: null, deletedAt: null, updatedAt: null, createdAt: new Date(),
    ...values,
  };
  h.enrollments.push(row);
  return [{ ...row }];
}

/** `COALESCE("sequences"."enroll_count", 0) + $1`, or `"…" + 1` — the pre-fix shape. */
function bumpDelta(sqlText: string, params: unknown[]): number {
  const m = /\+\s+(\$\d+|\d+)\s*$/i.exec(sqlText.trim());
  if (!m) throw new Error(`the fake cannot model this enroll_count expression: ${sqlText}`);
  return m[1]!.startsWith('$') ? Number(params[Number(m[1]!.slice(1)) - 1]) : Number(m[1]);
}

function applyUpdate(table: string, set: Rec, pred: unknown) {
  const q = render(pred);
  const rows = matchingRows(table, q.sql, q.params as unknown[]);
  for (const row of rows) {
    if (set.enrollCount !== undefined) {
      const bump = render(set.enrollCount);
      h.bumps.push({ sql: bump.sql, params: bump.params as unknown[] });
      const current = row.enrollCount as number | null;
      const delta = bumpDelta(bump.sql, bump.params as unknown[]);
      // Without COALESCE, `NULL + 1` is NULL: the pre-fix expression froze the tally at
      // nothing for any row whose column was ever null. The fake models that, so a
      // writer that drops COALESCE again is visible.
      row.enrollCount = current === null && !/coalesce/i.test(bump.sql) ? null : (current ?? 0) + delta;
    } else {
      Object.assign(row, set);
    }
  }
  // `cancelOpenEnrollments` chains `.returning({ id })` onto the update, the enroll
  // counter bump does not — the result is both, so either caller is answered.
  const done = Promise.resolve(rows.map((row) => ({ ...row })));
  return Object.assign(done, { returning: () => done });
}

function executor() {
  const ex: Record<string, unknown> = {
    select: (fields?: Record<string, unknown>) => selectBuilder(fields),
    insert: (t: object) => ({
      values: (row: Rec) => ({
        onConflictDoUpdate: (config: { target: unknown; targetWhere: unknown; set: Rec }) => ({
          returning: () => Promise.resolve(emulateUpsert(getTableName(t as never), row, config)),
        }),
        onConflictDoNothing: () => Promise.resolve({ rowCount: 0 }),
        returning: () => Promise.resolve([{ ...row }]),
        then: (done: (v: unknown) => unknown) => Promise.resolve([{ ...row }]).then(done),
      }),
    }),
    update: (t: object) => ({
      set: (set: Rec) => ({
        where: (pred: unknown) => applyUpdate(getTableName(t as never), set, pred),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    execute: () => Promise.resolve({ rows: [] }),
    query: {
      contacts: { findFirst: (config: { where: unknown; columns?: Record<string, boolean> }) => findFirst('contacts', config) },
      sequences: { findFirst: (config: { where: unknown; columns?: Record<string, boolean>; with?: Record<string, unknown> }) => findFirst('sequences', config) },
    },
  };
  ex['transaction'] = (cb: (tx: unknown) => Promise<unknown>) => cb(ex);
  return ex;
}

async function findFirst(table: string, config: { where: unknown; columns?: Record<string, boolean>; with?: Record<string, unknown> }) {
  const q = render(config.where);
  const [row] = matchingRows(table, q.sql, q.params as unknown[]);
  if (!row) return undefined;
  const out: Rec = config.columns
    ? Object.fromEntries(Object.keys(config.columns).map((key) => [key, row[key]]))
    : { ...row };
  if (config.with?.steps) {
    out.steps = matchingRows('sequence_steps', '', []).filter((s) => s.sequenceId === row.id);
  }
  return out;
}

const mockDb = executor();
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
vi.mock('@/lib/audit', () => ({ logAudit: () => Promise.resolve() }));
// A fake that refuses to model something must surface as a message, not a masked 500.
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const contactEnrollRoute = await import('@/app/api/tenant/contacts/[id]/enroll/route');
const sequencesListRoute = await import('@/app/api/tenant/sequences/route');
const sequenceDetailRoute = await import('@/app/api/tenant/sequences/[id]/route');

const CTX = {
  userId: USER, tenantId: TENANT, roleSlug: 'owner',
  permissions: { 'automations.manage': true, 'automations.view': true, 'contacts.view_all': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

const sequenceRow = (over: Rec = {}): Rec => ({
  id: SEQ, tenantId: TENANT, name: 'Nurture drip', description: 'Three touches over a week',
  status: 'active', enrollCount: 0, metadata: {},
  createdAt: new Date('2026-01-05T09:00:00Z'), updatedAt: null, deletedAt: null, ...over,
});
const contactRow = (id: string, email: string, over: Rec = {}): Rec => ({
  id, tenantId: TENANT, firstName: email.split('@')[0], email,
  doNotContact: false, unsubscribed: false, deletedAt: null, ...over,
});
const enrollmentRow = (over: Rec): Rec => ({
  id: over.id as string, tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT_DANA,
  status: 'active', currentStep: 1, nextStepAt: new Date('2026-01-06T09:00:00Z'),
  enrolledAt: new Date('2026-01-05T09:00:00Z'), completedAt: null, deletedAt: null, ...over,
});

async function enroll(contactId: string) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(CTX);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/contacts/${contactId}/enroll`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ sequence_id: SEQ }),
  });
  const res = await (contactEnrollRoute.POST as (
    r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: contactId }) });
  const json = await res.json().catch(() => null);
  return { res, json: json as Rec | null };
}

async function unenroll(contactId: string) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(CTX);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/contacts/${contactId}/enroll`), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ sequence_id: SEQ }),
  });
  const res = await (contactEnrollRoute.DELETE as (
    r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: contactId }) });
  return { res, json: await res.json().catch(() => null) as Rec | null };
}

async function listSequences() {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(CTX);
  const res = await sequencesListRoute.GET(new NextRequest(new URL('http://localhost:3000/api/tenant/sequences')));
  return (await (res as Response).json()) as { data: Rec[] };
}

async function readSequenceDetail() {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(CTX);
  const res = await (sequenceDetailRoute.GET as (
    r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    new NextRequest(new URL(`http://localhost:3000/api/tenant/sequences/${SEQ}`)),
    { params: Promise.resolve({ id: SEQ }) });
  return (await res.json()) as { data: Rec };
}

const counter = () => h.sequences.find((s) => s.id === SEQ)!.enrollCount as number;

beforeEach(() => {
  h.sequences = [sequenceRow()];
  h.contacts = [
    contactRow(CONTACT_DANA, 'dana@example.test'),
    contactRow(CONTACT_EVAN, 'evan@example.test'),
    contactRow(CONTACT_FAY, 'fay@example.test'),
  ];
  h.steps = [{
    id: 'step-1', tenantId: TENANT, sequenceId: SEQ, stepNumber: 1, stepType: 'email',
    delayDays: 0, delayHours: 0, delayMinutes: 0, isActive: true, deletedAt: null,
  }];
  h.enrollments = [];
  h.bumps = [];
  h.derived = [];
});

describe('#3193 the enroll POST counts enrollment rows, not calls', () => {
  it('the first POST writes one row and moves the counter by one', async () => {
    const { res, json } = await enroll(CONTACT_DANA);
    expect(res.status, JSON.stringify(json)).toBe(201);
    expect(h.enrollments).toHaveLength(1);
    expect(counter()).toBe(1);
    expect(json?.data).toMatchObject({ sequenceId: SEQ, contactId: CONTACT_DANA, status: 'active' });
  });

  it('a second POST for the same active contact resets the row without inventing an enrollment', async () => {
    await enroll(CONTACT_DANA);
    // A completed row from an earlier pass, so the reset is provable and not a no-op.
    h.enrollments[0]!.currentStep = 3;
    const { res } = await enroll(CONTACT_DANA);
    expect(res.status).toBe(201);
    expect(h.enrollments, 'the conflict branch must not add a row').toHaveLength(1);
    expect(counter(), 'the counter must not move when the table did not').toBe(1);
    expect(h.enrollments[0]).toMatchObject({ currentStep: 1, status: 'active' });
  });

  it('and the number the client is shown afterwards still says one', async () => {
    await enroll(CONTACT_DANA);
    await enroll(CONTACT_DANA);
    const listed = await listSequences();
    expect(listed.data[0]!.enrollCount, 'the list reports the call count, not the table').toBe(1);
    expect(listed.data[0]!.enrollCount).toBe(h.enrollments.length);
    const detail = await readSequenceDetail();
    expect(detail.data.enrollCount).toBe(1);
  });

  it('three distinct contacts really are three enrollments', async () => {
    for (const id of [CONTACT_DANA, CONTACT_EVAN, CONTACT_FAY]) await enroll(id);
    expect(h.enrollments).toHaveLength(3);
    expect(counter()).toBe(3);
    expect((await listSequences()).data[0]!.enrollCount).toBe(3);
  });

  it('a cancel leaves the row, and re-enrolling after it inserts — and counts — a second one', async () => {
    // #2740's partial index only covers live active rows, so re-activation takes the
    // INSERT branch: this is the case that must NOT be swallowed by the fix above.
    await enroll(CONTACT_DANA);
    const del = await unenroll(CONTACT_DANA);
    expect(del.res.status, JSON.stringify(del.json)).toBe(200);
    expect(del.json).toMatchObject({ cancelledEnrollments: 1 });
    expect(h.enrollments[0]).toMatchObject({ status: 'cancelled' });
    expect(counter(), 'no cancel path decrements, and none pretends to').toBe(1);

    await enroll(CONTACT_DANA);
    expect(h.enrollments, 'the cancelled row stays, so a re-activation is an INSERT').toHaveLength(2);
    expect(h.enrollments.filter((row) => row.status === 'active')).toHaveLength(1);
    expect(counter()).toBe(2);
    expect((await listSequences()).data[0]!.enrollCount).toBe(2);
  });

  it('bumps with COALESCE, like the other four writers', async () => {
    await enroll(CONTACT_DANA);
    expect(h.bumps).toHaveLength(1);
    expect(h.bumps[0]!.sql).toMatch(/COALESCE\("sequences"\."enroll_count", 0\) \+ /i);
  });

  it('a null counter is revived rather than frozen at NULL', async () => {
    h.sequences[0]!.enrollCount = null;
    await enroll(CONTACT_DANA);
    expect(counter()).toBe(1);
  });
});

describe('#3193 both reads derive the number from sequence_enrollments', () => {
  it('the list ignores the column a double-click left behind', async () => {
    h.sequences[0]!.enrollCount = 9;
    h.enrollments = [
      enrollmentRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', contactId: CONTACT_DANA, status: 'active' }),
      enrollmentRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', contactId: CONTACT_EVAN, status: 'cancelled' }),
    ];
    const [row] = (await listSequences()).data;
    expect(row!.enrollCount).toBe(2);
    // Every other column of the row still ships: the derivation replaces the value,
    // not the payload shape the other consumers (`contacts-data-table`, `leads-client`)
    // read off this route.
    expect(row!).toMatchObject({ id: SEQ, name: 'Nurture drip', status: 'active', tenantId: TENANT });
  });

  it('the detail route agrees with the list', async () => {
    h.sequences[0]!.enrollCount = 9;
    h.enrollments = [enrollmentRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })];
    const detail = await readSequenceDetail();
    expect(detail.data.enrollCount).toBe(1);
    expect(detail.data.steps, 'the relational read still carries the steps').toHaveLength(1);
  });

  it('counts only this tenant, and only rows that are not tombstoned', async () => {
    h.enrollments = [
      enrollmentRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', contactId: CONTACT_DANA }),
      enrollmentRow({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', contactId: CONTACT_EVAN, tenantId: ELSEWHERE }),
      enrollmentRow({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', contactId: CONTACT_FAY, deletedAt: new Date('2026-02-02T09:00:00Z') }),
    ];
    h.sequences[0]!.enrollCount = 12;
    const [row] = (await listSequences()).data;
    expect(row!.enrollCount).toBe(1);
    expect((await readSequenceDetail()).data.enrollCount).toBe(1);

    const term = h.derived.at(-1)!;
    expect(term.sql).toMatch(/from "sequence_enrollments"/i);
    expect(term.sql).toMatch(/"sequence_enrollments"\."sequence_id" = "sequences"\."id"/i);
    expect(term.sql).toMatch(/"sequence_enrollments"\."tenant_id" = \$\d+/i);
    expect(term.sql).toMatch(/"sequence_enrollments"\."deleted_at" is null/i);
    expect(term.params).toContain(TENANT);
    expect(term.params, 'the tenant is bound, never interpolated').not.toContain(ELSEWHERE);
  });

  it('an empty sequence reports zero, not null and not undefined', async () => {
    h.sequences[0]!.enrollCount = 4;
    expect((await listSequences()).data[0]!.enrollCount).toBe(0);
    h.sequences[0]!.enrollCount = 4;
    expect((await readSequenceDetail()).data.enrollCount).toBe(0);
  });

  it('the automation sequences card reads the key this route actually sends', () => {
    // The route serializes drizzle's row (camelCase) straight into JSON, so the
    // snake_case key the page destructured was always undefined — the card read a
    // number that did not exist and fell back to "0 enrolled".
    const src = readFileSync(new URL('../../app/tenant/automation/sequences/page.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/seq\.enrollCount \?\? 0/);
    expect(src, 'the page must not destructure a key the route never sends').not.toMatch(/^\s*enroll_count\?:/m);
  });
});
