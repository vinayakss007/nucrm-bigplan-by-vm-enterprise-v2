import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('cache module', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('cache exports', () => {
    it('module loads without error', async () => {
      const cacheModule = await import('@/lib/cache');
      expect(cacheModule).toBeDefined();
    });
  });

  describe('cache/queries', () => {
    it('exports queries module', async () => {
      const queriesModule = await import('@/lib/cache/queries');
      expect(queriesModule).toBeDefined();
    });
  });

  describe('cache/sessions', () => {
    it('exports sessions module', async () => {
      const sessionsModule = await import('@/lib/cache/sessions');
      expect(sessionsModule).toBeDefined();
    });
  });
});
