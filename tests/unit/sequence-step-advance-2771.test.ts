/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2771 — `advanceOrCompleteStep()` asks the database when the next step is due, and the database
 * cannot answer.
 *
 * `lib/cron/sequence-steps.ts:241-243` (at base) renders
 * `SELECT public.calculate_sequence_step_date(now(), $1::uuid, $2)` — three arguments — against the
 * function declared at `drizzle/migrations/0032_missing_db_functions.sql:32`, which takes two
 * (`p_sequence_id uuid, p_step_number integer`). Postgres resolves by signature, so the statement
 * raises before its body ever runs. Measured on a throwaway PG16 cluster with `0032:32-38` applied
 * verbatim:
 *
 *   ERROR:  function public.calculate_sequence_step_date(timestamp with time zone, uuid, integer) does not exist
 *
 * The call sits on the path of every step boundary (all `sequence-steps.ts` coordinates below are the
 * base file): `finalizeStepLog` awaits it inside the claim tx
 * (`lib/cron/sequence-steps.ts:324`), the SMTP confirm tx awaits it at
 * `app/api/cron/process-sequences/route.ts:373`, and the #2223 recovery branch awaits it at `:212`.
 *
 * Layer two is the stub contradicting the contract its caller branches on. `0032:37` is
 * `RETURN NOW() + interval '1 day'` — it ignores both parameters and can never return `NULL`, while
 * `:245` reads `rows[0]?.['next_date']` and `:247` treats a missing value as "no more steps →
 * `status='completed'`". So even at the right arity the last step of every sequence would schedule a
 * step that does not exist, forever.
 *
 * The reader below is not canned. It compiles the predicate the call actually renders and evaluates it
 * against seeded `sequence_steps` rows, so a lookup that drops a narrowing term admits more rows rather
 * than the expected one; and an `execute()` is answered the way Postgres answers it — by counting the
 * arguments bound to that call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('@/drizzle/db', () => ({ db: { transaction: vi.fn() } }));

import { advanceOrCompleteStep, type DueEnrollment } from '@/lib/cron/sequence-steps';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const SEQ = '33333333-3333-4333-8333-333333333333';
const ENROLLMENT_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '55555555-5555-4555-8555-555555555555';

const dialect = new PgDialect({} as never);

interface StepRow {
  id: string;
  tenantId: string;
  sequenceId: string;
  stepNumber: number;
  isActive: boolean;
  deletedAt: Date | null;
  delayDays: number | null;
  delayHours: number | null;
  delayMinutes: number | null;
}

const COLUMN_TO_KEY: Record<string, keyof StepRow> = {
  id: 'id',
  tenant_id: 'tenantId',
  sequence_id: 'sequenceId',
  step_number: 'stepNumber',
  is_active: 'isActive',
  deleted_at: 'deletedAt',
  delay_days: 'delayDays',
  delay_hours: 'delayHours',
  delay_minutes: 'delayMinutes',
};

function step(over: Partial<StepRow>): StepRow {
  return {
    id: 'step-x', tenantId: TENANT, sequenceId: SEQ, stepNumber: 1,
    isActive: true, deletedAt: null, delayDays: 1, delayHours: 0, delayMinutes: 0, ...over,
  };
}

