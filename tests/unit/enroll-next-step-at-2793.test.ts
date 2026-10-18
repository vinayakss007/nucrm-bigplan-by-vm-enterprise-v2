/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c)2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2793 — five enrollment writers leave `next_step_at` NULL, and the cron's due
 * sweep can never select a NULL (`dueEnrollmentsSql` requires
 * `e.next_step_at <= NOW()`), so those enrollments sit `active` forever and
 * nothing ever sends.
 *
 * The row is written `status:'active', currentStep:1` with no due date, which
 * looks like a successful enrollment in every UI and in `sequence_enrollments`
 * itself — the failure is invisible. Only `contacts/[id]/enroll` sets the column.
 *
 * Fixed by one `firstStepDueAt(executor, tenantId, sequenceId)` beside the
 * `stepDelayMs()` (#2772) it reuses, called by every writer. Asserted here on
 * what the writer actually hands the insert, through a `db` that answers the way
 * Postgres would — a canned `{ enrolled: 1 }` would pass with no due date at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const SEQ = '44444444-4444-4444-8444-444444444444';
const SEG = '55555555-5555-4555-8555-555555555555';
const CONTACT_A = '66666666-6666-4666-8666-666666666666';
const CONTACT_B = '77777777-7777-4777-8777-777777777777';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const dialect = new PgDialect({} as never);
const render = (node: unknown) => dialect.sqlToQuery(node as never);

type StepRow = {
  id: string; tenantId: string; sequenceId: string; stepNumber: number;
  delayDays: number | null; delayHours: number | null; delayMinutes: number | null;
  isActive: boolean; deletedAt: Date | null;
};
type Q = { table: string; sql: string; params: unknown[]; limit: number | null };

const h = vi.hoisted(() => ({ steps: [], contacts: [], sequences: [], segments: [], members: [], enrollments: [], written: [] as Record<string, unknown>[], updates: 0 }));

function bound(q: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`, 'i').exec(q.sql);
  return m ? q.params[Number(m[1]) - 1] : undefined;
}
function boundList(q: Q, column: string): unknown[] | undefined {
  const m = new RegExp(`"${column}" in \\(([^)]*)\\)`, 'i').exec(q.sql);
  if (!m) return undefined;
  return m[1].split(',').map((term) => {
    const d = /\$(\d+)/.exec(term);
    return d ? q.params[Number(d[1]) - 1] : undefined;
  });
}
const has = (q: Q, re: RegExp) => re.test(q.sql);

/** Answers a rendered predicate the way the table would. */
function answer(q: Q): Record<string, unknown>[] {
  const tenant = bound(q, 'tenant_id');
  switch (q.table) {
    case 'sequence_steps': {
      const seqIds = boundList(q, 'sequence_id') ?? [];
      const wantActive = bound(q, 'is_active');
      const wantNumber = bound(q, 'step_number');
      let rows = h.steps.filter((s) =>
        (tenant === undefined || s.tenantId === tenant)
        && seqIds.map(String).includes(s.sequenceId)
        && (wantActive === undefined || s.isActive === wantActive)
        && (wantNumber === undefined || s.stepNumber === wantNumber)
        && (!has(q, /"deleted_at" is null/i) || s.deletedAt === null));
      if (q.limit !== null) rows = rows.slice(0, q.limit);
      return rows.map((s) => ({ ...s }));
    }
    case 'sequences': {
      const seq = h.sequences.find((s) => s.id === bound(q, 'id') || (boundList(q, 'id') ?? []).includes(s.id));
      return seq && (tenant === undefined || seq.tenantId === tenant) ? [{ ...seq }] : [];
    }
    case 'segments': {
      const seg = h.segments.find((s) => s.id === bound(q, 'id'));
      return seg && (tenant === undefined || seg.tenantId === tenant) ? [{ ...seg }] : [];
    }
    case 'segment_members': {
      const segId = bound(q, 'segment_id');
      return h.members.filter((m) => m.segmentId === segId).map((m) => ({ entityId: m.entityId }));
    }
    case 'contacts': {
      const ids = boundList(q, 'id');
      const wantDnc = bound(q, 'do_not_contact');
      const wantUnsub = bound(q, 'unsubscribed');
      return h.contacts.filter((c) =>
        (ids ? ids.includes(c.id) : true)
        && (tenant === undefined || c.tenantId === tenant)
        && (!has(q, /"deleted_at" is null/i) || c.deletedAt === null)
        && (wantDnc === undefined || c.doNotContact === wantDnc)
        && (wantUnsub === undefined || c.unsubscribed === wantUnsub))
        .map((c) => ({ id: c.id }));
    }
    case 'sequence_enrollments': {
      const seqId = bound(q, 'sequence_id');
      const ids = boundList(q, 'contact_id');
      return h.enrollments.filter((e) =>
        e.tenantId === (tenant ?? e.tenantId)
        && (seqId === undefined || e.sequenceId === seqId)
        && (ids ? ids.includes(e.contactId) : true)
        && (!has(q, /"status" = /i) || e.status === bound(q, 'status')))
        .map((e) => ({ contactId: e.contactId, id: e.id }));
    }
    default:
      return [];
  }
}

function selectBuilder(table: { sql?: string } | undefined, record: (q: Q) => void) {
  const b: Record<string, unknown> = {};
  const q: Q = { table: '', sql: '', params: [], limit: null };
  b['from'] = (t: object) => { q.table = getTableName(t as never); return b; };
  b['where'] = (pred: unknown) => { const r = render(pred); q.sql = r.sql; q.params = r.params as unknown[]; return b; };
  b['orderBy'] = () => b;
  b['limit'] = (n: number) => { q.limit = n; return b; };
  for (const m of ['leftJoin', 'innerJoin', 'groupBy', 'offset', 'for']) b[m] = () => b;
  b['then'] = (done: (v: unknown) => unknown) => { record(q); return Promise.resolve(answer(q)).then(done); };
  void table;
  return b;
}

function executor() {
  const readLog: Q[] = [];
  const ex: Record<string, unknown> = {
    select: () => selectBuilder(undefined, (q) => readLog.push(q)),
    insert: (t: object) => ({
      values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        if (getTableName(t as never) === 'sequence_enrollments') h.written.push(...list);
        const chain = {
          onConflictDoNothing: () => Promise.resolve({ rowCount: list.length }),
          onConflictDoUpdate: () => Promise.resolve(list),
          returning: () => Promise.resolve(list.map((r) => ({ id: String(r.id ?? 'enrollment-id'), contactId: r.contactId }))),
          then: (done: (v: unknown) => unknown) => Promise.resolve({ rowCount: list.length }).then(done),
        };
        return chain;
      },
    }),
    update: () => ({ set: () => ({ where: () => { h.updates += 1; return Promise.resolve(); } }) }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: () => Promise.resolve({ rows: [] }),
    query: {},
    readLog,
  };
  ex['transaction'] = (cb: (tx: unknown) => Promise<unknown>) => cb(ex);
  return ex;
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
vi.mock('@/lib/dashboard/widget-cache', () => ({ invalidateWidgetCache: vi.fn() }));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_c: unknown, _e: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  enforceFieldRead: (_c: unknown, _e: string, rows: unknown[]) => Promise.resolve(rows),
}));

const { firstStepDueAt } = await import('@/lib/cron/sequence-steps');
const { requireAuth } = await import('@/lib/auth/middleware');
const segmentEnroll = await import('@/app/api/tenant/segments/[id]/enroll/route');
const contactsBulk = await import('@/app/api/tenant/contacts/bulk/route');

const step = (over: Partial<StepRow>): StepRow => ({
  id: 'step-1', tenantId: TENANT, sequenceId: SEQ, stepNumber: 1,
  delayDays: 0, delayHours: 0, delayMinutes: 0, isActive: true, deletedAt: null, ...over,
});

const ctxAll = {
  userId: USER, tenantId: TENANT, roleSlug: 'owner',
  permissions: { 'automations.manage': true, 'contacts.view_all': true, 'contacts.view': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

async function postSegmentEnroll() {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxAll);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/segments/${SEG}/enroll`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ sequence_id: SEQ }),
  });
  return (segmentEnroll.POST as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: SEG }) });
}

