import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbExecute = vi.fn();
vi.mock('@/drizzle/db', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { execute: (...args: any[]) => mockDbExecute(...args) },
}));

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { error: vi.fn() } }));

const DEFAULT_CONFIG = { maxAttempts: 5, windowMinutes: 15, blockMinutes: 30 };

describe('isBlocked', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns blocked=true when a valid block exists', async () => {
    const future = new Date(Date.now() + 3600000);
    mockDbExecute.mockResolvedValue({
      rows: [{ blocked_until: future.toISOString(), block_reason: 'Too many attempts' }],
    });
    const { isBlocked } = await import('@/lib/security/brute-force');
    const result = await isBlocked('test@test.com', 'email');
    expect(result.blocked).toBe(true);
    expect(result.blockedUntil).toBeInstanceOf(Date);
    expect(result.reason).toBe('Too many attempts');
  });

  it('returns blocked=false when no block exists', async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { isBlocked } = await import('@/lib/security/brute-force');
    const result = await isBlocked('test@test.com', 'email');
    expect(result.blocked).toBe(false);
  });

  it('returns blocked=false on db error (fail open)', async () => {
    mockDbExecute.mockRejectedValue(new Error('DB error'));
    const { isBlocked } = await import('@/lib/security/brute-force');
    const result = await isBlocked('test@test.com', 'email');
    expect(result.blocked).toBe(false);
  });
});

describe('recordFailedAttempt', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records failed attempt and does not block below threshold', async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { recordFailedAttempt } = await import('@/lib/security/brute-force');
    await expect(recordFailedAttempt('test@test.com', '1.2.3.4')).resolves.toBeUndefined();
    expect(mockDbExecute).toHaveBeenCalledTimes(3);
  });

  it('blocks IP after exceeding maxAttempts', async () => {
    const callCount = { current: 0 };
    mockDbExecute.mockImplementation(() => {
      callCount.current++;
      if (callCount.current === 2) return Promise.resolve({ rows: [{ count: 5 }] });
      if (callCount.current === 3) return Promise.resolve({ rows: [{ count: 0 }] });
      return Promise.resolve({ rows: [] });
    });
    const { recordFailedAttempt } = await import('@/lib/security/brute-force');
    await recordFailedAttempt('test@test.com', '1.2.3.4');
    expect(mockDbExecute).toHaveBeenCalledTimes(4);
  });

  it('handles errors gracefully', async () => {
    mockDbExecute.mockRejectedValue(new Error('DB error'));
    const { recordFailedAttempt } = await import('@/lib/security/brute-force');
    await expect(recordFailedAttempt('test@test.com', '1.2.3.4')).resolves.toBeUndefined();
  });
});

describe('getBruteForceStatus', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns status with attempts and remaining', async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ count: 3 }] });
    const { getBruteForceStatus } = await import('@/lib/security/brute-force');
    const result = await getBruteForceStatus('test@test.com', 'email');
    expect(result.attempts).toBe(3);
    expect(result.remainingAttempts).toBe(2);
    expect(result.blocked).toBe(false);
  });
});
