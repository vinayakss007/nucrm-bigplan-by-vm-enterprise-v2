/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
vi.mock('@/drizzle/db', () => ({
  db: { execute: (...args: any[]) => mockExecute(...args) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { error: vi.fn() } }));

import {
  isBlocked,
  recordFailedAttempt,
  recordSuccessfulLogin,
  getBruteForceStatus,
  cleanupOldRecords,
} from '@/lib/security/brute-force';

describe('brute-force', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('isBlocked', () => {
    it('returns blocked=true when block record found', async () => {
      const future = new Date(Date.now() + 60000).toISOString();
      mockExecute.mockResolvedValue({
        rows: [{ blocked_until: future, block_reason: 'Too many attempts' }],
      });
      const r = await isBlocked('1.2.3.4', 'ip');
      expect(r.blocked).toBe(true);
      expect(r.blockedUntil).toBeInstanceOf(Date);
      expect(r.reason).toBe('Too many attempts');
    });

    it('returns blocked=false when no rows', async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      const r = await isBlocked('1.2.3.4', 'ip');
      expect(r.blocked).toBe(false);
    });

    it('allows the first request through on DB error (#1174 fail-safe, not hard fail-closed)', async () => {
      mockExecute.mockRejectedValue(new Error('DB down'));
      const r = await isBlocked('203.0.113.7', 'ip');
      expect(r.blocked).toBe(false);
    });

    it('uses default reason when block_reason is null', async () => {
      const future = new Date(Date.now() + 60000).toISOString();
      mockExecute.mockResolvedValue({
        rows: [{ blocked_until: future, block_reason: null }],
      });
      const r = await isBlocked('x@x.com', 'email');
      expect(r.blocked).toBe(true);
      expect(r.reason).toBe('Too many failed attempts');
    });
  });

  describe('recordFailedAttempt', () => {
    it('inserts attempt and checks counts', async () => {
      // First call: INSERT attempt
      // Second call: count by IP
      // Third call: count by email
      mockExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });
      await recordFailedAttempt('a@b.com', '10.0.0.1', 'Mozilla', 'wrong password');
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('blocks IP when threshold exceeded', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // blockIdentifier INSERT
      await recordFailedAttempt('a@b.com', '10.0.0.1');
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('blocks email when threshold exceeded', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [] }); // blockIdentifier INSERT
      await recordFailedAttempt('a@b.com', '10.0.0.1');
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('does not throw on DB error', async () => {
      mockExecute.mockRejectedValue(new Error('fail'));
      await expect(recordFailedAttempt('a@b.com', '10.0.0.1')).resolves.toBeUndefined();
    });
  });

  describe('recordSuccessfulLogin', () => {
    it('inserts successful attempt', async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await recordSuccessfulLogin('a@b.com', '10.0.0.1', 'Mozilla');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('does not throw on DB error', async () => {
      mockExecute.mockRejectedValue(new Error('fail'));
      await expect(recordSuccessfulLogin('a@b.com', '10.0.0.1')).resolves.toBeUndefined();
    });
  });

  describe('getBruteForceStatus', () => {
    it('returns attempt count and remaining', async () => {
      const future = new Date(Date.now() + 60000).toISOString();
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ blocked_until: future, block_reason: 'x' }] });
      const r = await getBruteForceStatus('10.0.0.1', 'ip');
      expect(r.attempts).toBe(3);
      expect(r.remainingAttempts).toBe(2);
      expect(r.blocked).toBe(true);
    });

    it('returns defaults on DB error', async () => {
      mockExecute.mockRejectedValue(new Error('fail'));
      const r = await getBruteForceStatus('10.0.0.1', 'ip');
      expect(r.attempts).toBe(0);
      expect(r.blocked).toBe(false);
      expect(r.remainingAttempts).toBe(5);
    });

    it('returns zero remaining when at max', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: 7 }] })
        .mockResolvedValueOnce({ rows: [] });
      const r = await getBruteForceStatus('a@b.com', 'email');
      expect(r.remainingAttempts).toBe(0);
    });
  });

  describe('cleanupOldRecords', () => {
    it('returns cleaned counts', async () => {
      mockExecute
        .mockResolvedValueOnce({ rowCount: 3 })
        .mockResolvedValueOnce({ rowCount: 10 });
      const r = await cleanupOldRecords();
      expect(r.blocksCleaned).toBe(3);
      expect(r.attemptsCleaned).toBe(10);
    });

    it('returns zeros on DB error', async () => {
      mockExecute.mockRejectedValue(new Error('fail'));
      const r = await cleanupOldRecords();
      expect(r.blocksCleaned).toBe(0);
      expect(r.attemptsCleaned).toBe(0);
    });

    it('handles undefined rowCount', async () => {
      mockExecute.mockResolvedValue({});
      const r = await cleanupOldRecords();
      expect(r.blocksCleaned).toBe(0);
      expect(r.attemptsCleaned).toBe(0);
    });
  });
});
