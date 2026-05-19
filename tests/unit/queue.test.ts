import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('queue/index', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('getQueueAdapter', () => {
    it('falls back to memory adapter when no Redis or DB', async () => {
      const { getQueueAdapter } = await import('@/lib/queue/index');
      const adapter = await getQueueAdapter();
      expect(adapter.provider).toBe('memory');
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

  describe('getBoss', () => {
    it('throws when not using pg-boss', async () => {
      const { getBoss } = await import('@/lib/queue/index');
      
      await expect(getBoss()).rejects.toThrow('pg-boss provider');
    });
  });

  describe('memory adapter', () => {
    it('processes jobs after interval', async () => {
      vi.useFakeTimers();
      
      const { addJob } = await import('@/lib/queue/index');
      const spy = vi.spyOn(console, 'log');
      
      await addJob('send-email', { to: 'test@example.com' });
      
      // Advance time by 6 seconds (interval is 5s)
      vi.advanceTimersByTime(6000);
      
      expect(spy).toHaveBeenCalledWith(
        '[MemoryQueue] Processing: send-email',
        expect.any(Object)
      );
      
      vi.useRealTimers();
    });
  });
});
