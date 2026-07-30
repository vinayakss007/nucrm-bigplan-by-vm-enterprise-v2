/**
 * Tests for lib/cron/distributed-lock.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Mock pool
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    connect: mockConnect,
  }),
}));

describe('distributed cron lock', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  describe('jobNameToLockId', () => {
    it('produces consistent hash for same input', async () => {
      const { jobNameToLockId } = await import('@/lib/cron/distributed-lock');
      const id1 = jobNameToLockId('backup-daily');
      const id2 = jobNameToLockId('backup-daily');
      expect(id1).toBe(id2);
    });

    it('produces different hashes for different inputs', async () => {
      const { jobNameToLockId } = await import('@/lib/cron/distributed-lock');
      const id1 = jobNameToLockId('backup-daily');
      const id2 = jobNameToLockId('sla-check');
      expect(id1).not.toBe(id2);
    });

    it('returns a positive 31-bit integer', async () => {
      const { jobNameToLockId } = await import('@/lib/cron/distributed-lock');
      const id = jobNameToLockId('some-job-name');
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    });
  });

  describe('withCronLock', () => {
    it('executes handler when lock is acquired', async () => {
      // SET statement_timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // pg_try_advisory_lock => true
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] });
      // pg_advisory_unlock
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { withCronLock } = await import('@/lib/cron/distributed-lock');

      const response = await withCronLock('test-job', async () => {
        return NextResponse.json({ done: true });
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.done).toBe(true);
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when lock is not acquired', async () => {
      // SET statement_timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // pg_try_advisory_lock => false
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });
      // pg_advisory_unlock (still called in finally)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { withCronLock } = await import('@/lib/cron/distributed-lock');

      const response = await withCronLock('test-job', async () => {
        return NextResponse.json({ done: true });
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('already running');
      expect(body.job).toBe('test-job');
    });

    it('releases lock and connection even if handler throws', async () => {
      // SET statement_timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // pg_try_advisory_lock => true
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] });
      // pg_advisory_unlock
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { withCronLock } = await import('@/lib/cron/distributed-lock');

      await expect(
        withCronLock('test-job', async () => {
          throw new Error('handler failed');
        }),
      ).rejects.toThrow('handler failed');

      expect(mockRelease).toHaveBeenCalledTimes(1);
      // Lock unlock was attempted
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('sets correct timeout', async () => {
      // SET statement_timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // pg_try_advisory_lock => true
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] });
      // pg_advisory_unlock
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { withCronLock } = await import('@/lib/cron/distributed-lock');

      await withCronLock(
        'test-job',
        async () => NextResponse.json({ ok: true }),
        { timeoutMs: 60_000 },
      );

      expect(mockQuery).toHaveBeenCalledWith("SET statement_timeout = '60000'");
    });

    it('handles unlock failure gracefully', async () => {
      // SET statement_timeout
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // pg_try_advisory_lock => true
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: true }] });
      // pg_advisory_unlock fails
      mockQuery.mockRejectedValueOnce(new Error('connection lost'));

      const { withCronLock } = await import('@/lib/cron/distributed-lock');

      // Should not throw despite unlock failure
      const response = await withCronLock('test-job', async () => {
        return NextResponse.json({ done: true });
      });

      expect(response.status).toBe(200);
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });
});
