import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';

// ── Hoisted mutable mock references ─────────────────────────
const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

// ── Module mocks ────────────────────────────────────────────
vi.mock('@/lib/dev-logger', () => ({
  devLogger: {
    query: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/db/pool', () => ({
  getPool: vi.fn(() => ({
    query: mocks.poolQuery,
    connect: vi.fn().mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    }),
  })),
}));

// ── Tests ───────────────────────────────────────────────────
describe('db/client — query()', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('direct pool query (no transaction)', () => {
    it('calls getPool().query() with sql and params', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await query('SELECT 1', ['p1']);

      expect(mocks.poolQuery).toHaveBeenCalledWith('SELECT 1', ['p1']);
      expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
    });

    it('returns the full QueryResult from pool', async () => {
      const { query } = await import('@/lib/db/client');
      const fakeResult = { rows: [{ id: 1, name: 'Alice' }], rowCount: 1, fields: [], command: 'SELECT' };
      mocks.poolQuery.mockResolvedValue(fakeResult);

      const result = await query('SELECT * FROM users');

      expect(result).toEqual(fakeResult);
    });

    it('works without params argument', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('passes params as an empty array when given', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT $1', []);

      expect(mocks.poolQuery).toHaveBeenCalledWith('SELECT $1', []);
    });

    it('logs devLogger.query in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const { devLogger } = await import('@/lib/dev-logger');
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT 1', ['p']);

      expect(devLogger.query).toHaveBeenCalledWith('SELECT 1', expect.any(Number), ['p']);
    });

    it('does not log devLogger.query in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const { devLogger } = await import('@/lib/dev-logger');
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(devLogger.query).not.toHaveBeenCalled();
    });

    it('does not log when NODE_ENV is unset', async () => {
      delete process.env.NODE_ENV;
      const { devLogger } = await import('@/lib/dev-logger');
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(devLogger.query).not.toHaveBeenCalled();
    });
  });

  describe('transaction query (using transactionStorage)', () => {
    it('uses client.query() when transactionStorage has a client', async () => {
      const { query, transactionStorage } = await import('@/lib/db/client');
      const fakeClient = { query: mocks.clientQuery } as unknown as PoolClient;
      mocks.clientQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      transactionStorage.enterWith(fakeClient);
      const result = await query('INSERT INTO t (n) VALUES ($1)', ['x']);

      expect(mocks.poolQuery).not.toHaveBeenCalled();
      expect(mocks.clientQuery).toHaveBeenCalledWith('INSERT INTO t (n) VALUES ($1)', ['x']);
      expect(result.rows).toEqual([{ id: 1 }]);
    });

    it('does NOT retry when a query fails inside a transaction', async () => {
      const { query, transactionStorage } = await import('@/lib/db/client');
      const fakeClient = { query: mocks.clientQuery } as unknown as PoolClient;
      const err = new Error('ECONNREFUSED');
      mocks.clientQuery.mockRejectedValue(err);

      transactionStorage.enterWith(fakeClient);

      await expect(query('SELECT 1', [], 5)).rejects.toThrow('ECONNREFUSED');
      expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    });

    it('calls console.error and throws on transaction query failure', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { query, transactionStorage } = await import('@/lib/db/client');
      const fakeClient = { query: mocks.clientQuery } as unknown as PoolClient;
      mocks.clientQuery.mockRejectedValue(new Error('txn failure'));

      transactionStorage.enterWith(fakeClient);

      await expect(query('SELECT 1')).rejects.toThrow('txn failure');
      expect(console.error).toHaveBeenCalledWith('[db] query error:', 'txn failure', '|', 'SELECT 1');
    });

    it('logs devLogger.error in dev mode inside a transaction', async () => {
      process.env.NODE_ENV = 'development';
      const { devLogger } = await import('@/lib/dev-logger');
      const { query, transactionStorage } = await import('@/lib/db/client');
      const fakeClient = { query: mocks.clientQuery } as unknown as PoolClient;
      const err = new Error('txn error');
      mocks.clientQuery.mockRejectedValue(err);

      transactionStorage.enterWith(fakeClient);

      await expect(query('SELECT 1')).rejects.toThrow('txn error');
      expect(devLogger.error).toHaveBeenCalledWith(err, 'Database Query', undefined);
    });
  });

  describe('retry logic', () => {
    it('retries and succeeds on ECONNREFUSED', async () => {
      const { query } = await import('@/lib/db/client');
      const err = new Error('connect ECONNREFUSED');
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
      expect(result.rows).toEqual([{ id: 1 }]);
    });

    it('retries up to retries parameter count', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(query('SELECT 1', [], 3)).rejects.toThrow('ECONNREFUSED');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(4);
    });

    it('uses default retries = 2', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(query('SELECT 1')).rejects.toThrow('ECONNREFUSED');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(3);
    });

    it('does not retry when retries = 0', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(query('SELECT 1', [], 0)).rejects.toThrow('ECONNREFUSED');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });

    it('retries on error with message containing ECONNREFUSED', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('something ECONNREFUSED happened');
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on error with code 40001 (serialization failure)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('could not serialize access');
      err.code = '40001';
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on error with code 40P01 (deadlock detected)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('deadlock detected');
      err.code = '40P01';
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on error with code 08006 (connection failure)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('connection failure');
      err.code = '08006';
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on error with code 08001 (unable to connect)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('unable to connect');
      err.code = '08001';
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on ECONNRESET error', async () => {
      const { query } = await import('@/lib/db/client');
      const err = new Error('read ECONNRESET');
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on ETIMEDOUT error', async () => {
      const { query } = await import('@/lib/db/client');
      const err = new Error('ETIMEDOUT');
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries on EPIPE error', async () => {
      const { query } = await import('@/lib/db/client');
      const err = new Error('broken pipe EPIPE');
      mocks.poolQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });

    it('succeeds on first attempt without any retry', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [{ ok: true }], rowCount: 1 });

      const result = await query('SELECT 1');

      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
      expect(result.rows[0]).toEqual({ ok: true });
    });
  });

  describe('non-retryable errors', () => {
    it('does not retry on plain syntax error', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('syntax error at or near "foo"'));

      await expect(query('SELECT foo')).rejects.toThrow('syntax error');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 42703 (undefined column)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('column "x" does not exist');
      err.code = '42703';
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('SELECT x FROM users')).rejects.toThrow();
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 23505 (unique violation)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('INSERT ...')).rejects.toThrow();
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 42P01 (undefined table)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('relation "foo" does not exist');
      err.code = '42P01';
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('SELECT * FROM foo')).rejects.toThrow();
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 22001 (string too long)', async () => {
      const { query } = await import('@/lib/db/client');
      const err: any = new Error('value too long for type character varying');
      err.code = '22001';
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('INSERT ...')).rejects.toThrow();
      expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling and logging', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('logs to console.error on failure', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('syntax error'));

      await expect(query('SELECT bad')).rejects.toThrow('syntax error');
      expect(console.error).toHaveBeenCalledWith('[db] query error:', 'syntax error', '|', 'SELECT bad');
    });

    it('truncates long SQL in console.error to 120 characters', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('err'));
      const longSql = 'SELECT ' + 'x'.repeat(200);

      await expect(query(longSql)).rejects.toThrow('err');
      expect(console.error).toHaveBeenCalledWith('[db] query error:', 'err', '|', longSql.slice(0, 120));
    });

    it('calls devLogger.error in development mode on failure', async () => {
      process.env.NODE_ENV = 'development';
      const { devLogger } = await import('@/lib/dev-logger');
      const { query } = await import('@/lib/db/client');
      const err = new Error('syntax error');
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('SELECT bad')).rejects.toThrow('syntax error');
      expect(devLogger.error).toHaveBeenCalledWith(err, 'Database Query', undefined);
    });

    it('does not call devLogger.error in production mode on failure', async () => {
      process.env.NODE_ENV = 'production';
      const { devLogger } = await import('@/lib/dev-logger');
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('syntax error'));

      await expect(query('SELECT bad')).rejects.toThrow('syntax error');
      expect(devLogger.error).not.toHaveBeenCalled();
    });

    it('re-throws the original error after logging', async () => {
      const { query } = await import('@/lib/db/client');
      const err = new Error('original error message');
      mocks.poolQuery.mockRejectedValue(err);

      await expect(query('SELECT 1')).rejects.toThrow('original error message');
    });

    it('re-throws after all retries are exhausted', async () => {
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(query('SELECT 1', [], 1)).rejects.toThrow('ECONNREFUSED');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry sleeps with backoff', () => {
    it('sleeps between retry attempts (2 retries = 2 sleeps)', async () => {
      vi.useFakeTimers();
      const { query } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      let rejectErr: Error | undefined;
      const promise = query('SELECT 1', [], 2).catch((e: Error) => { rejectErr = e; });
      await vi.advanceTimersByTimeAsync(500);
      await promise; // let the rejection settle

      expect(rejectErr?.message).toBe('ECONNREFUSED');
      expect(mocks.poolQuery).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('queryOne / queryMany helpers', () => {
    it('queryOne returns first row', async () => {
      const { queryOne } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await queryOne('SELECT * FROM users');

      expect(result).toEqual({ id: 1 });
    });

    it('queryOne returns null when no rows', async () => {
      const { queryOne } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await queryOne('SELECT * FROM users WHERE false');

      expect(result).toBeNull();
    });

    it('queryMany returns all rows', async () => {
      const { queryMany } = await import('@/lib/db/client');
      const rows = [{ id: 1 }, { id: 2 }];
      mocks.poolQuery.mockResolvedValue({ rows, rowCount: 2 });

      const result = await queryMany('SELECT * FROM users');

      expect(result).toEqual(rows);
      expect(result).toHaveLength(2);
    });

    it('queryMany returns empty array when no rows', async () => {
      const { queryMany } = await import('@/lib/db/client');
      mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await queryMany('SELECT * FROM users WHERE false');

      expect(result).toEqual([]);
    });

    it('queryOne re-throws errors from query()', async () => {
      const { queryOne } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(queryOne('SELECT 1')).rejects.toThrow('ECONNREFUSED');
    });

    it('queryMany re-throws errors from query()', async () => {
      const { queryMany } = await import('@/lib/db/client');
      mocks.poolQuery.mockRejectedValue(new Error('syntax error'));

      await expect(queryMany('SELECT bad')).rejects.toThrow('syntax error');
    });
  });
});
