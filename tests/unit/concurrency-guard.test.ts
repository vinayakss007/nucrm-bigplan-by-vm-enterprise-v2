import { describe, it, expect, vi } from 'vitest';
import {
  withConcurrencyGuard,
  ConcurrencyError,
  InvalidExpectedUpdatedAtError,
} from '@/lib/concurrency';

describe('withConcurrencyGuard', () => {
  const validUpdatedAt = new Date('2026-01-01T00:00:00.000Z');

  it('returns rows when the update affected at least one row', async () => {
    const rows = [{ id: '1' }];
    const result = await withConcurrencyGuard(async () => rows, 'Lead', validUpdatedAt);
    expect(result).toBe(rows);
  });

  it('throws ConcurrencyError when the update affected zero rows (stale write blocked)', async () => {
    await expect(
      withConcurrencyGuard(async () => [], 'Lead', validUpdatedAt),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('accepts an ISO string expectedUpdatedAt', async () => {
    const rows = [{ id: '1' }];
    const result = await withConcurrencyGuard(
      async () => rows,
      'Deal',
      '2026-01-01T00:00:00.000Z',
    );
    expect(result).toBe(rows);
  });

  it('throws InvalidExpectedUpdatedAtError and does not run the update when expectedUpdatedAt is missing', async () => {
    const updateFn = vi.fn(async () => [{ id: '1' }]);
    await expect(
      // @ts-expect-error deliberately passing an invalid value
      withConcurrencyGuard(updateFn, 'Lead', undefined),
    ).rejects.toBeInstanceOf(InvalidExpectedUpdatedAtError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('throws InvalidExpectedUpdatedAtError and does not run the update when expectedUpdatedAt is unparseable', async () => {
    const updateFn = vi.fn(async () => [{ id: '1' }]);
    await expect(
      withConcurrencyGuard(updateFn, 'Lead', 'not-a-date'),
    ).rejects.toBeInstanceOf(InvalidExpectedUpdatedAtError);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('ConcurrencyError carries a 409 status code', () => {
    expect(new ConcurrencyError('Lead').statusCode).toBe(409);
  });

  it('InvalidExpectedUpdatedAtError carries a 400 status code', () => {
    expect(new InvalidExpectedUpdatedAtError().statusCode).toBe(400);
  });
});
