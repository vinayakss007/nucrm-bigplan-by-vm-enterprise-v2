import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ count: 0, key: '' }));

vi.mock('@/lib/cache', () => ({
  incr: vi.fn(async (key: string) => {
    state.key = key;
    return state.count;
  }),
}));

vi.mock('@/drizzle/db', () => ({ db: {} }));

const { isRateLimited } = await import('@/app/api/tenant/plugins/webhook/[id]/route');

describe('plugin webhook rate limiting', () => {
  beforeEach(() => {
    state.count = 0;
    state.key = '';
  });

  it('counts in the shared cache, keyed by plugin and time window', async () => {
    state.count = 1;
    expect(await isRateLimited('plugin-1')).toBe(false);
    expect(state.key).toMatch(/^webhook-rate:plugin-1:\d+$/);
  });

  it('refuses once the shared counter crosses the limit', async () => {
    state.count = 61;
    expect(await isRateLimited('plugin-1')).toBe(true);
  });
});