async function postContactsBulk() {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxAll);
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/contacts/bulk'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ action: 'add_to_sequence', ids: [CONTACT_A, CONTACT_B], updates: {}, payload: { sequence_id: SEQ } }),
  });
  return (contactsBulk.POST as (r: NextRequest) => Promise<Response>)(req);
}

beforeEach(() => {
  h.steps = [];
  h.contacts = [];
  h.sequences = [{ id: SEQ, tenantId: TENANT, status: 'active', deletedAt: null }];
  h.segments = [{ id: SEG, tenantId: TENANT, entityType: 'contact', deletedAt: null }];
  h.members = [{ segmentId: SEG, entityId: CONTACT_A }, { segmentId: SEG, entityId: CONTACT_B }];
  h.contacts = [
    { id: CONTACT_A, tenantId: TENANT, deletedAt: null, doNotContact: false, unsubscribed: false },
    { id: CONTACT_B, tenantId: TENANT, deletedAt: null, doNotContact: false, unsubscribed: false },
  ];
  h.enrollments = [];
  h.written = [];
  h.updates = 0;
});

describe('firstStepDueAt — the delay step 1 asks for, from the step the cron will run', () => {
  it('exists', () => {
    expect(typeof firstStepDueAt).toBe('function');
  });

  it('sums all three delay columns of step 1', async () => {
    h.steps = [
      step({ id: 's1', stepNumber: 1, delayDays: 1, delayHours: 6, delayMinutes: 30 }),
      step({ id: 's2', stepNumber: 2, delayDays: 30 }),
    ];
    const due = await firstStepDueAt(mockDb as never, TENANT, SEQ);
    expect(due).toBeInstanceOf(Date);
    expect(due.getTime() - Date.now()).toBeGreaterThanOrEqual(DAY + 6 * HOUR + 30 * MIN - 5_000);
    expect(due.getTime() - Date.now()).toBeLessThanOrEqual(DAY + 6 * HOUR + 30 * MIN + 5_000);
  });

  it('asks the step the cron will run, which is number 1 — the enrollment is written at currentStep 1', async () => {
    // The sweep looks the step up by `sequenceId:currentStep`
    // (app/api/cron/process-sequences/route.ts:141), so the delay that matters
    // for a fresh enrollment is step 1's — whatever the other rows say and
    // whatever order they arrive in.
    h.steps = [
      step({ id: 's3', stepNumber: 3, delayDays: 4 }),
      step({ id: 's1', stepNumber: 1, delayHours: 2 }),
      step({ id: 's2', stepNumber: 2, delayDays: 9 }),
    ];
    const due = await firstStepDueAt(mockDb as never, TENANT, SEQ);
    expect(due.getTime() - Date.now()).toBeGreaterThanOrEqual(2 * HOUR - 5_000);
    expect(due.getTime() - Date.now()).toBeLessThan(3 * HOUR);
  });

  it('a step 1 the cron will not run leaves the enrollment due now, not NULL forever', async () => {
    // An inactive or tombstoned step 1 means the sweep completes the enrollment
    // on the first tick; that is a loud, short-lived outcome. `next_step_at IS
    // NULL` never is — it is invisible and permanent.
    h.steps = [
      step({ id: 'off', stepNumber: 1, delayDays: 30, isActive: false }),
      step({ id: 's2', stepNumber: 2, delayDays: 21 }),
    ];
    const due = await firstStepDueAt(mockDb as never, TENANT, SEQ);
    expect(Math.abs(due.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('is due immediately when the sequence has no step 1 at all', async () => {
    h.steps = [step({ stepNumber: 2, delayDays: 5 })];
    const due = await firstStepDueAt(mockDb as never, TENANT, SEQ);
    expect(Math.abs(due.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('scopes the read to the tenant, the sequence and step 1', async () => {
    h.steps = [step({ stepNumber: 1, delayHours: 4 })];
    await firstStepDueAt(mockDb as never, TENANT, SEQ);
    const q = (mockDb as unknown as { readLog: Q[] }).readLog.at(-1)!;
    expect(q.table).toBe('sequence_steps');
    expect(q.params).toContain(TENANT);
    expect(q.params).toContain(SEQ);
    expect(q.params).toContain(1);
    expect(q.sql).toMatch(/"is_active"/i);
    expect(q.sql).toMatch(/"deleted_at" is null/i);
    expect(q.sql).toMatch(/"step_number" = /i);
  });

  it('does not read another tenant step just because the sequence id matches', async () => {
    h.steps = [step({ stepNumber: 1, tenantId: ELSEWHERE, delayDays: 30 })];
    const due = await firstStepDueAt(mockDb as never, TENANT, SEQ);
    expect(Math.abs(due.getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe('#2793 — a writer that omits the due date can never be picked up', () => {
  it('segments/[id]/enroll puts step 1 s delay on every row it writes', async () => {
    h.steps = [step({ stepNumber: 1, delayHours: 24 })];
    const before = Date.now();
    const res = await postSegmentEnroll();
    expect(res.status, await res.text()).toBe(200);
    expect(h.written.length).toBeGreaterThan(0);
    for (const row of h.written) {
      expect(row['nextStepAt'], `row ${JSON.stringify(row)} has no due date`).toBeInstanceOf(Date);
      const due = (row['nextStepAt'] as Date).getTime();
      expect(due - before).toBeGreaterThanOrEqual(24 * HOUR - 5_000);
      expect(due - before).toBeLessThanOrEqual(24 * HOUR + 5_000);
    }
  });

  it('contacts/bulk add_to_sequence does the same inside its transaction', async () => {
    h.steps = [step({ stepNumber: 1, delayDays: 2, delayHours: 3 })];
    const before = Date.now();
    const res = await postContactsBulk();
    expect(res.status, await res.text()).toBe(200);
    expect(h.written.length).toBe(2);
    for (const row of h.written) {
      expect(row['nextStepAt'], `row ${JSON.stringify(row)} has no due date`).toBeInstanceOf(Date);
      const due = (row['nextStepAt'] as Date).getTime();
      expect(due - before).toBeGreaterThanOrEqual(2 * DAY + 3 * HOUR - 5_000);
      expect(due - before).toBeLessThanOrEqual(2 * DAY + 3 * HOUR + 5_000);
    }
  });
});

describe('every enrollment writer goes through the one helper', () => {
  const WRITERS: [string, string][] = [
    ['segment enroll', 'app/api/tenant/segments/[id]/enroll/route.ts'],
    ['contacts bulk', 'app/api/tenant/contacts/bulk/route.ts'],
    ['leads bulk', 'app/api/tenant/leads/bulk/route.ts'],
    ['sequence enroll', 'app/api/tenant/sequences/[id]/route.ts'],
    ['automation engine', 'lib/automation/engine.ts'],
    ['contact enroll', 'app/api/tenant/contacts/[id]/enroll/route.ts'],
  ];

  for (const [label, file] of WRITERS) {
    it(`${label} computes the first due date instead of leaving it null`, async () => {
      const src = (await import('node:fs')).readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(src, `${file} never calls the shared helper`).toContain('firstStepDueAt');
      const valuesBlock = src.slice(src.search(/status:\s*'active'/));
      expect(valuesBlock.slice(0, 400), `${file} writes an enrollment without nextStepAt`).toMatch(/nextStepAt/);
    });
  }
});
