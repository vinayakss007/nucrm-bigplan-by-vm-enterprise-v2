/**
 * #3110 — `processWarmUp()` awaited `sendEmail(...)` and threw the result away,
 * then unconditionally wrote `email_warmup_logs.status='sent'`, bumped the pool's
 * `sentCount` and stamped `lastSentAt`. `sendEmail` (lib/email/service.ts:249)
 * RESOLVES `{ success:false }` on a provider 4xx/5xx instead of throwing
 * (#2422/#3045), so the enclosing catch never saw a rejected send: every bounce,
 * 429 and invalid address was recorded as delivered, burned the participant's
 * slot for the day (`lastSentAt` gates the next attempt), and was never retried.
 *
 * The twins that already check the result are `process-sequences/route.ts:343`
 * and `scheduled-report-delivery/route.ts:285`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  txWrites: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  participants: [] as Array<Record<string, unknown>>,
  sendResult: { success: true } as { success: boolean; error?: string },
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
      update: (table: { __name?: string }) => ({
        set: (patch: Record<string, unknown>) => {
          h.txWrites.push({ table: table.__name ?? 'unknown', patch });
          return { where: vi.fn(async () => undefined) };
        },
      }),
    })),
    query: {
      emailWarmupPool: { findMany: vi.fn() },
      emailWarmupLogs: { findFirst: vi.fn() },
      emailWarmupConfigs: { findFirst: vi.fn() },
    },
  },
}));

// Identifiable stand-ins: the assertions below are about WHICH table each
// in-transaction UPDATE targeted, so the mocked schema objects carry a name.
vi.mock('@/drizzle/schema', () => ({
  emailWarmupConfigs: { __name: 'emailWarmupConfigs', id: 'id', tenantId: 'tenant_id' },
  emailWarmupPool: { __name: 'emailWarmupPool', id: 'id', configId: 'config_id', lastSentAt: 'last_sent_at', sentCount: 'sent_count' },
  emailWarmupLogs: { __name: 'emailWarmupLogs', id: 'id', configId: 'config_id', participantId: 'participant_id' },
  tenants: { __name: 'tenants', id: 'id', status: 'status' },
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(async () => h.sendResult),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })),
}));

const CONFIG = {
  id: 'cfg-1',
  tenantId: 'tenant-1',
  dailyLimitCurrent: 10,
  dailyLimitStart: 5,
  dailyLimitMax: 50,
  rampUpDays: 21,
  startedAt: new Date(),
  fromName: 'Warmup Bot',
  isActive: true,
  totalSent: 100,
  lastWarmupAt: new Date(),
};

async function runWith(participant: Record<string, unknown>) {
  const { db } = await import('@/drizzle/db');
  (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(async () => [{ config: CONFIG, sentToday: 0, bouncesLast7Days: 0, sendsLast7Days: 100 }]),
      })),
    })),
  });
  (db.query.emailWarmupPool.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([participant]);
  (db.insert as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    values: vi.fn(() => ({
      returning: vi.fn(() => [{ id: 'log-1', configId: CONFIG.id, participantId: participant.id, status: 'pending' }]),
    })),
  });

  const { processWarmUp } = await import('@/lib/email/warmup');
  return processWarmUp();
}

const PARTICIPANT = {
  id: 'p-1',
  participantEmail: 'warmup-in@example.test',
  participantName: 'Warming Up',
  configId: 'cfg-1',
  lastSentAt: null,
  status: 'active',
  sentCount: 0,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.txWrites = [];
  h.sendResult = { success: true };
});

describe('#3110 processWarmUp reads the provider result before it books the send', () => {
  it('books a provider-rejected send as failed and touches no counter', async () => {
    h.sendResult = { success: false, error: '429 too many requests' };

    const result = await runWith(PARTICIPANT);

    expect(result.emailsSent).toBe(0);
    expect(result.errors[0]).toContain('warmup-in@example.test');
    expect(result.errors[0]).toContain('429 too many requests');

    const logWrite = h.txWrites.find((w) => w.table === 'emailWarmupLogs');
    expect(logWrite, 'the rejected send must land as failed, not sent').toMatchObject({
      patch: { status: 'failed', errorMessage: '429 too many requests' },
    });
    // The participant keeps its retry slot: nothing may re-stamp lastSentAt or
    // increment sentCount, and the config total must stay where it was.
    expect(h.txWrites.some((w) => w.table === 'emailWarmupPool')).toBe(false);
    expect(h.txWrites.filter((w) => w.table === 'emailWarmupConfigs')).toHaveLength(0);
    expect(h.txWrites).toHaveLength(1);
  });

  it('still books an accepted send as sent with the counters bumped', async () => {
    h.sendResult = { success: true, provider: 'resend', messageId: 'msg-1' };

    const result = await runWith(PARTICIPANT);

    expect(result.emailsSent).toBe(1);
    expect(result.errors).toHaveLength(0);

    const tables = h.txWrites.map((w) => w.table);
    expect(tables).toEqual(['emailWarmupLogs', 'emailWarmupPool', 'emailWarmupConfigs']);
    expect(h.txWrites[0]!.patch.status).toBe('sent');
    expect(h.txWrites[1]!.patch.lastSentAt).toBeInstanceOf(Date);
  });

  it('names the failure even when the provider sends no message', async () => {
    h.sendResult = { success: false };

    const result = await runWith(PARTICIPANT);

    expect(result.emailsSent).toBe(0);
    expect(h.txWrites.find((w) => w.table === 'emailWarmupLogs')!.patch.errorMessage)
      .toBe('provider rejected the send');
  });
});