let steps: StepRow[];
let executed: Array<{ sql: string; params: unknown[] }>;
let updates: Array<{ table: string; payload: Record<string, unknown>; sql: string; params: unknown[] }>;
let inserted: Array<Record<string, unknown>>;

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Compile the emitted boolean expression into a row predicate: unwrap, split, then compare. */
function compile(expr: string, params: unknown[]): (row: StepRow) => boolean {
  const text = expr.trim();

  const outerParens = (s: string): string | null => {
    if (s[0] !== '(') return null;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i === s.length - 1 ? s.slice(1, -1) : null;
      }
    }
    return null;
  };
  const inner = outerParens(text);
  if (inner !== null) return compile(inner, params);

  const splitTop = (kw: RegExp) => {
    const parts: string[] = [];
    let depth = 0, cur = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      const m = depth === 0 ? kw.exec(text.slice(i)) : null;
      if (m) { parts.push(cur); cur = ''; i += m[0].length - 1; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts.length > 1 ? parts : null;
  };

  const ands = splitTop(/^\s+and\s+/i);
  if (ands) return (row) => ands.every((p) => compile(p, params)(row));
  const ors = splitTop(/^\s+or\s+/i);
  if (ors) return (row) => ors.some((p) => compile(p, params)(row));

  const leaf = text.replace(/\s+/g, ' ');
  const col = /^"sequence_steps"\."([a-z_]+)"/.exec(leaf)?.[1];
  if (!col || !COLUMN_TO_KEY[col]) throw new Error(`unhandled predicate leaf: ${leaf}`);
  const key = COLUMN_TO_KEY[col];

  // A placeholder resolves to its bound parameter; a bare literal is itself. Either way an
  // `::uuid`-style cast belongs to the SQL, not to the value.
  const valueOf = (token: string): unknown => {
    const t = token.trim().replace(/::[\w[\]]+$/, '');
    const p = /^\$(\d+)$/.exec(t);
    if (p) return params[Number(p[1]) - 1];
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    if (/^null$/i.test(t)) return null;
    if (/^'.*'$/.test(t)) return t.slice(1, -1);
    if (/^\d+$/.test(t)) return Number(t);
    throw new Error(`unhandled value token: ${token}`);
  };

  const same = (a: unknown, b: unknown) => {
    if (a === null || b === null) return a === b;
    if (a instanceof Date || b instanceof Date) {
      return new Date(String(a)).getTime() === new Date(String(b)).getTime();
    }
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
    return String(a) === String(b);
  };

  let m = /^"sequence_steps"\."[a-z_]+" = (\S+)$/i.exec(leaf);
  if (m) { const want = valueOf(m[1]); return (row) => same(row[key], want); }
  m = /^"sequence_steps"\."[a-z_]+" is null$/i.exec(leaf);
  if (m) return (row) => row[key] === null || row[key] === undefined;
  m = /^"sequence_steps"\."[a-z_]+" is not null$/i.exec(leaf);
  if (m) return (row) => row[key] !== null && row[key] !== undefined;
  m = /^"sequence_steps"\."[a-z_]+" in \((.*)\)$/i.exec(leaf);
  if (m) {
    const list: string[] = [];
    let depth = 0, cur = '';
    for (const ch of m[1]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { list.push(cur); cur = ''; continue; }
      cur += ch;
    }
    list.push(cur);
    const wants = list.map(valueOf);
    return (row) => wants.some((w) => same(row[key], w));
  }
  throw new Error(`unhandled predicate leaf: ${leaf}`);
}

/** Postgres semantics for the step lookup: the rows the emitted predicate actually admits. */
function answerSteps(where: unknown, columns?: Record<string, boolean>): Array<Partial<StepRow>> {
  const matched = where
    ? steps.filter((s) => compile(render(where).sql, render(where).params)(s))
    : steps;
  if (!columns) return matched;
  return matched.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(columns)) if (k in row) out[k] = row[k as keyof StepRow];
    return out;
  });
}

/** The types Postgres would name for each bound argument of the stub call. */
function argTypes(body: string): string {
  return body.split(',').map((tok) => {
    const t = tok.trim();
    if (/^now\(\)/i.test(t)) return 'timestamp with time zone';
    if (/::uuid$/i.test(t)) return 'uuid';
    return 'integer';
  }).join(', ');
}

function enrollment(currentStep: number): DueEnrollment {
  return {
    id: ENROLLMENT_ID,
    tenantId: TENANT,
    sequenceId: SEQ,
    contactId: CONTACT_ID,
    currentStep,
    nextStepAt: new Date(Date.now() - 60000),
    status: 'active',
    contact: { email: 'lead@corp.test', doNotContact: false },
  };
}

