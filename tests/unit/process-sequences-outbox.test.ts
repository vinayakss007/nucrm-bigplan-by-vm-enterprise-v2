/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2223 — process-sequences cron must never run SMTP inside a DB transaction.
 *
 * The cron now follows a claim → commit → send → confirm outbox flow:
 *  1. the claim tx flips the step log 'pending' → 'sending' and returns the
 *     built message; NOTHING may touch the mail transport before that tx
 *     commits (otherwise a rollback re-arms the step while the mail is gone);
 *  2. after commit, sendEmail runs outside any transaction;
 *  3. a second short tx confirms 'sent' or reverts to 'pending'.
 *
 * If the process dies between claim-commit and confirm, the log stays
 * 'sending' and the NEXT run finalizes it as sent WITHOUT resending.
 *
 * These tests prove:
 *  - ordering: createEmailTracking/sendEmail fire only after the claim tx
 *    has committed (event log with a deliberately slow transport);
 *  - no double-send: a stale 'sending' log is recovered as 'sent' and the
 *    transport is never called;
 *  - a rejected send reverts the claim to 'pending' for retry (still after
 *    commit, still one transport call).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ── ordered event log ──────────────────────────────────────────────────────
// db.transaction pushes tx:start / tx:commit around the callback body; the
// mail mocks push their own events. If any mail work ran INSIDE a tx it would
// appear between its tx:start and tx:commit and break the expectations below.
const events: string[] = [];
const dbWrites: { table: string; patch: Record<string, unknown> }[] = [];

type Scenario = {
  dueRows: unknown[];
  existingLog: unknown | null;
  claimReturning: unknown[];
  nextDate: string | null;
  sendFails: boolean;
};
const scenario: Scenario = {
  dueRows: [],
  existingLog: null,
  claimReturning: [],
  nextDate: null,
  sendFails: false,
};

const ENROLLMENT_ROW = {
  id: 'e1',
  tenant_id: TENANT_A,
  sequence_id: 'seq-1',
  contact_id: 'c-1',
  current_step: 1,
  next_step_at: new Date('2026-10-01T00:00:00Z'),
  status: 'active',
};
const CONTACT_ROW = { id: 'c-1', email: 'user@example.com', do_not_contact: false };
const EMAIL_STEP = {
  id: 's-1',
  tenantId: TENANT_A,
  sequenceId: 'seq-1',
  stepNumber: 1,
  stepType: 'email',
  isActive: true,
  subject: 'Checking in',
  body: 'Hello there',
  content: 'Hello there',
};

function sqlText(q: unknown): string {
  const s = q as { text?: string; sql?: string };
  return s?.text ?? s?.sql ?? '';
}

// ── module mocks ───────────────────────────────────────────────────────────
vi.mock('@/lib/crypto', () => ({ verifySecret: vi.fn(() => true) }));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => {
    void err;
    return Response.json({ error: 'fatal' }, { status: 500 });
  },
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/cache', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, value: 'lock-1' })),
  releaseLock: vi.fn(async () => {}),
}));
vi.mock('@/lib/cron/tenant-scope', () => ({
  sweepTenants: async (_ctx: string, body: (t: string) => Promise<void>) => {
    await body(TENANT_A);
    return { visited: 1, skipped: [], failed: [] };
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args.filter(Boolean),
  eq: (a: unknown, b: unknown) => ({ a, b }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('?'), values }),
    { join: (parts: unknown[], sep: unknown) => ({ text: 'joined', parts, sep }) },
  ),
}));
vi.mock('@/drizzle/schema', () => {
  const cols = (t: string) => ({
    id: `${t}.id`, tenantId: `${t}.tenant_id`, sequenceId: `${t}.sequence_id`,
    stepNumber: `${t}.step_number`, isActive: `${t}.is_active`,
    enrollmentId: `${t}.enrollment_id`, stepId: `${t}.step_id`, status: `${t}.status`,
  });
  return {
    sequenceEnrollments: cols('sequence_enrollments'),
    sequenceSteps: cols('sequence_steps'),
    sequenceStepLogs: cols('sequence_step_logs'),
    tasks: cols('tasks'),
  };
});
vi.mock('@/lib/sanitize', () => ({ sanitizeHTMLServer: (s: string) => s }));
vi.mock('@/lib/email/unsubscribe-token', () => ({ generateUnsubscribeToken: () => 'unsub-tok' }));
vi.mock('@/lib/email/tracking', () => ({
  createEmailTracking: vi.fn(async () => { events.push('tracking'); return 'track-1'; }),
  addTracking: (html: string) => html,
}));
vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async () => {
    // Slow transport: with the old in-tx code this await would keep the
    // claim tx open. Here it must run strictly after tx:commit.
    await new Promise((r) => setTimeout(r, 10));
    events.push('sendEmail');
    if (scenario.sendFails) throw new Error('SMTP 550 relay refused');
    return { messageId: 'msg-1' };
  }),
}));

