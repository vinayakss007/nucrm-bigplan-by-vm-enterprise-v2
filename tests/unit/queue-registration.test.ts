import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJobTypes: string[] = [];
const mockCreateQueue = vi.fn(async (name: string) => { mockJobTypes.push(name); });
const mockStart = vi.fn(async () => {});
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
vi.mock('pg-boss', () => ({
  default: vi.fn(function MockPgBoss() {
    return {
      start: mockStart,
      send: mockSend,
      work: mockWork,
      createQueue: mockCreateQueue,
      stop: mockClose,
    };
  }),
}));

process.env.REDIS_URL = 'redis://localhost:6379';

describe('queue adapter registration', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    mockJobTypes.length = 0;
    mockBullQueueCtor.mockClear();
    mockSend.mockReset();
    mockWork.mockReset();
    mockStart.mockReset();
    mockCreateQueue.mockReset();
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.DATABASE_URL;
  });

  it('registers send-lead-warming in Redis adapter', async () => {
    const { getQueueAdapter, closeQueue } = await import('@/lib/queue/index');
    const queue = await getQueueAdapter();
    expect(queue.provider).toBe('redis');

    const registeredTypes = mockBullQueueCtor.mock.calls.map(c => c[0]);
    expect(registeredTypes).toContain('send-lead-warming');

    await closeQueue();
  });

  it('registers send-lead-warming in pg-boss adapter', async () => {
    delete process.env.REDIS_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const { getQueueAdapter, closeQueue } = await import('@/lib/queue/index');
    const queue = await getQueueAdapter();
    expect(queue.provider).toBe('pgboss');

    expect(mockCreateQueue).toHaveBeenCalledWith('send-lead-warming');

    await closeQueue();
  });

  it('registers webhooks in Redis adapter so addJob(webhooks) routes correctly (#1186)', async () => {
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

  it('registers webhooks in pg-boss adapter (#1186)', async () => {
    delete process.env.REDIS_URL;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    const { getQueueAdapter, closeQueue } = await import('@/lib/queue/index');
    const queue = await getQueueAdapter();
    expect(queue.provider).toBe('pgboss');

    expect(mockCreateQueue).toHaveBeenCalledWith('webhooks');

    await closeQueue();
  });
});
