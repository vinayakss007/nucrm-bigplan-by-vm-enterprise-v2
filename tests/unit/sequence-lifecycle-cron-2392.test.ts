/**
 * #2392 — deleting a sequence or a contact must stop the drip.
 *
 * `app/api/cron/process-sequences` filtered `sequence_enrollments` on
 * `status = 'active'` and nothing else: no `deleted_at`, no join to the parent
 * `sequences`, no `deleted_at` on the contact fetch, no `deleted_at` on the step
 * fetch. A DELETE `/api/tenant/sequences/[id]` sets `deleted_at` and
 * `status='archived'` but leaves every enrollment row `'active'`, so the next
 * cron tick re-reads it and mails the contact — indefinitely for a sequence
 * whose steps keep rescheduling.
 *
 * The predicates now live in `lib/cron/sequence-steps.ts` as exported SQL so
 * this file and the integration suite can both reach the exact statement the
 * route runs. Asserting on a mocked return value would prove nothing about a
 * WHERE clause, so every check here renders the SQL node
 * (`PgDialect().sqlToQuery`) — the text that would actually hit Postgres.
 *
 * Inertness is proved by counting: `sendEmail` and `createEmailTracking` must
 * be called zero times for lifecycle-dead enrollments, and exactly once for the
 * live control in the same suite. A suite that never sends anything would also
 * be "inert", so the control case is load-bearing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const CRON_SECRET = 'test-cron-secret';

const h = vi.hoisted(() => ({
  executes: [] as unknown[],
  executeResults: [] as Array<Array<Record<string, unknown>>>,
  updates: [] as Array<{ table: unknown; payload: Record<string, unknown>; where: unknown }>,
  inserts: [] as Array<{ table: unknown; payload: unknown }>,
  stepWheres: [] as unknown[],
  steps: [] as Array<Record<string, unknown>>,
}));

const dialect = new PgDialect();
function render(node: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
  return { sql: q.sql, params: q.params ?? [] };
}
function sqlOf(node: unknown): string {
  return render(node).sql;
}

function txMock() {
  const tx: Record<string, unknown> = {
    execute: (node: unknown) => {
      h.executes.push(node);
      return Promise.resolve({ rows: h.executeResults.shift() ?? [] });
    },
    update: (table: unknown) => {
      const rec = { table, payload: {} as Record<string, unknown>, where: undefined as unknown };
      h.updates.push(rec);
      const chain: Record<string, unknown> = {
        set: (p: Record<string, unknown>) => { Object.assign(rec.payload, p); return chain; },
        where: (w: unknown) => { rec.where = w; return chain; },
        returning: async () => [{ id: randomUUID() }],
        // Real drizzle statements are thenables, so the route's best-effort
        // `.catch(...)` on a write is valid; the mock must be too.
        catch: (_f: unknown) => Promise.resolve(),
      };
      return chain;
    },
    insert: (table: unknown) => {
      const rec = { table, payload: undefined as unknown };
      h.inserts.push(rec);
      const chain: Record<string, unknown> = {
        values: (p: unknown) => { rec.payload = p; return chain; },
      };
      return chain;
    },
    query: {
      sequenceSteps: {
        findMany: ({ where }: { where: unknown }) => {
          h.stepWheres.push(where);
          return Promise.resolve(h.steps);
        },
        findFirst: async () => null,
      },
      sequenceStepLogs: { findMany: async () => [] },
    },
  };
  // tx.execute(sql) above already returns a promise; drizzle's real tx also
  // thenables for `await tx.update(...)`, which the chain satisfies.
  return tx;
}

vi.mock('@/drizzle/db', () => {
  const db: Record<string, unknown> = {
    ...txMock(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock()),
  };
  return { db };
});

vi.mock('@/lib/cache', () => ({
  acquireLock: async () => ({ acquired: true, value: 'lock-token' }),
  releaseLock: async () => undefined,
}));

// The per-tenant RLS plumbing is owned by lib/cron/tenant-scope's own suite;
// here it is reduced to "run the body once for this tenant".
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_label: string, body: (tenantId: string) => Promise<void>) => {
    await body(TENANT_ID);
    return { visited: 1, skipped: [], failed: [] };
  },
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn(async () => true) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: email.sendEmail }));
vi.mock('@/lib/email/tracking', () => ({
  createEmailTracking: vi.fn(async () => null),
  addTracking: (html: string) => html,
}));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => { throw new Error(`route reached apiError: ${String(err)}`); },
}));

const ENROLLMENT_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenant_id: TENANT_ID,
  sequence_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  contact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  current_step: 1,
  next_step_at: new Date(),
  status: 'active',
};

const EMAIL_STEP = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  sequenceId: ENROLLMENT_ROW.sequence_id,
  tenantId: TENANT_ID,
  stepNumber: 1,
  stepType: 'email',
  subject: 'Hello',
  body: 'Body',
  content: null,
  isActive: true,
  deletedAt: null,
};

function cronReq(secret = CRON_SECRET) {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === 'x-cron-secret' ? secret : null) },
  } as unknown as NextRequest;
}

async function runRoute() {
  process.env.CRON_SECRET = CRON_SECRET;
  // buildSequenceEmailPayload signs an unsubscribe link; without a secret it
  // throws inside the claim tx and the run would look like a no-op.
  process.env.UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test';
  const { POST } = await import('@/app/api/cron/process-sequences/route');
  return POST(cronReq());
}

beforeEach(() => {
  vi.clearAllMocks();
  h.executes = [];
  h.executeResults = [];
  h.updates = [];
  h.inserts = [];
  h.stepWheres = [];
  h.steps = [];
});

// ── The sweep and the claim re-check must carry the same lifecycle filter ─────

describe('due-enrollment sweep SQL (#2392)', () => {
  it('excludes tombstoned enrollments and dead sequences', async () => {
    h.executeResults = [[]];
    await runRoute();
    const sweep = sqlOf(h.executes[0]);
    expect(sweep).toMatch(/e\.deleted_at IS NULL/i);
    expect(sweep).toMatch(/JOIN sequences s/i);
    expect(sweep).toMatch(/s\.deleted_at IS NULL/i);
    expect(sweep, 'deny-by-default: only a live active sequence may drip').toMatch(/s\.status = 'active'/i);
    // The tenant is a bound parameter, never interpolated into the text.
    expect(render(h.executes[0]).params).toContain(TENANT_ID);
    expect(sweep).toMatch(/e\.tenant_id = \$\d+::uuid/i);
  });

  it('locks only the enrollment row, so the sequences join cannot deadlock the sweep', async () => {
    h.executeResults = [[]];
    await runRoute();
    expect(sqlOf(h.executes[0])).toMatch(/FOR UPDATE OF e SKIP LOCKED/i);
  });

  it('the claim re-check mirrors the sweep (the archive can land between them)', async () => {
    h.executeResults = [[ENROLLMENT_ROW], []]; // sweep finds it; contact fetch empty
    await runRoute();
    const claim = sqlOf(h.executes[2]);
    expect(claim).toMatch(/e\.deleted_at IS NULL/i);
    expect(claim).toMatch(/s\.deleted_at IS NULL/i);
    expect(claim).toMatch(/s\.status = 'active'/i);
    expect(claim).toMatch(/FOR UPDATE OF e SKIP LOCKED/i);
  });
});

// ── Contacts and steps ────────────────────────────────────────────────────────

describe('contact + step lookups (#2392)', () => {
  it('hides tombstoned contacts from the batch fetch', async () => {
    h.executeResults = [[ENROLLMENT_ROW], []];
    await runRoute();
    const contacts = sqlOf(h.executes[1]);
    expect(contacts).toMatch(/deleted_at IS NULL/i);
    expect(contacts).toMatch(/FROM contacts/i);
    expect(contacts).toContain('do_not_contact');
  });

  it('excludes inactive AND deleted steps', async () => {
    h.executeResults = [[ENROLLMENT_ROW], [{ id: ENROLLMENT_ROW.contact_id, email: 'x@y.z', do_not_contact: false }]];
    h.steps = [EMAIL_STEP];
    h.executeResults.push([ENROLLMENT_ROW]); // claim re-check
    await runRoute();
    expect(h.stepWheres).toHaveLength(1);
    const rendered = render(h.stepWheres[0]);
    expect(rendered.sql).toMatch(/"sequence_steps"."is_active"/i);
    expect(rendered.params, 'eq(isActive, true) binds the literal true').toContain(true);
    expect(rendered.sql, 'a tombstoned step must not execute').toMatch(/"deleted_at" IS NULL/i);
  });
});

// ── Inertness, by counting dispatches ─────────────────────────────────────────

describe('email dispatch (#2392)', () => {
  it('sends for the live control — otherwise "inert" below would be meaningless', async () => {
    h.executeResults = [
      [ENROLLMENT_ROW], // sweep
      [{ id: ENROLLMENT_ROW.contact_id, email: 'x@y.z', do_not_contact: false }], // contact
      [ENROLLMENT_ROW], // claim re-check
      [{ next_date: new Date(Date.now() + 86400000).toISOString() }], // advance
    ];
    h.steps = [EMAIL_STEP];
    const res = await runRoute();
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing when the sweep returns no rows (dead sequence / tombstoned enrollment)', async () => {
    h.executeResults = [[]];
    const res = await runRoute();
    expect(res.status).toBe(200);
    expect(email.sendEmail).not.toHaveBeenCalled();
    // Only the sweep ran — no contact fetch, no claim, no writes.
    expect(h.executes).toHaveLength(1);
    expect(h.updates).toHaveLength(0);
  });

  it('a deleted contact CANCELS the email enrollment instead of marking the step executed', async () => {
    h.executeResults = [
      [ENROLLMENT_ROW], // sweep
      [], // contact fetch finds nothing: deleted_at IS NULL excluded it
      [ENROLLMENT_ROW], // claim re-check
    ];
    h.steps = [EMAIL_STEP];
    const res = await runRoute();
    expect(res.status).toBe(200);
    expect(email.sendEmail).not.toHaveBeenCalled();

    const enrollmentWrite = h.updates.find(u => String(u.table).includes('sequenceEnrollments')
      || sqlOf(u.where ?? '1=1').includes('status'));
    expect(enrollmentWrite, 'expected an enrollment UPDATE').toBeTruthy();
    expect(enrollmentWrite!.payload.status, 'cancel, never completed/sent').toBe('cancelled');
    const stepLogWrite = h.updates.find(u => u !== enrollmentWrite);
    expect(stepLogWrite!.payload.status).toBe('cancelled');
  });

  it('a task step for a missing contact still is not sent as email', async () => {
    h.executeResults = [[ENROLLMENT_ROW], [], [ENROLLMENT_ROW]];
    h.steps = [{ ...EMAIL_STEP, stepType: 'task', subject: 'Call', body: null, content: null }];
    await runRoute();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('binds the sweep to the tenant it was given, and no other', async () => {
    h.executeResults = [[]];
    await runRoute();
    const { sql, params } = render(h.executes[0]);
    expect(sql).toMatch(/e\.tenant_id = \$\d+::uuid/i);
    expect(params).toEqual([TENANT_ID, 100]);
    expect(params).not.toContain(OTHER_TENANT_ID);
  });
});