// ── db mock: transaction + inert thenable query chains ─────────────────────
function makeUpdateChain(table: string) {
  const chain: Record<string, unknown> = {
    set: (patch: Record<string, unknown>) => {
      dbWrites.push({ table, patch: { ...patch } });
      return chain;
    },
    where: () => chain,
    returning: () => Promise.resolve(table === 'sequence_step_logs' ? scenario.claimReturning : []),
    catch: (f: (e: unknown) => unknown) => Promise.resolve([]).catch(f),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve([]).then(res, rej),
  };
  return chain;
}

function makeTx() {
  return {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes('SKIP LOCKED')) return { rows: scenario.dueRows };
      if (text.includes('FROM contacts')) return { rows: [CONTACT_ROW] };
      if (text.includes('calculate_sequence_step_date'))
        return { rows: [{ next_date: scenario.nextDate }] };
      if (text.includes('SELECT id, status, current_step'))
        return { rows: [ENROLLMENT_ROW] };
      return { rows: [] };
    },
    update: (table: { id?: unknown }) => makeUpdateChain(String(table?.id ?? 'unknown').split('.')[0]),
    insert: (table: { id?: unknown }) => ({
      values: async (v: Record<string, unknown>) => {
        dbWrites.push({ table: String(table?.id ?? 'unknown').split('.')[0], patch: v });
        return [];
      },
    }),
    query: {
      sequenceSteps: {
        findMany: async () => (scenario.dueRows.length ? [EMAIL_STEP] : []),
        findFirst: async () => (scenario.nextDate ? { ...EMAIL_STEP, stepNumber: 2, id: 's-2' } : null),
      },
      sequenceStepLogs: {
        findMany: async () => (scenario.existingLog ? [scenario.existingLog] : []),
      },
    },
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      const tx = makeTx();
      events.push('tx:start');
      const result = await fn(tx);
      events.push('tx:commit');
      return result;
    }),
    update: (table: { id?: unknown }) => makeUpdateChain(String(table?.id ?? 'unknown').split('.')[0]),
  },
}));

function cronRequest() {
  return new Request('http://localhost/api/cron/process-sequences', {
    method: 'POST',
    headers: { 'x-cron-secret': 's3cret' },
  }) as unknown as NextRequest;
}

describe('cron/process-sequences outbox (#2223)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    dbWrites.length = 0;
    scenario.dueRows = [ENROLLMENT_ROW];
    scenario.existingLog = null;
    scenario.claimReturning = [{ id: 'log-1' }];
    scenario.nextDate = null; // no further steps → enrollment completes
    scenario.sendFails = false;
    process.env.CRON_SECRET = 's3cret';
  });

  it('never calls the mail transport before the claim transaction commits', async () => {
    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, processed: 1 });

    // Exact ordering: phase-1 collection tx, claim tx, and ONLY THEN the
    // tracking row + SMTP send, then the short confirm tx.
    expect(events).toEqual([
      'tx:start', 'tx:commit', // phase 1: collect due enrollments
      'tx:start', 'tx:commit', // phase 2: claim 'pending' → 'sending', committed
      'tracking', 'sendEmail', // phase 3: transport runs OUTSIDE any transaction
      'tx:start', 'tx:commit', // phase 4: confirm 'sending' → 'sent' + advance
    ]);

    // The claim must be the durable 'sending' flip, not a post-send write.
    const claimWrite = dbWrites.find((w) => w.table === 'sequence_step_logs' && w.patch.status === 'sending');
    expect(claimWrite).toBeDefined();
  });

  it('finalizes a stale "sending" log as sent WITHOUT resending', async () => {
    // Previous run committed the claim but died before confirming.
    scenario.claimReturning = []; // UPDATE ... WHERE status='pending' matched nothing
    scenario.existingLog = { id: 'log-1', enrollmentId: 'e1', stepId: 's-1', tenantId: TENANT_A, status: 'sending' };

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, processed: 1 });

    // The entire proof: no tracking row, no SMTP call — at-most-once delivery.
    expect(events.filter((e) => e === 'sendEmail')).toHaveLength(0);
    expect(events.filter((e) => e === 'tracking')).toHaveLength(0);
    // …and the stuck log was flipped 'sending' → 'sent'.
    expect(dbWrites.some((w) => w.table === 'sequence_step_logs' && w.patch.status === 'sent')).toBe(true);
  });

  it('a transport rejection reverts the claim to pending — after commit, one call only', async () => {
    scenario.sendFails = true;
    scenario.claimReturning = [{ id: 'log-1' }];

    const { POST } = await import('@/app/api/cron/process-sequences/route');
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, processed: 0 });

    // Send attempted once, strictly after the claim tx committed.
    expect(events.filter((e) => e === 'sendEmail')).toHaveLength(1);
    expect(events.indexOf('sendEmail')).toBeGreaterThan(3);
    // Confirm tx reverted the claim so the retry cannot double-send:
    // the step was NOT delivered, so going back to 'pending' is safe.
    expect(dbWrites.some((w) => w.table === 'sequence_step_logs' && w.patch.status === 'sending')).toBe(true);
    expect(dbWrites.some((w) => w.table === 'sequence_step_logs' && w.patch.status === 'pending')).toBe(true);
    expect(dbWrites.some((w) => w.table === 'sequence_step_logs' && w.patch.status === 'sent')).toBe(false);
  });
});
