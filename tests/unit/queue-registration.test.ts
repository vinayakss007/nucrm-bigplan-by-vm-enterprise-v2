import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClose = vi.fn(async () => {});
const mockSend = vi.fn(async () => 'job-1');
const mockWork = vi.fn(async () => {});

const mockBullQueueCtor = vi.fn(function MockBullQueue() {
  return {
    add: mockSend,
    process: mockWork,
    close: mockClose,
    on: vi.fn(),
  };
});
const _mockBullShutdown = vi.fn(async () => {});

vi.mock('bullmq', () => ({
  Queue: mockBullQueueCtor,
  Worker: vi.fn(),
}));
vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return {
      connect: vi.fn(async () => {}),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => {}),
      on: vi.fn(),
    };
  }),
}));
// #3411: the `pg-boss` mock went with the adapter. This file's job is now to keep
// every declared job type registered on the one backend that can deliver it.

process.env.REDIS_URL = 'redis://localhost:6379';

describe('queue adapter registration', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockBullQueueCtor.mockClear();
    mockSend.mockReset();
    mockWork.mockReset();
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.DATABASE_URL;
  });

  it('registers send-lead-warming in the Redis adapter', async () => {
    const { getQueueAdapter, closeQueue } = await import('@/lib/queue/index');
    const queue = await getQueueAdapter();
    expect(queue.provider).toBe('redis');

    const registeredTypes = mockBullQueueCtor.mock.calls.map(c => c[0]);
    expect(registeredTypes).toContain('send-lead-warming');

    await closeQueue();
  });

  // #3411 deleted the pg-boss adapter — nothing in this repo called `boss.work()`,
  // so a job that negotiated its way there was written to a table and never read.
  // Its two registration cases went with it; `queue-single-backend-3411.test.ts`
  // now asserts the opposite property: no backend but Redis can be reached.
  it('registers webhooks in the Redis adapter so addJob(webhooks) routes correctly (#1186)', async () => {
    const { getQueueAdapter, closeQueue } = await import('@/lib/queue/index');
    const queue = await getQueueAdapter();
    expect(queue.provider).toBe('redis');

    const registeredTypes = mockBullQueueCtor.mock.calls.map(c => c[0]);
    expect(registeredTypes).toContain('webhooks');

    // The webhooks worker consumes the 'webhooks' queue; addJob must accept it
    // instead of throwing "Unknown job type".
    await expect(queue.addJob('webhooks', { url: 'https://example.com', payload: {} })).resolves.toBeUndefined();

    await closeQueue();
  });
});
