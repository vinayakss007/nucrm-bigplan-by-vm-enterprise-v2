import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: mockExecute,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/dev-logger', () => ({
  devLogger: {
    error: vi.fn(),
  },
}));

describe('security/brute-force', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // vitest v4: restoreAllMocks no longer clears call history on plain vi.fn()
    mockExecute.mockReset();
  });

  describe('isBlocked', () => {
    it('returns blocked=false when no block exists', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const { isBlocked } = await import('@/lib/security/brute-force');
      const result = await isBlocked('127.0.0.1', 'ip');
      expect(result.blocked).toBe(false);
    });

    it('returns blocked=true when active block exists', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      mockExecute.mockResolvedValue({ rows: [{ blocked_until: futureDate, block_reason: 'Too many attempts' }] });

      const { isBlocked } = await import('@/lib/security/brute-force');
      const result = await isBlocked('127.0.0.1', 'ip');
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Too many attempts');
    });

    it('returns blocked=false on DB error (fail open)', async () => {
      mockExecute.mockRejectedValue(new Error('DB connection lost'));

      const { isBlocked } = await import('@/lib/security/brute-force');
      const result = await isBlocked('127.0.0.1', 'ip');
      expect(result.blocked).toBe(false);
    });
  });

  describe('recordFailedAttempt', () => {
    it('records attempt and blocks IP when threshold exceeded', async () => {
      mockExecute
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // IP count >= maxAttempts
        .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // Email count < maxAttempts
        .mockResolvedValueOnce(undefined); // block INSERT

      const { recordFailedAttempt } = await import('@/lib/security/brute-force');
      await recordFailedAttempt('user@test.com', '192.168.1.1');
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('records attempt and blocks email when threshold exceeded', async () => {
      mockExecute
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // IP count < maxAttempts
        .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // Email count >= maxAttempts
        .mockResolvedValueOnce(undefined); // block INSERT

      const { recordFailedAttempt } = await import('@/lib/security/brute-force');
      await recordFailedAttempt('user@test.com', '192.168.1.1');
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('handles DB error gracefully', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const { recordFailedAttempt } = await import('@/lib/security/brute-force');
      await expect(recordFailedAttempt('user@test.com', '192.168.1.1')).resolves.not.toThrow();
    });
  });

  describe('recordSuccessfulLogin', () => {
    it('inserts a successful login record', async () => {
      mockExecute.mockResolvedValue(undefined);

      const { recordSuccessfulLogin } = await import('@/lib/security/brute-force');
      await recordSuccessfulLogin('user@test.com', '192.168.1.1');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('handles DB error gracefully', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const { recordSuccessfulLogin } = await import('@/lib/security/brute-force');
      await expect(recordSuccessfulLogin('user@test.com', '192.168.1.1')).resolves.not.toThrow();
    });
  });

  describe('getBruteForceStatus', () => {
    it('returns status with remaining attempts', async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: 3 }] });
      vi.mocked(mockExecute).mockResolvedValueOnce({ rows: [{ count: 3 }] });
      vi.mocked(mockExecute).mockResolvedValueOnce({ rows: [] });

      const { getBruteForceStatus } = await import('@/lib/security/brute-force');
      const result = await getBruteForceStatus('127.0.0.1', 'ip');
      expect(result.attempts).toBe(3);
      expect(result.remainingAttempts).toBe(2);
    });

    it('handles DB error gracefully', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const { getBruteForceStatus } = await import('@/lib/security/brute-force');
      const result = await getBruteForceStatus('127.0.0.1', 'ip');
      expect(result.attempts).toBe(0);
      expect(result.remainingAttempts).toBe(5);
    });
  });

  describe('cleanupOldRecords', () => {
    it('deletes old blocks and attempts', async () => {
      mockExecute
        .mockResolvedValueOnce({ rowCount: 3 }) // blocks cleaned
        .mockResolvedValueOnce({ rowCount: 100 }); // attempts cleaned

      const { cleanupOldRecords } = await import('@/lib/security/brute-force');
      const result = await cleanupOldRecords();
      expect(result.blocksCleaned).toBe(3);
      expect(result.attemptsCleaned).toBe(100);
    });

    it('handles DB error gracefully', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const { cleanupOldRecords } = await import('@/lib/security/brute-force');
      const result = await cleanupOldRecords();
      expect(result.blocksCleaned).toBe(0);
      expect(result.attemptsCleaned).toBe(0);
    });
  });
});
