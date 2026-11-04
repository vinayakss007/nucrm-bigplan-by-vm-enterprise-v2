import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #3411 rewrote this file. It used to document the negotiation
 * Redis → pg-boss → memory as the intended design, and to assert that a process
 * which lost Redis kept the fallback it had picked. Nothing consumed pg-boss and
 * the memory adapter discards what it buffers, so those assertions were pinning
 * the mechanism by which a job could be accepted and never delivered.
 *
 * The queue now has one backend and one failure mode. See
 * `tests/unit/queue-single-backend-3411.test.ts` for the outage / registry /
 * heartbeat screens; this file keeps the module's basic contract.
 */
const state = vi.hoisted(() => ({ redisWorks: true }));

vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return {
      ping: async () => {
        if (!state.redisWorks) throw new Error('ECONNREFUSED 127.0.0.1:6379');
        return 'PONG';
      },
      quit: async () => 'OK',
      on: () => undefined,
    };
  }),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: async () => ({ id: 'job-1' }),
      close: async () => undefined,
    };
  }),
  Worker: vi.fn(),
}));

describe('queue/index', () => {
  beforeEach(() => {
    vi.resetModules();
    state.redisWorks = true;
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.DATABASE_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('getQueueAdapter', () => {
    it('connects to Redis', async () => {
      const { getQueueAdapter } = await import('@/lib/queue/index');
      const adapter = await getQueueAdapter();
      expect(adapter.provider).toBe('redis');
    });

    it('returns same adapter on subsequent calls', async () => {
      const { getQueueAdapter } = await import('@/lib/queue/index');
      const adapter1 = await getQueueAdapter();
      const adapter2 = await getQueueAdapter();
      expect(adapter1).toBe(adapter2);
    });
  });

  describe('addJob', () => {
    it('adds job to queue', async () => {
      const { addJob } = await import('@/lib/queue/index');

      await expect(addJob('send-email', {
        to: 'test@example.com',
        subject: 'Test',
      })).resolves.not.toThrow();
    });

    it('adds job with options', async () => {
      const { addJob } = await import('@/lib/queue/index');

      await expect(addJob('send-email', {
        to: 'test@example.com',
      }, {
        priority: 10,
        attempts: 5,
        delay: 1000,
      })).resolves.not.toThrow();
    });

    it('rejects an unknown job type instead of dropping it', async () => {
      const { addJob } = await import('@/lib/queue/index');
      await expect(addJob('nope' as never, {})).rejects.toThrow(/Unknown job type/);
    });
  });

  describe('closeQueue', () => {
    it('closes queue and resets adapter', async () => {
      const { closeQueue, getQueueAdapter } = await import('@/lib/queue/index');

      await closeQueue();

      // Should create new adapter after close
      const newAdapter = await getQueueAdapter();
      expect(newAdapter).toBeDefined();
    });
  });
});
