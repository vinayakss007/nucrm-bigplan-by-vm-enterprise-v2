/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #674 §8 — Connection-exhaustion chaos test.
 *
 * "Open N+1 connections, verify graceful rejection."
 *
 * Rebuilds the production pool singleton (lib/db/pool.ts getPool()) with a
 * deliberately tiny DATABASE_POOL_SIZE and a short checkout timeout, then:
 *   1. holds all N connections,
 *   2. proves the (N+1)th checkout is REJECTED quickly with pg-pool's
 *      "timeout exceeded when trying to connect" — the exact error
 *      withApiRoute (#2122) converts into 503 + Retry-After — instead of
 *      hanging indefinitely, and
 *   3. proves the pool self-heals: release one client and the next checkout
 *      succeeds immediately.
 *
 * Skips itself (no failure) when the Postgres from DATABASE_URL is not
 * reachable, so sandboxes without a DB stay green while CI (postgres:16
 * service) runs it for real.
 */
import { Pool } from 'pg';
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { pgSslConfig } from '@/lib/db/ssl-config';

const databaseUrl = process.env.DATABASE_URL as string | undefined;

async function probe(): Promise<boolean> {
  if (!databaseUrl) return false;
  const p = new Pool({
    connectionString: databaseUrl,
    ssl: pgSslConfig(),
    max: 1,
    connectionTimeoutMillis: 1_500,
    idleTimeoutMillis: 1_000,
  });
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await p.end().catch(() => undefined);
  }
}

const dbReachable = await probe();

describe.skipIf(!dbReachable)('pool exhaustion chaos test (#674 §8)', () => {
  let pool: Pool | undefined;

  const g = globalThis as { __pgPool?: Pool | undefined };

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    pool = undefined;
    g.__pgPool = undefined;
  });

  afterAll(async () => {
    delete process.env.DATABASE_POOL_SIZE;
    delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
  });

  it('rejects the N+1th checkout fast, then recovers on release', async () => {
    process.env.DATABASE_POOL_SIZE = '2';
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = '1200';
    g.__pgPool = undefined; // force getPool() to pick up the chaos-sized config

    const { getPool } = await import('@/lib/db/pool');
    pool = getPool();

    const c1 = await pool.connect();
    const c2 = await pool.connect();

    const started = Date.now();
    let checkoutError: Error | undefined;
    try {
      const c3 = await pool.connect();
      c3.release();
    } catch (err) {
      checkoutError = err as Error;
    }
    const elapsedMs = Date.now() - started;

    expect(checkoutError, 'N+1th checkout must be rejected, not hang').toBeDefined();
    // Exact signature withApiRoute maps to 503 + Retry-After (#2122/#2133):
    expect(checkoutError.message).toMatch(/timeout exceeded when trying to connect/i);
    // Fast-fail budget: bounded by the 1.2s connectionTimeoutMillis, and far
    // below the old 30s queue that made saturation so toxic in the stress pass.
    expect(elapsedMs).toBeLessThan(3_000);

    // Self-heal: one release makes room; the next checkout succeeds right away.
    c2.release();
    const c3 = await pool.connect();
    const res = await c3.query('SELECT 1 AS ok');
    expect(res.rows[0]).toEqual({ ok: 1 });
    c3.release();
    c1.release();

    expect(pool.waitingCount).toBe(0);
  });
});
