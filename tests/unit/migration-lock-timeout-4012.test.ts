import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockPool = { connect: mockConnect };

vi.mock('@/lib/db/pool', () => ({ getPool: () => mockPool }));

import { withMigrationLock } from '@/lib/db/migration-safety';

describe('withMigrationLock timeout validation (#4012)', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockConnect.mockImplementation(async () => ({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }));
  });

  it('interpolates only a validated integer into SET lock_timeout', async () => {
    await withMigrationLock(async () => 'ok', { lockTimeoutMs: 2500 });
    const client = await mockConnect.mock.results[0]?.value;
    expect(client.query.mock.calls[0][0]).toBe("SET lock_timeout = '2500ms'");
  });

  it('uses the safe default when no timeout is supplied', async () => {
    await withMigrationLock(async () => 'ok');
    const client = await mockConnect.mock.results[0]?.value;
    expect(client.query.mock.calls[0][0]).toBe("SET lock_timeout = '10000ms'");
  });

  it.each([
    "1000ms'; DROP TABLE users; --",
    '1;DELETE',
    '0',
    -1,
    0,
    3_600_001,
    1.5,
    Number.NaN,
    null,
  ])('rejects invalid lockTimeoutMs %j before connecting to the pool', async (badValue) => {
    await expect(
      withMigrationLock(async () => 'ok', { lockTimeoutMs: badValue as number })
    ).rejects.toThrow('lockTimeoutMs must be an integer between 1 and 3600000');
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
