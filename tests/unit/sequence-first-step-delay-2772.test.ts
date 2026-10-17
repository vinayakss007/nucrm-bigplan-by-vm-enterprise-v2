/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2772 — the first step of a sequence is scheduled from one delay column out of three.
 *
 * `sequence_steps` carries `delay_days`, `delay_hours` and `delay_minutes`
 * (`drizzle/schema/marketing.ts:41-43`), and the two step-writing routes disagree about which they
 * fill: `POST /api/tenant/sequences` (`app/api/tenant/sequences/route.ts:107-109`) flattens the
 * caller's `delay_minutes` into the hours/minutes pair and pins `delayDays: 0`, while the update
 * route (`PATCH /api/tenant/sequences/[id]`, `app/api/tenant/sequences/[id]/route.ts:154-156`)
 * writes all three. `app/api/tenant/contacts/[id]/enroll/route.ts:68` read only `delay_days` — so
 * for every
 * sequence created through POST, `firstDelay` was 0, `nextStepAt` was `now`, and the very next
 * `process-sequences` tick dispatched step 1. "Wait 24 hours before the first touch" became an
 * immediate send, on the app's own default creation path.
 *
 * #2771 fixed the *between-steps* half (`lib/cron/sequence-steps.ts` summed all three before this
 * change too); this is the remaining half, plus the shared helper so the two schedulers cannot drift
 * apart again. The arithmetic is therefore pinned at **both** call sites, on the same step shape —
 * a file that only checked the new one would still pass if the old one regressed.
 *
 * No database is involved: `stepDelayMs` is pure, and the route is driven through a fake `db` that
 * records the row it is handed. Dates are compared as deltas against `Date.now()` taken around the
 * call, with a 5 s floor and a 60 s ceiling — loose enough for a slow CI worker, tight enough that
 * "due at `now`" (the bug) cannot pass as "due at `now + 24 h`".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SEQ = '33333333-3333-4333-8333-333333333333';
const CONTACT = '55555555-5555-4555-8555-555555555555';

/**
 * One fake transaction, shared by both schedulers. `advanceOrCompleteStep` takes the `tx` its caller
 * hands it, so the between-steps cases call `h.tx()` directly rather than reaching through
 * `db.transaction` — and both paths land in the same holders, which is what makes the agreement
 * assertions below mean "the same row shape produces the same wait at both sites".
 */
const h = vi.hoisted(() => {
  const state: {
    steps: Record<string, number | null>[];
    enrolled: Record<string, unknown> | null;
    advanced: Record<string, unknown> | null;
    logRow: Record<string, unknown> | null;
    tx: () => unknown;
  } = {
    steps: [],
    enrolled: null,
    advanced: null,
    logRow: null,
    tx: () => ({
      query: {
        sequenceSteps: {
          findFirst: async () => state.steps[1] ?? state.steps[0] ?? null,
        },
      },
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          // `sequence_step_logs` is the only insert that names an enrollment; the enroll route
          // inserts `sequence_enrollments`. Distinguishing by row shape keeps the fake honest
          // without importing either table into a hoisted factory.
          if ('enrollmentId' in row) state.logRow = row;
          else state.enrolled = row;
          return {
            onConflictDoUpdate: () => ({ returning: async () => [{ id: 'enr-1', ...row }] }),
            returning: async () => [{ id: 'enr-1', ...row }],
          };
        },
      }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          state.advanced = payload;
          return { where: async () => [] };
        },
      }),
    }),
  };
  return state;
});

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'u1', tenantId: TENANT, role: 'admin' })),
  requirePerm: vi.fn(() => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => ({ sequence_id: SEQ })),
  validateBody: (_schema: unknown, body: Record<string, unknown>) => ({ data: body }),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      contacts: { findFirst: vi.fn(async () => ({ id: CONTACT })) },
      sequences: { findFirst: vi.fn(async () => ({ id: SEQ })) },
      sequenceSteps: { findMany: vi.fn(async () => h.steps) },
    },
    transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(h.tx())),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({ returning: async () => [{ id: 'enr-1' }] }),
        returning: async () => [{ id: 'enr-1' }],
      }),
    }),
  },
}));

import { stepDelayMs, advanceOrCompleteStep, type DueEnrollment } from '@/lib/cron/sequence-steps';
import { POST } from '@/app/api/tenant/contacts/[id]/enroll/route';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

const ENROLL_ROUTE = fileURLToPath(new URL(
  '../../app/api/tenant/contacts/[id]/enroll/route.ts', import.meta.url));

/** Drive the enroll route and return how far ahead it scheduled step 1. */
async function enrollDeltaMs(step: Record<string, number | null> | undefined): Promise<number> {
  h.steps = step === undefined ? [] : [step];
  h.enrolled = null;
  const before = Date.now();
  const res = await POST(
    { nextUrl: 'http://localhost/api/tenant/contacts/c1/enroll', method: 'POST' } as never,
    { params: Promise.resolve({ id: CONTACT }) } as never,
  );
  expect(res.status).toBe(201);
  expect(h.enrolled).not.toBeNull();
  return new Date((h.enrolled as { nextStepAt: Date }).nextStepAt).getTime() - before;
}

/** The same step shape through the between-steps scheduler. */
async function advanceDeltaMs(step: Record<string, number | null>): Promise<number> {
  h.steps = [{ delayDays: 0, delayHours: 0, delayMinutes: 0 }, step];
  h.advanced = null;
  const before = Date.now();
  await advanceOrCompleteStep(
    h.tx() as never,
    TENANT,
    {
      id: 'enr-1', tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT,
      currentStep: 1, nextStepAt: new Date(before), status: 'active', contact: null,
    } as DueEnrollment,
  );
  expect(h.advanced).not.toBeNull();
  return new Date((h.advanced as { nextStepAt: Date }).nextStepAt).getTime() - before;
}

