import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerCronRun,
  getCronHealth,
  getStaleJobs,
  resetCronHealth,
} from '@/lib/cron/health';

describe('lib/cron/health', () => {
  beforeEach(() => {
    resetCronHealth();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('registerCronRun', () => {
    it('stores a cron run entry correctly', () => {
      registerCronRun('invoice-reminders', { durationMs: 150, status: 'ok' });

      const entries = getCronHealth();
      expect(entries).toHaveLength(1);
      expect(entries[0].jobName).toBe('invoice-reminders');
      expect(entries[0].durationMs).toBe(150);
      expect(entries[0].status).toBe('ok');
      expect(entries[0].lastRunAt).toBeGreaterThan(0);
    });

    it('stores error information when status is error', () => {
      registerCronRun('email-cleanup', {
        durationMs: 500,
        status: 'error',
        error: 'Connection timeout',
      });

      const entries = getCronHealth();
      expect(entries[0].status).toBe('error');
      expect(entries[0].error).toBe('Connection timeout');
    });

    it('overwrites previous entry for the same job name', () => {
      registerCronRun('sync-job', { durationMs: 100, status: 'ok' });
      registerCronRun('sync-job', { durationMs: 200, status: 'error', error: 'fail' });

      const entries = getCronHealth();
      expect(entries).toHaveLength(1);
      expect(entries[0].durationMs).toBe(200);
      expect(entries[0].status).toBe('error');
    });
  });

  describe('getCronHealth', () => {
    it('returns all registered crons', () => {
      registerCronRun('job-a', { durationMs: 10, status: 'ok' });
      registerCronRun('job-b', { durationMs: 20, status: 'ok' });
      registerCronRun('job-c', { durationMs: 30, status: 'ok' });

      const entries = getCronHealth();
      expect(entries).toHaveLength(3);
      const names = entries.map((e) => e.jobName);
      expect(names).toContain('job-a');
      expect(names).toContain('job-b');
      expect(names).toContain('job-c');
    });

    it('marks fresh jobs as not stale', () => {
      registerCronRun('recent-job', { durationMs: 50, status: 'ok' });

      const entries = getCronHealth(900_000); // 15min threshold
      expect(entries[0].stale).toBe(false);
    });

    it('marks old jobs as stale', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      registerCronRun('old-job', { durationMs: 50, status: 'ok' });

      // Advance time past the threshold
      vi.setSystemTime(now + 900_001);

      const entries = getCronHealth(900_000);
      expect(entries[0].stale).toBe(true);
    });
  });

  describe('getStaleJobs', () => {
    it('returns only stale jobs', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      registerCronRun('stale-job', { durationMs: 10, status: 'ok' });

      // Advance time to make first job stale
      vi.setSystemTime(now + 1_000_000);

      // Register a fresh job
      registerCronRun('fresh-job', { durationMs: 20, status: 'ok' });

      const stale = getStaleJobs(900_000);
      expect(stale).toHaveLength(1);
      expect(stale[0].jobName).toBe('stale-job');
      expect(stale[0].stale).toBe(true);
    });

    it('returns empty array when no jobs are stale', () => {
      registerCronRun('ok-job', { durationMs: 10, status: 'ok' });
      const stale = getStaleJobs(900_000);
      expect(stale).toHaveLength(0);
    });
  });

  describe('bounded registry (MAX_ENTRIES = 50)', () => {
    it('evicts oldest entry when registry exceeds 50 unique jobs', () => {
      vi.useFakeTimers();
      const baseTime = 1_000_000_000_000;

      // Register 50 jobs with increasing timestamps
      for (let i = 0; i < 50; i++) {
        vi.setSystemTime(baseTime + i * 1000);
        registerCronRun(`job-${i}`, { durationMs: 10, status: 'ok' });
      }

      expect(getCronHealth()).toHaveLength(50);

      // Register one more (51st job) - should evict the oldest (job-0)
      vi.setSystemTime(baseTime + 50 * 1000);
      registerCronRun('job-50', { durationMs: 10, status: 'ok' });

      const entries = getCronHealth();
      expect(entries).toHaveLength(50);

      const names = entries.map((e) => e.jobName);
      expect(names).not.toContain('job-0'); // oldest evicted
      expect(names).toContain('job-50'); // newest added
      expect(names).toContain('job-1'); // second oldest still present
    });

    it('does not evict when updating an existing job', () => {
      // Register 50 jobs
      for (let i = 0; i < 50; i++) {
        registerCronRun(`job-${i}`, { durationMs: 10, status: 'ok' });
      }

      expect(getCronHealth()).toHaveLength(50);

      // Update an existing job - should not trigger eviction
      registerCronRun('job-25', { durationMs: 999, status: 'error' });

      const entries = getCronHealth();
      expect(entries).toHaveLength(50);
      const updated = entries.find((e) => e.jobName === 'job-25');
      expect(updated?.durationMs).toBe(999);
    });
  });

  describe('resetCronHealth', () => {
    it('clears all entries', () => {
      registerCronRun('job-1', { durationMs: 10, status: 'ok' });
      registerCronRun('job-2', { durationMs: 20, status: 'ok' });

      resetCronHealth();
      expect(getCronHealth()).toHaveLength(0);
    });
  });
});
