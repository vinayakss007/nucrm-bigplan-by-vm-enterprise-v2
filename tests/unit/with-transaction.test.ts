/**
 * Tests for lib/api/with-transaction.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type { DbClient } from '@/drizzle/db';

const mockExecute = vi.fn();

// Simulate Drizzle's transaction method
const mockTransaction = vi.fn();

const mockDbClient = {
  transaction: mockTransaction,
} as unknown as DbClient;

vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown, message: string, status: number) =>
    NextResponse.json({ error: message }, { status }),
}));

// We don't need to mock drizzle-orm's sql since we test the wrapper logic
vi.mock('drizzle-orm', () => ({
  sql: {
    raw: (s: string) => ({ rawQuery: s }),
  },
}));

describe('withTransaction', () => {
  beforeEach(() => {
    vi.resetModules();
    mockTransaction.mockReset();
    mockExecute.mockReset();
  });

  it('executes handler in a transaction and returns the response', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      mockExecute.mockResolvedValue(undefined);
      return fn(tx);
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    const response = await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ id: '123' }, { status: 201 }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('123');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('sets statement_timeout inside the transaction', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      mockExecute.mockResolvedValue(undefined);
      return fn(tx);
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
      { timeoutMs: 5000 },
    );

    expect(mockExecute).toHaveBeenCalledWith({ rawQuery: "SET LOCAL statement_timeout = '5000'" });
  });

  it('retries on serialization failure (40001)', async () => {
    let attempts = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      attempts++;
      const tx = { execute: mockExecute };
      mockExecute.mockResolvedValue(undefined);
      if (attempts === 1) {
        const err: Error & { code?: string } = new Error('serialization failure');
        err.code = '40001';
        throw err;
      }
      return fn(tx);
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    const response = await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('retries on deadlock (40P01)', async () => {
    let attempts = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      attempts++;
      const tx = { execute: mockExecute };
      mockExecute.mockResolvedValue(undefined);
      if (attempts <= 2) {
        const err: Error & { code?: string } = new Error('deadlock detected');
        err.code = '40P01';
        throw err;
      }
      return fn(tx);
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    const response = await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
      { maxRetries: 3 },
    );

    expect(response.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(3);
  });

  it('returns 500 after exhausting retries', async () => {
    mockTransaction.mockImplementation(async () => {
      const err: Error & { code?: string } = new Error('serialization failure');
      err.code = '40001';
      throw err;
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    const response = await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
      { maxRetries: 1, label: 'test-txn' },
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('test-txn');
  });

  it('does NOT retry non-retryable errors', async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Error('unique constraint violation');
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    const response = await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
    );

    expect(response.status).toBe(500);
    expect(mockTransaction).toHaveBeenCalledTimes(1); // No retry
  });

  it('uses default options when none specified', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      mockExecute.mockResolvedValue(undefined);
      return fn(tx);
    });

    const { withTransaction } = await import('@/lib/api/with-transaction');

    await withTransaction(
      mockDbClient,
      async () => NextResponse.json({ ok: true }),
    );

    // Default timeout is 15000
    expect(mockExecute).toHaveBeenCalledWith({ rawQuery: "SET LOCAL statement_timeout = '15000'" });
  });
});
