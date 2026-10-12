import { beforeEach, expect, it, vi } from 'vitest';

const { calls, flush, end } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    flush: vi.fn(async () => {
      calls.push('flush');
      return true;
    }),
    end: vi.fn(async () => {
      calls.push('pool.end');
    }),
  };
});

vi.mock('@sentry/nextjs', () => ({ flush }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ end }) }));

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  flush.mockImplementation(async () => {
    calls.push('flush');
    return true;
  });
});

async function shutdown(): Promise<void> {
  const { initiateShutdown, resetShutdownState } = await import('../../lib/db/graceful-shutdown');
  resetShutdownState();
  await initiateShutdown({});
}

it('flushes buffered Sentry events before draining the pool', async () => {
  await shutdown();

  expect(flush).toHaveBeenCalledWith(2_000);
  expect(calls).toEqual(['flush', 'pool.end']);
});

it('still drains the pool when the flush throws', async () => {
  flush.mockRejectedValueOnce(new Error('ingest unreachable'));

  await shutdown();

  expect(end).toHaveBeenCalledTimes(1);
});

it('still drains the pool when the flush times out, and says so', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  flush.mockResolvedValueOnce(false);

  await shutdown();

  expect(flush).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls.flat().join(' ')).toContain('flush timed out');
  warn.mockRestore();
});
