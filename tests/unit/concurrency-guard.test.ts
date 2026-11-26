import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  withConcurrencyGuard,
  ConcurrencyError,
  InvalidExpectedUpdatedAtError,
} from '@/lib/concurrency';
import { concurrencyGuard, updatedAtMs } from '@/lib/api/concurrency';
import { tenants } from '@/drizzle/schema';

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

/**
 * The `table + expectedUpdatedAt` overload is used by ~18 route handlers as the
 * WHERE clause of their guarded UPDATE.
 */
describe('concurrencyGuard (sql-fragment overload)', () => {
  const dialect = new PgDialect();
  const render = (frag: unknown) =>
    dialect.sqlToQuery(frag as Parameters<PgDialect['sqlToQuery']>[0]);

  it('compares at millisecond precision, not by raw equality', () => {
    // Postgres stores `updated_at` to microseconds; a JS Date and an ISO
    // timestamp from a client both stop at milliseconds. `eq(col, date)` can
    // therefore never match a row whose updated_at was written by the database,
    // so every guarded update on such a row answered 409 — branding failed this
    // way for every freshly provisioned tenant.
    const frag = concurrencyGuard(tenants, new Date('2026-01-01T00:00:00.000Z'));
    const { sql } = render(frag);
    expect(sql).toContain("date_trunc('millisecond'");
    expect(sql).not.toMatch(/updated_at\s*=\s*\$/);
  });

  it('binds the expected timestamp as a parameter rather than interpolating it', () => {
    const { sql, params } = render(concurrencyGuard(tenants, '2026-01-01T00:00:00.000Z'));
    expect(params).toHaveLength(1);
    expect(params[0]).toBeInstanceOf(Date);
    expect(sql).not.toContain('2026-01-01');
  });

  it('still opts out when the caller did not send a timestamp', () => {
    expect(concurrencyGuard(tenants, undefined)).toBeNull();
    expect(concurrencyGuard(tenants, null)).toBeNull();
  });

  it('opts out on an unparseable timestamp instead of guarding on NaN', () => {
    expect(concurrencyGuard(tenants, 'not-a-date')).toBeNull();
  });

  it('updatedAtMs truncates both sides to the same precision', () => {
    const { sql, params } = render(updatedAtMs(tenants, '2026-01-01T00:00:00.000Z'));
    expect(sql.match(/date_trunc\('millisecond'/g)).toHaveLength(2);
    expect(params[0]).toBeInstanceOf(Date);
  });

  it('a microsecond DB value still matches the millisecond guard', () => {
    // What the guard is for: the DB row reads back as ...239728, the client
    // echoes ...239, and the update must still find the row.
    const guard = render(concurrencyGuard(tenants, '2026-09-29T06:24:35.239Z'));
    expect(guard.sql).toContain('date_trunc');
    expect((guard.params[0] as Date).getTime()).toBe(
      new Date('2026-09-29T06:24:35.239Z').getTime(),
    );
  });
});

describe('concurrencyGuard (db overload) is an atomic claim (#3849)', () => {
  const dialect = new PgDialect();
  const expected = new Date('2026-09-29T06:24:35.239Z');
  const id = '00000000-0000-4000-8000-000000000001';

  function fakeDb(claimed: unknown[], existing: unknown[] = []) {
    const whereArgs: unknown[] = [];
    const set = vi.fn((_value: unknown) => ({
      where: (...args: unknown[]) => {
        whereArgs.push(...args);
        return { returning: async () => claimed };
      },
    }));
    const update = vi.fn(() => ({ set }));
    const select = vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => existing }) }),
    }));
    return { db: { update, select } as never, whereArgs, set, update, select };
  }

  function call(db: never, value: Date | string | null = expected) {
    return concurrencyGuard(db, tenants, id, id, value);
  }

  it('claims the row with one conditional UPDATE and does not read it first', async () => {
    const { db, whereArgs, set, select } = fakeDb([{ id }]);
    await expect(call(db)).resolves.toBeNull();
    expect(set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
    expect(select).not.toHaveBeenCalled();
    const where = dialect.sqlToQuery(whereArgs[0] as Parameters<PgDialect['sqlToQuery']>[0]);
    expect(where.sql).toContain("date_trunc('millisecond'");
  });

  it('answers 409 when the conditional UPDATE matched no row but the row exists', async () => {
    const { db } = fakeDb([], [{ id }]);
    const res = await call(db);
    expect(res?.status).toBe(409);
  });

  it('answers 404 when the row is gone', async () => {
    const { db } = fakeDb([]);
    const res = await call(db);
    expect(res?.status).toBe(404);
  });

  it('refuses an unparseable timestamp without touching the database', async () => {
    const { db, update } = fakeDb([]);
    const res = await call(db, 'not-a-date');
    expect(res?.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('opts out when no timestamp was supplied', async () => {
    const { db, update } = fakeDb([]);
    await expect(call(db, null)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