describe('stepDelayMs — every delay column a step carries', () => {
  it('reads the POST /sequences shape, where the whole wait lives in hours', () => {
    expect(stepDelayMs({ delayDays: 0, delayHours: 24, delayMinutes: 0 })).toBe(24 * HOUR);
  });

  it('reads the PATCH /sequences/[id] shape, where it lives in days', () => {
    expect(stepDelayMs({ delayDays: 3, delayHours: 0, delayMinutes: 0 })).toBe(3 * DAY);
  });

  it('sums all three rather than picking one', () => {
    expect(stepDelayMs({ delayDays: 1, delayHours: 6, delayMinutes: 30 })).toBe(DAY + 6 * HOUR + 30 * MIN);
  });

  it('treats a null or missing column as no wait', () => {
    expect(stepDelayMs({ delayDays: null, delayHours: null, delayMinutes: null })).toBe(0);
    expect(stepDelayMs({})).toBe(0);
  });

  it('keeps a minutes-only step a 90-minute wait, not zero', () => {
    expect(stepDelayMs({ delayDays: 0, delayHours: 1, delayMinutes: 30 })).toBe(90 * MIN);
  });
});

describe('POST /api/tenant/contacts/[id]/enroll — the first step date (#2772)', () => {
  beforeEach(() => {
    h.steps = [];
    h.enrolled = null;
    h.advanced = null;
    h.logRow = null;
  });

  it('waits 24 hours for a step POST /sequences created with delay_minutes: 1440', async () => {
    const delta = await enrollDeltaMs({ delayDays: 0, delayHours: 24, delayMinutes: 0 });
    expect(delta).toBeGreaterThanOrEqual(24 * HOUR - 5000);
    expect(delta).toBeLessThan(24 * HOUR + 60_000);
  });

  it('waits 3 days for the same step created through PATCH /sequences/[id]', async () => {
    const delta = await enrollDeltaMs({ delayDays: 3, delayHours: 0, delayMinutes: 0 });
    expect(delta).toBeGreaterThanOrEqual(3 * DAY - 5000);
    expect(delta).toBeLessThan(3 * DAY + 60_000);
  });

  it('waits the 90 minutes a split step asks for', async () => {
    const delta = await enrollDeltaMs({ delayDays: 0, delayHours: 1, delayMinutes: 30 });
    expect(delta).toBeGreaterThanOrEqual(90 * MIN - 5000);
    expect(delta).toBeLessThan(90 * MIN + 60_000);
  });

  it('still enrolls immediately when the first step carries no delay', async () => {
    const delta = await enrollDeltaMs({ delayDays: 0, delayHours: 0, delayMinutes: 0 });
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(60_000);
  });

  it('leaves a step-less sequence as it was: due now, enrollment still written', async () => {
    const delta = await enrollDeltaMs(undefined);
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(60_000);
    expect(h.enrolled).toMatchObject({
      tenantId: TENANT, sequenceId: SEQ, contactId: CONTACT, currentStep: 1, status: 'active',
    });
  });

  it('schedules the row it hands the upsert, not a value computed from one column', async () => {
    await enrollDeltaMs({ delayDays: 0, delayHours: 24, delayMinutes: 0 });
    expect((h.enrolled as { nextStepAt: Date }).nextStepAt instanceof Date).toBe(true);
  });
});

describe('the two schedulers agree, so #2771 and #2772 cannot drift apart again', () => {
  it('advanceOrCompleteStep schedules the same wait the enroll route does', async () => {
    const step = { delayDays: 0, delayHours: 24, delayMinutes: 0 };
    const enrolled = await enrollDeltaMs(step);
    const advanced = await advanceDeltaMs(step);
    expect(advanced).toBeGreaterThanOrEqual(24 * HOUR - 5000);
    expect(Math.abs(enrolled - advanced)).toBeLessThan(60_000);
  });

  it('both read days, hours and minutes on a mixed step', async () => {
    const step = { delayDays: 1, delayHours: 6, delayMinutes: 30 };
    const enrolled = await enrollDeltaMs(step);
    const advanced = await advanceDeltaMs(step);
    expect(enrolled).toBeGreaterThanOrEqual(DAY + 6 * HOUR + 30 * MIN - 5000);
    expect(Math.abs(enrolled - advanced)).toBeLessThan(60_000);
  });

  it('the between-steps path still writes the pending step log at the same instant', async () => {
    await advanceDeltaMs({ delayDays: 2, delayHours: 0, delayMinutes: 0 });
    expect(h.logRow).not.toBeNull();
    expect((h.logRow as { status: string }).status).toBe('pending');
    expect(new Date((h.logRow as { scheduledAt: Date }).scheduledAt).getTime())
      .toBeGreaterThanOrEqual(
        new Date((h.advanced as { nextStepAt: Date }).nextStepAt).getTime() - 1000);
  });
});

describe('one helper, both call sites', () => {
  it('the enroll route delegates the arithmetic instead of re-deriving it', () => {
    const src = readFileSync(ENROLL_ROUTE, 'utf8');
    expect(src).toContain('stepDelayMs(steps[0] ?? {})');
    expect(src).not.toMatch(/delayDays\s*\?\?\s*0\s*\)?\s*\*\s*86400000/);
    expect(src).toContain("from '@/lib/cron/sequence-steps'");
  });

  it('and so does the between-steps scheduler', () => {
    const src = readFileSync(fileURLToPath(new URL('../../lib/cron/sequence-steps.ts', import.meta.url)), 'utf8');
    expect(src).toContain('new Date(Date.now() + stepDelayMs(nextStep))');
    expect(src).not.toMatch(/delayMinutes \?\? 0\) \* 60000/);
  });
});
