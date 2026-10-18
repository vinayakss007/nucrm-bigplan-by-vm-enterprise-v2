/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2794 — `PATCH /api/tenant/sequences/[id]` validated the body and then wrote the
 * *unvalidated* one for steps.
 *
 * The route reads `name` / `description` / `status` off `validated.data` and steps
 * off the raw body, then maps a dozen keys `createSequenceSchema` never declares
 * (`stepType`, `delay_days`, `delay_hours`, `content`, `templateId`) straight into
 * `sequence_steps`. So the schema's "a step is `{type, delay_minutes, subject,
 * body, template_id}`" (`lib/api/schemas/automation.ts:51-58`) only ever gated the
 * keys it knows about: a client could put 7 into `delay_days`, or an unbounded
 * string into `content`, and validation would never see it — while the sibling
 * POST (`app/api/tenant/sequences/route.ts:107-109`) derives all three delay
 * columns from `delay_minutes` and writes nothing else.
 *
 * The assertions below therefore do not just check the fixed row: they check that
 * PATCH and POST answer the same body with the same row. That is the property that
 * was broken, and it is what `stepDelayMs()` (`lib/cron/sequence-steps.ts:63`) and
 * the scheduler that reads it depend on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';
const SEQ = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, unknown>;
let inserted: Row[] = [];
let updated: Row[] = [];

/**
 * `insert().values()` is awaited by PATCH and chained with `.returning()` by POST,
 * so the recorder answers with a promise that carries both.
 */
function insertBuilder() {
  return (rows: Row | Row[]) => {
    inserted.push(...(Array.isArray(rows) ? rows : [rows]));
    return Object.assign(Promise.resolve(inserted), {
      returning: async () => [{ id: SEQ, tenantId: TENANT }],
    });
  };
}

function recorder() {
  return {
    insert: () => ({ values: insertBuilder() }),
    delete: () => ({ where: async () => {} }),
    update: () => ({ set: (values: Row) => { updated.push(values); return { where: async () => [] }; } }),
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    // The PATCH path only touches the DB inside the transaction, so the fake
    // hands the same recorder to `tx`.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(recorder()),
    update: () => ({
      set: (values: Row) => { updated.push(values); return { where: async () => [] }; },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  },
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(), can: () => true };
});
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/with-api-route')>('@/lib/api/with-api-route');
  return { ...actual, withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const patchRoute = await import('@/app/api/tenant/sequences/[id]/route');
const postRoute = await import('@/app/api/tenant/sequences/route');

function req(body: unknown, method: 'PATCH' | 'POST') {
  return new NextRequest(
    new URL(method === 'PATCH' ? `/api/tenant/sequences/${SEQ}` : '/api/tenant/sequences',
      'http://localhost:3000'),
    { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' }, body: JSON.stringify(body) },
  );
}

/** The step row a route inserted (POST writes the sequence row before its steps). */
const stepRow = (): Row | null => inserted.find((r) => 'stepType' in r) ?? null;

/** The row PATCH writes for `steps`, or null if the route refused the body. */
async function patchedRow(body: unknown): Promise<Row | null> {
  inserted = [];
  const res = await patchRoute.PATCH(req(body, 'PATCH'), { params: Promise.resolve({ id: SEQ }) });
  if (res.status !== 200) return null;
  return stepRow();
}

/** The row POST writes for the same steps, as the control the two must meet on. */
async function postedRow(body: unknown): Promise<Row | null> {
  inserted = [];
  const res = await postRoute.POST(req(body, 'POST'), {});
  if (res.status !== 201) return null;
  return stepRow();
}

const STEP_KEYS = ['stepNumber', 'stepType', 'subject', 'body', 'delayDays', 'delayHours', 'delayMinutes'];
const justSteps = (row: Row | null) => row && Object.fromEntries(STEP_KEYS.map((k) => [k, row[k]]));

beforeEach(() => {
  inserted = [];
  updated = [];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: USER, tenantId: TENANT, roleSlug: 'admin',
    permissions: { all: true }, isAdmin: true, isSuperAdmin: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sequence update route writes the body it validated (#2794)', () => {
  it('derives every delay column from delay_minutes', async () => {
    const row = await patchedRow({
      name: 'Onboarding',
      steps: [{ type: 'email', delay_minutes: 90, subject: 'Hi', body: 'There' }],
    });
    expect(justSteps(row)).toEqual({
      stepNumber: 1, stepType: 'email', subject: 'Hi', body: 'There',
      delayDays: 0, delayHours: 1, delayMinutes: 30,
    });
  });

  it('ignores a delay_days the schema never declared', async () => {
    const row = await patchedRow({
      name: 'Onboarding',
      steps: [{ type: 'delay', delay_minutes: 60, delay_days: 7, delay_hours: 20 }],
    });
    expect(row!.delayDays).toBe(0);
    expect(row!.delayHours).toBe(1);
    expect(row!.delayMinutes).toBe(0);
  });

  it('ignores a stepType and a content the schema never declared', async () => {
    const row = await patchedRow({
      name: 'Onboarding',
      steps: [{ type: 'task', stepType: 'whatsapp', content: 'an unbounded string' }],
    });
    expect(row!.stepType).toBe('task');
    expect(row!.content ?? null).toBeNull();
  });

  it('answers the same body with the same row as the create route', async () => {
    const body = {
      name: 'Onboarding',
      steps: [{ type: 'delay' as const, delay_minutes: 1560, delay_days: 9 }],
    };
    const viaPatch = await patchedRow(body);
    const viaPost = await postedRow(body);
    expect(justSteps(viaPost)).toBeTruthy();
    expect(justSteps(viaPatch)).toEqual(justSteps(viaPost));
  });

  // Control — the enum still gates the body, so a client cannot smuggle a step
  // type the table's check constraint would reject with a 23514.
  it('still refuses a step type the schema does not allow', async () => {
    const res = await patchRoute.PATCH(
      req({ name: 'Onboarding', steps: [{ type: 'call' }] }, 'PATCH'),
      { params: Promise.resolve({ id: SEQ }) },
    );
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('leaves the steps alone when the body carries none', async () => {
    expect(await patchedRow({ status: 'paused' })).toBeNull();
    expect(inserted).toHaveLength(0);
  });
});
