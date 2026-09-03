import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
    })),
    query: {
      emailWarmupPool: {
        findMany: vi.fn(),
      },
      emailWarmupLogs: {
        findFirst: vi.fn(),
      },
      emailWarmupConfigs: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@/drizzle/schema', () => ({
  emailWarmupConfigs: {},
  emailWarmupPool: {},
  emailWarmupLogs: {},
  tenants: {},
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => args),
  and: vi.fn((...args) => args),
  lt: vi.fn((...args) => args),
  asc: vi.fn((...args) => args),
  or: vi.fn((...args) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })),
}));

describe('Email Warmup Engine', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('processWarmUp', () => {
    it('returns zero counts when no configs exist', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const { processWarmUp } = await import('@/lib/email/warmup');
      const result = await processWarmUp();
      expect(result.tenantsProcessed).toBe(0);
      expect(result.emailsSent).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('handles config with daily limit reached', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{
              config: {
                id: 'cfg-1',
                tenantId: 'tenant-1',
                dailyLimitCurrent: 10,
                dailyLimitStart: 5,
                dailyLimitMax: 50,
                rampUpDays: 21,
                startedAt: new Date(),
                fromName: 'Test',
                isActive: true,
                totalSent: 100,
                lastWarmupAt: new Date(),
              },
              sentToday: 10,
            }])),
          })),
        })),
      });

      const { processWarmUp } = await import('@/lib/email/warmup');
      const result = await processWarmUp();
      expect(result.tenantsProcessed).toBe(0);
      expect(result.emailsSent).toBe(0);
    });

    it('sends warm-up emails to available participants', async () => {
      const mockConfig = {
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
      const mockParticipants = [
        { id: 'p1', participantEmail: 'user1@example.com', participantName: 'User One', configId: 'cfg-1', lastSentAt: null, status: 'active', sentCount: 0 },
      ];

      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ config: mockConfig, sentToday: 0, bouncesLast7Days: 0, sendsLast7Days: 10 }])),
          })),
        })),
      });
      (db.query.emailWarmupPool.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockParticipants);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'log-1', configId: 'cfg-1', participantId: 'p1', direction: 'outbound', status: 'pending' }]),
        })),
      });
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });

      const { processWarmUp } = await import('@/lib/email/warmup');
      const result = await processWarmUp();
      expect(result.emailsSent).toBe(1);
      expect(result.tenantsProcessed).toBe(1);
    });

    it('logs send failures', async () => {
      const mockConfig = {
        id: 'cfg-2',
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
      const mockParticipants = [
        { id: 'p2', participantEmail: 'fail@example.com', participantName: 'Fail User', configId: 'cfg-2', lastSentAt: null, status: 'active', sentCount: 0 },
      ];

      const { db } = await import('@/drizzle/db');
      (db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ config: mockConfig, sentToday: 0, bouncesLast7Days: 0, sendsLast7Days: 10 }])),
          })),
        })),
      });
      (db.query.emailWarmupPool.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockParticipants);
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn(() => [{ id: 'log-2', configId: 'cfg-2', participantId: 'p2' }]),
        })),
      });

      const { sendEmail } = await import('@/lib/email/service');
      (sendEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SMTP connection refused'));

      const { processWarmUp } = await import('@/lib/email/warmup');
      const result = await processWarmUp();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('fail@example.com');
    });
  });

  describe('recordWarmUpReply', () => {
    it('updates log status to replied and increments counters', async () => {
      const { db } = await import('@/drizzle/db');
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });
      (db.query.emailWarmupLogs.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'log-1',
        configId: 'cfg-1',
        participantId: 'p1',
      });

      const { recordWarmUpReply } = await import('@/lib/email/warmup');
      await expect(recordWarmUpReply('log-1')).resolves.not.toThrow();
      expect(db.transaction).toHaveBeenCalled();
    });

    it('silently skips when log not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.emailWarmupLogs.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { recordWarmUpReply } = await import('@/lib/email/warmup');
      await expect(recordWarmUpReply('log-missing')).resolves.not.toThrow();
    });

    it('handles reply without participantId', async () => {
      const { db } = await import('@/drizzle/db');
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });
      (db.query.emailWarmupLogs.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'log-3',
        configId: 'cfg-1',
        participantId: null,
      });

      const { recordWarmUpReply } = await import('@/lib/email/warmup');
      await expect(recordWarmUpReply('log-3')).resolves.not.toThrow();
    });
  });

  describe('getWarmUpStats', () => {
    it('returns config for tenant', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.emailWarmupConfigs.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'cfg-1',
        tenantId: 'tenant-1',
        dailyLimitCurrent: 10,
      });

      const { getWarmUpStats } = await import('@/lib/email/warmup');
      const result = await getWarmUpStats('tenant-1');
      expect(result).toBeDefined();
      expect(result.id).toBe('cfg-1');
    });
  });
});
