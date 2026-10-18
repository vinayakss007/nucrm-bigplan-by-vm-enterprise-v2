/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2795 — the cron's claim transaction opened with `let success = true`
 * (`app/api/cron/process-sequences/route.ts:238`) and only ever *lowered* it, so
 * every step type it does not implement inherited "it worked": `finalizeStepLog`
 * writes `status: success ? 'sent' : 'failed'` with an `executedAt`
 * (`lib/cron/sequence-steps.ts:336-339`).
 *
 * `delay` is that fall-through's everyday case — the sequence builder mints one
 * per click (`components/tenant/sequence-builder.tsx:122`) and
 * `scripts/seed-dev.ts:841,845` puts two in every dev tenant's sequences — so
 * `sequence_step_logs` fills with sends that never happened, while the `skipped`
 * status the do-not-contact branch carefully records (`route.ts:241-256`) went
 * unused. An `email` step for a contact with no address took the same
 * fall-through: `shouldSendEmail` (`:165-167`) requires `contact?.email` and
 * nothing downstream said so. `whatsapp` is allowed by the step-type CHECK
 * (`drizzle/migrations/0050_data_validation_checks.sql:121-122`) with no branch
 * at all.
 *
 * The fix states an outcome per type instead of defaulting to success: `delay`
 * and an undeliverable `email` log `skipped` (and still advance — the wait was
 * already applied when the step was scheduled, `advanceOrCompleteStep`), a `task`
 * that inserted its follow-up still logs `sent`, and a type with no handler logs
 * `failed` naming the type rather than reporting a send.
 *
 * Driven through the real route with the db / lock / mail seams mocked — the same
 * harness `tests/unit/sequence-lifecycle-cron-2392.test.ts` uses — so each
 * assertion lands on the `status` value that would reach the table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SendResult } from '@/lib/email/service';
import { PgDialect } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { tasks as tasksTable } from '@/drizzle/schema';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CRON_SECRET = 'test-cron-secret';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEQUENCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENROLLMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STEP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const dialect = new PgDialect();
const renderSql = (node: unknown) => dialect.sqlToQuery(node as never).sql;

const ENROLLMENT_ROW = {
  id: ENROLLMENT_ID,
  tenant_id: TENANT_ID,
  sequence_id: SEQUENCE_ID,
  contact_id: CONTACT_ID,
  current_step: 1,
  next_step_at: new Date(),
  status: 'active',
};

const h = vi.hoisted(() => ({
  contactRows: [] as Array<Record<string, unknown>>,
  nextStep: null as Record<string, unknown> | null,
  steps: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ payload: Record<string, unknown> }>,
  inserts: [] as Array<{ table: unknown; payload: unknown }>,
}));

function txMock() {
  const tx: Record<string, unknown> = {
    // Statements are recognised by their select list rather than by call order,
    // so an extra plumbing execute cannot shift the canned rows off their query.
    // The due sweep and the claim re-check lock the same way, which is why the
    // claim is told apart by the columns it projects.
    execute: (node: unknown) => {
      const text = renderSql(node);
      if (text.includes('SELECT e.id, e.status, e.current_step')) {
        return Promise.resolve({ rows: [{ id: ENROLLMENT_ID, status: 'active', current_step: 1 }] });
      }
      if (text.includes('FROM contacts')) {
        return Promise.resolve({ rows: h.contactRows });
      }
      return Promise.resolve({ rows: [ENROLLMENT_ROW] });
    },
    update: (_table: unknown) => {
      const rec = { payload: {} as Record<string, unknown> };
      h.updates.push(rec);
      const chain: Record<string, unknown> = {
        set: (p: Record<string, unknown>) => { Object.assign(rec.payload, p); return chain; },
        where: () => chain,
        returning: async () => [{ id: randomUUID() }],
        // Real drizzle statements are thenables, so the route's best-effort
        // `.catch(...)` on a write has to be satisfied here too.
        catch: () => Promise.resolve(),
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
        findMany: () => Promise.resolve(h.steps),
        findFirst: () => Promise.resolve(h.nextStep),
      },
      sequenceStepLogs: { findMany: async () => [] },
    },
  };
  return tx;
}