const mockTx = {
  execute: vi.fn((predicate: unknown) => {
    const { sql, params } = render(predicate);
    executed.push({ sql, params });
    if (!/calculate_sequence_step_date/i.test(sql)) return Promise.resolve({ rows: [] });

    const at = sql.search(/calculate_sequence_step_date\s*\(/i);
    let depth = 0, body = '';
    for (let i = sql.indexOf('(', at); i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '(') { depth++; if (depth === 1) continue; }
      if (ch === ')') { depth--; if (depth === 0) break; }
      body += ch;
    }
    if (body.split(',').length !== 2) {
      throw new Error(
        `function public.calculate_sequence_step_date(${argTypes(body)}) does not exist`
      );
    }
    // `0032:37` — the stub ignores both parameters and can never answer NULL.
    return Promise.resolve({ rows: [{ next_date: new Date(Date.now() + 86400000) }] });
  }),
  query: {
    sequenceSteps: {
      findFirst: vi.fn((config?: { where?: unknown; columns?: Record<string, boolean> }) =>
        Promise.resolve(answerSteps(config?.where, config?.columns)[0])),
      findMany: vi.fn((config?: { where?: unknown; columns?: Record<string, boolean> }) =>
        Promise.resolve(answerSteps(config?.where, config?.columns))),
    },
  },
  update: vi.fn((table: unknown) => ({
    set: vi.fn((payload: Record<string, unknown>) => ({
      where: vi.fn((predicate: unknown) => {
        const { sql, params } = render(predicate);
        updates.push({
          table: /"([a-z_]+)"\."/.exec(sql)?.[1] ?? String((table as { name?: string })?.name ?? 'unknown'),
          payload, sql, params,
        });
        return Promise.resolve([]);
      }),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve([]);
    }),
  })),
};

beforeEach(() => {
  steps = [];
  executed = [];
  updates = [];
  inserted = [];
});

describe('#2771 — the step boundary resolves without a database function', () => {
  it('advances to the next step and schedules it by that step\'s own delay', async () => {
    steps = [
      step({ id: 's1', stepNumber: 1, delayDays: 0 }),
      step({ id: 's2', stepNumber: 2, delayDays: 3 }),
      step({ id: 's3', stepNumber: 3, delayDays: 1 }),
    ];
    const before = Date.now();
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    expect(executed, 'the schedule must not come from a db function').toHaveLength(0);
    const advance = updates.find((u) => 'currentStep' in u.payload);
    expect(advance, 'the enrollment moves to step 2').toBeDefined();
    expect(advance!.payload.currentStep).toBe(2);
    const at = new Date(advance!.payload.nextStepAt as Date).getTime();
    expect(at - before).toBeGreaterThanOrEqual(3 * 86400000 - 5000);
    expect(at - before).toBeLessThan(3 * 86400000 + 60000);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ stepId: 's2', status: 'pending', enrollmentId: ENROLLMENT_ID });
  });

  it('honours the hours and minutes the sequences API actually writes', async () => {
    // app/api/tenant/sequences/route.ts:107-109 stores an incoming delay_minutes as
    // hours + minutes and leaves delay_days at 0; a flat day ignores both.
    steps = [
      step({ id: 's1', stepNumber: 1 }),
      step({ id: 's2', stepNumber: 2, delayDays: 0, delayHours: 6, delayMinutes: 30 }),
    ];
    const before = Date.now();
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    const advance = updates.find((u) => 'currentStep' in u.payload)!;
    const at = new Date(advance.payload.nextStepAt as Date).getTime();
    expect(at - before).toBeGreaterThanOrEqual(6.5 * 3600000 - 5000);
    expect(at - before).toBeLessThan(6.5 * 3600000 + 60000);
  });

  it('completes the enrollment after its last step instead of scheduling step N+1', async () => {
    steps = [
      step({ id: 's1', stepNumber: 1 }),
      step({ id: 's2', stepNumber: 2 }),
    ];
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(2));

    expect(executed).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('completed');
    expect(updates[0].payload.completedAt).toBeInstanceOf(Date);
    expect(updates[0].payload.currentStep, 'a completed sequence does not move').toBeUndefined();
    expect(inserted, 'there is no pending log for a step that does not exist').toHaveLength(0);
  });

  it('treats an inactive next step as the end, the way the cron\'s own step map does', async () => {
    steps = [
      step({ id: 's1', stepNumber: 1 }),
      step({ id: 's2', stepNumber: 2, isActive: false }),
    ];
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('completed');
  });

  it('treats a soft-deleted next step as the end', async () => {
    steps = [
      step({ id: 's1', stepNumber: 1 }),
      step({ id: 's2', stepNumber: 2, deletedAt: new Date() }),
    ];
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('completed');
  });

  it('will not advance onto another tenant\'s step', async () => {
    steps = [
      step({ id: 's1', stepNumber: 1 }),
      step({ id: 's2-other', stepNumber: 2, tenantId: OTHER_TENANT, delayDays: 9 }),
    ];
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    expect(updates).toHaveLength(1);
    expect(updates[0].payload.status).toBe('completed');
    expect(updates[0].payload.currentStep).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it('pins the write to the enrollment and its tenant', async () => {
    steps = [step({ id: 's1', stepNumber: 1 }), step({ id: 's2', stepNumber: 2 })];
    await advanceOrCompleteStep(mockTx as never, TENANT, enrollment(1));

    const advance = updates.find((u) => 'currentStep' in u.payload)!;
    expect(advance.sql).toMatch(/"sequence_enrollments"\."id"/);
    expect(advance.sql).toMatch(/"sequence_enrollments"\."tenant_id"/);
    expect(advance.params).toContain(ENROLLMENT_ID);
    expect(advance.params).toContain(TENANT);
    expect(advance.params).not.toContain(OTHER_TENANT);
  });
});
