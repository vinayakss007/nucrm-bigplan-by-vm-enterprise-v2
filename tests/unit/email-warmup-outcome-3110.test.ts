/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tests for processWarmUp() — issue #3110.
 *
 * `lib/email/warmup.ts` awaited `sendEmail(...)` and threw the result away, then
 * unconditionally wrote `status: 'sent'`, bumped the pool's `sentCount` and the
 * config's `totalSent`, and stamped `lastSentAt`. `sendEmail`
 * (`lib/email/service.ts:249`) reports a provider rejection as
 * `{ success: false, error }` and does NOT throw — that is the #2422/#3045
 * contract — so the surrounding try/catch could never see it, and every
 * bounced, rate-limited or invalid-address warm-up send was recorded as
 * delivered.
 *
 * Three consequences, all asserted here against the captured write patches
 * (no database — the dev DB has zero rows and would answer nothing):
 *
 *  - the participant is locked out for the rest of the day, because
 *    `lastSentAt` is exactly what the pool query gates on;
 *  - the daily budget is burned by mail that never left, because `sentToday`
 *    counts `status = 'sent'` rows;
 *  - the 5% bounce-rate safety pause can never trip on a provider that is
 *    rejecting sends, because `bouncesLast7Days` counts `status = 'failed'`
 *    rows and the engine refused to write one.
 *
 * The cron twin that already got this right is
 * `app/api/cron/process-sequences/route.ts:343` (`if (!sent.success)`, #2422).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
type SendResult = { success: boolean; error?: string; messageId?: string };

const CONFIG_ID = 'c1111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => {
  const tables = {
    configs: { __table: 'email_warmup_configs' },
    pool: { __table: 'email_warmup_pool' },
    logs: { __table: 'email_warmup_logs' },
    tenants: { __table: 'tenants' },
  };

  const state = {
    configs: [] as Row[],
    participants: [] as Row[],
    insertedLogs: [] as Row[],
    // Every update the engine issues, tagged with the table object it targets.
    updates: [] as { table: unknown; set: Row }[],
    sendResults: [] as SendResult[],
    sendCalls: [] as Row[],
  };

  const record = (table: unknown) => ({
    set: (values: Row) => ({
      where: async () => {
        state.updates.push({ table, set: values });
        return undefined;
      },
    }),
  });

  const tx = { update: vi.fn(record)};

  const db = {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => state.configs,
        }),
      }),
    })),
    query: {
      emailWarmupPool: {
        findMany: vi.fn(async () => state.participants),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: (row: Row) => {
        state.insertedLogs.push({ ...row, __table: table });
        return {
          returning: async () => [{ id: `log-${state.insertedLogs.length}` }],
        };
      },
    })),
    update: vi.fn(record),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const sendEmail = vi.fn(async (payload: Row) => {
    state.sendCalls.push(payload);
    const next = state.sendResults.shift();
    return next ?? { success: true, messageId: 'msg-ok' };
  });

  return { db, tx, state, tables, sendEmail };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  emailWarmupConfigs: m.tables.configs,
  emailWarmupPool: m.tables.pool,
  emailWarmupLogs: m.tables.logs,
  tenants: m.tables.tenants,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...p: unknown[]) => ({ and: p })),
  or: vi.fn((...p: unknown[]) => ({ or: p })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
  asc: vi.fn((a: unknown) => ({ asc: a })),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
}));
vi.mock('@/lib/email/service', () => ({ sendEmail: m.sendEmail }));

import { processWarmUp } from '@/lib/email/warmup';

function config(overrides: Row = {}): Row {
  return {
    id: CONFIG_ID,
    tenantId: 't-1',
    isActive: true,
    fromName: 'Team',
    dailyLimitCurrent: 5,
    dailyLimitStart: 5,
    dailyLimitMax: 50,
    rampUpDays: 21,
    startedAt: new Date(),
    ...overrides,
  };
}

function participant(n: number): Row {
  return {
    id: `pool-${n}`,
    configId: CONFIG_ID,
    participantEmail: `warm${n}@example.test`,
    participantName: `Warm ${n}`,
    status: 'active',
    lastSentAt: null,
    sentCount: 0,
  };
}