vi.mock('@/drizzle/db', () => ({
  db: {
    ...txMock(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock()),
  },
}));
vi.mock('@/lib/cache', () => ({
  acquireLock: async () => ({ acquired: true, value: 'lock-token' }),
  releaseLock: async () => undefined,
}));
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_label: string, body: (tenantId: string) => Promise<void>) => {
    await body(TENANT_ID);
    return { visited: 1, skipped: [], failed: [] };
  },
}));
const SEND_OK: SendResult = { success: true, provider: 'smtp', messageId: 'msg-control-1' };
const email = vi.hoisted(() => ({ sendEmail: vi.fn(async (): Promise<SendResult> => SEND_OK) }));
vi.mock('@/lib/email/service', () => ({ sendEmail: email.sendEmail }));
const tracking = vi.hoisted(() => ({
  createEmailTracking: vi.fn(async () => null as string | null),
  recordEmailMessageId: vi.fn(async () => undefined),
}));
vi.mock('@/lib/email/tracking', () => ({ ...tracking, addTracking: (html: string) => html }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => { throw new Error(`route reached apiError: ${String(err)}`); },
}));

/** The step-log writes carry a `status` and an `executedAt`; the enrollment
 *  writes carry `currentStep` / `completedAt` instead. */
function stepLogs() {
  return h.updates
    .filter((u) => 'status' in u.payload && 'executedAt' in u.payload)
    .map((u) => u.payload as { status: string; errorMessage: string | null });
}

/** Run one due enrollment whose current step is `stepType`, against a contact
 *  carrying `email` / `do_not_contact` as given. */
async function runStep(
  stepType: string,
  contact: { email: string | null; do_not_contact: boolean } = { email: 'dana@example.test', do_not_contact: false },
) {
  h.contactRows = [{ id: CONTACT_ID, ...contact }];
  h.steps = [{
    id: STEP_ID,
    sequenceId: SEQUENCE_ID,
    tenantId: TENANT_ID,
    stepNumber: 1,
    stepType,
    subject: 'Hello',
    body: 'Body',
    content: null,
    isActive: true,
    deletedAt: null,
  }];
  // A step 2 exists behind this one, so the run takes the advance path rather
  // than the completion path.
  h.nextStep = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', delayDays: 1, delayHours: 0, delayMinutes: 0 };

  process.env.CRON_SECRET = CRON_SECRET;
  // buildSequenceEmailPayload signs an unsubscribe link; without a secret it
  // throws inside the claim tx and the run would look like a no-op.
  process.env.UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test';
  const { POST } = await import('@/app/api/cron/process-sequences/route');
  await POST({
    headers: { get: (n: string) => (n.toLowerCase() === 'x-cron-secret' ? CRON_SECRET : null) },
  } as unknown as NextRequest);

  return stepLogs();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.contactRows = [];
  h.steps = [];
  h.nextStep = null;
  h.updates = [];
  h.inserts = [];
});

describe('#2795 — a step the cron does not run is not logged as sent', () => {
  it('logs a delay step as skipped, not as a send', async () => {
    const logs = await runStep('delay');
    expect(logs.map((l) => l.status)).not.toContain('sent');
    expect(logs.map((l) => l.status)).toContain('skipped');
  });

  it('logs an email step with no address on the contact as skipped, not sent', async () => {
    const logs = await runStep('email', { email: null, do_not_contact: false });
    expect(logs.map((l) => l.status)).not.toContain('sent');
    expect(logs.map((l) => l.status)).toContain('skipped');
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('logs a step type with no handler as failed, naming the type', async () => {
    const logs = await runStep('whatsapp');
    expect(logs.map((l) => l.status)).not.toContain('sent');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('failed');
    expect(String(logs[0]!.errorMessage)).toContain('whatsapp');
  });

  it('control — a task step really did run, so it still logs sent', async () => {
    const logs = await runStep('task');
    expect(logs.map((l) => l.status)).toContain('sent');
    const titles = h.inserts
      .filter((i) => i.table === tasksTable)
      .map((i) => (i.payload as { title: string }).title);
    expect(titles).toEqual(['Hello']);
  });

  it('control — an addressable email step still dispatches', async () => {
    await runStep('email');
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a skipped delay still advances the enrollment, so the drip does not stall', async () => {
    await runStep('delay');
    const advanced = h.updates.filter((u) => 'currentStep' in u.payload);
    expect(advanced.map((u) => u.payload.currentStep)).toEqual([2]);
  });
});
