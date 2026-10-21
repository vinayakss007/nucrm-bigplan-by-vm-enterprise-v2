/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2998 — sendEmail resolves with {success:false, error} on provider rejection
 * (lib/email/service.ts never throws for a rejected send). The email and bulk
 * email workers used to treat every non-throwing result as sent: the single
 * worker logged "Email sent successfully" and returned {sent:true}, and the
 * bulk worker hardcoded success:true per recipient. Both now fail the job /
 * record the rejection so BullMQ retries and dashboards show the truth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type JobProcessor = (job: { id: string; data: Record<string, unknown> }) => Promise<unknown>;

const processors = new Map<string, JobProcessor>();
const mockSendEmail = vi.fn();

vi.mock('bullmq', () => ({
  Worker: vi.fn(function MockWorker(name: string, processor: JobProcessor) {
    processors.set(name, processor);
    return { on: vi.fn(), close: vi.fn(async () => {}) };
  }),
  QueueEvents: vi.fn(function MockQueueEvents() {
    return { on: vi.fn(), close: vi.fn(async () => {}) };
  }),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return {
      on: vi.fn(),
      quit: vi.fn(async () => {}),
      disconnect: vi.fn(),
    };
  }),
}));

vi.mock('@/lib/secrets-file', () => ({ materializeFileSecrets: vi.fn() }));
vi.mock('@/lib/process-errors', () => ({ registerProcessErrorHandlers: vi.fn() }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('@/lib/email/service', () => ({
  sendEmail: (input: unknown) => mockSendEmail(input),
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
    query: {},
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  },
}));
vi.mock('@/drizzle/schema', () => ({ notifications: {} }));

process.env.REDIS_URL = 'redis://localhost:6379';

describe('worker.ts email processors — sendEmail result contract (#2998)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    processors.clear();
    vi.useFakeTimers();
    await import('@/worker');
    vi.useRealTimers();
    mockSendEmail.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('send-email job rejects when the provider refuses the send', async () => {
    const processor = processors.get('send-email');
    expect(processor).toBeTypeOf('function');

    mockSendEmail.mockResolvedValueOnce({ success: true, provider: 'resend', messageId: 'msg-1' });
    await expect(processor!({
      id: 'j1',
      data: { to: 'rep@example.com', subject: 's', body: 'b', tenantId: 't-1' },
    })).resolves.toMatchObject({ sent: true, messageId: 'msg-1' });

    mockSendEmail.mockResolvedValueOnce({ success: false, error: '403 forbidden' });
    await expect(processor!({
      id: 'j2',
      data: { to: 'rep@example.com', subject: 's', body: 'b', tenantId: 't-1' },
    })).rejects.toThrow('403 forbidden');
  });

  it('send-bulk-emails records provider rejections as per-recipient failures', async () => {
    const processor = processors.get('send-bulk-emails');
    expect(processor).toBeTypeOf('function');

    mockSendEmail
      .mockResolvedValueOnce({ success: true, provider: 'resend' })
      .mockResolvedValueOnce({ success: false, error: 'bounce' });

    const out = await processor!({
      id: 'j3',
      data: {
        subject: 's',
        body: 'hello {first_name}',
        tenantId: 't-1',
        recipients: [{ email: 'a@example.com', first_name: 'A' }, { email: 'b@example.com', first_name: 'B' }],
      },
    });

    expect(out).toMatchObject({ total: 2, success: 1 });
    const results = (out as { results: Array<{ success: boolean; error?: string }> }).results;
    expect(results[0]).toMatchObject({ success: true });
    expect(results[1]).toMatchObject({ success: false, error: 'bounce' });
  });
});