const updatesFor = (table: unknown) => m.state.updates.filter(u => u.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  m.state.configs = [
    // The route selects `{ config: emailWarmupConfigs, sentToday, … }`, so the
    // config columns arrive nested under `config`, not spread at the top level.
    { config: config(), sentToday: 0, bouncesLast7Days: 0, sendsLast7Days: 0 },
  ];
  m.state.participants = [participant(1)];
  m.state.insertedLogs = [];
  m.state.updates = [];
  m.state.sendResults = [];
  m.state.sendCalls = [];
});

describe('processWarmUp — a provider rejection is not a delivery (#3110)', () => {
  it('records the log as failed with the provider reason instead of sent', async () => {
    m.state.sendResults = [{ success: false, error: '429 too many requests' }];
    await processWarmUp();

    const logWrites = updatesFor(m.tables.logs);
    expect(logWrites).toHaveLength(1);
    expect(logWrites[0]?.set.status).toBe('failed');
    expect(String(logWrites[0]?.set.errorMessage)).toContain('429');
  });

  it('does not stamp lastSentAt, so the participant stays eligible for the next tick', async () => {
    m.state.sendResults = [{ success: false, error: 'invalid recipient address' }];
    await processWarmUp();
    // The pool row is only ever written by the success path, and it is that
    // write that burns the participant's slot for the rest of the day.
    expect(updatesFor(m.tables.pool)).toHaveLength(0);
  });

  it('does not count a rejected send against the config totals', async () => {
    m.state.sendResults = [{ success: false, error: '550 relay refused' }];
    const res = await processWarmUp();
    expect(updatesFor(m.tables.configs)).toHaveLength(0);
    expect(res.emailsSent).toBe(0);
  });

  it('surfaces the rejection in the cron result so it is not silently clean', async () => {
    m.state.sendResults = [{ success: false, error: '429 too many requests' }];
    const res = await processWarmUp();
    expect(res.errors.some(e => e.includes('warm1@example.test') && e.includes('429'))).toBe(true);
  });

  it('keeps the send count honest while the loop carries on to the next participant', async () => {
    m.state.participants = [participant(1), participant(2)];
    m.state.sendResults = [
      { success: false, error: '429 too many requests' },
      { success: true, messageId: 'msg-2' },
    ];
    const res = await processWarmUp();
    expect(m.sendEmail).toHaveBeenCalledTimes(2);
    expect(res.emailsSent).toBe(1);
    expect(updatesFor(m.tables.logs).map(u => u.set.status)).toEqual(['failed', 'sent']);
  });
});

describe('processWarmUp — a delivered send still books the schedule (#3110)', () => {
  it('writes sent, advances the pool slot and increments the config total', async () => {
    m.state.sendResults = [{ success: true, messageId: 'msg-1' }];
    const res = await processWarmUp();

    expect(res.emailsSent).toBe(1);
    const logWrite = updatesFor(m.tables.logs)[0];
    expect(logWrite?.set.status).toBe('sent');
    expect(logWrite?.set.sentAt).toBeInstanceOf(Date);

    const poolWrite = updatesFor(m.tables.pool)[0];
    expect(poolWrite?.set.lastSentAt).toBeInstanceOf(Date);
    expect(poolWrite?.set.sentCount).toBeTruthy();

    const configWrite = updatesFor(m.tables.configs)[0];
    expect(configWrite?.set.totalSent).toBeTruthy();
    expect(configWrite?.set.lastWarmupAt).toBeInstanceOf(Date);
  });

  it('inserts the pending log before sending, so a rejected send has a row to mark', async () => {
    m.state.sendResults = [{ success: false, error: '429 too many requests' }];
    await processWarmUp();
    expect(m.state.insertedLogs).toHaveLength(1);
    expect(m.state.insertedLogs[0]?.status).toBe('pending');
    expect(m.state.insertedLogs[0]?.__table).toBe(m.tables.logs);
    // One write total: the log's status. No slot, no counter, no schedule stamp.
    expect(m.state.updates).toHaveLength(1);
  });
});
