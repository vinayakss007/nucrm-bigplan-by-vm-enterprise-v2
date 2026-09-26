/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #674 §2/§8 — Transaction rollback chaos test.
 *
 * "Transaction rollback test: force error in multi-step write, verify no
 * partial data" against a REAL Postgres through the production `db` proxy
 * (drizzle/db.ts) — unit tests elsewhere only mock the transaction callback,
 * so they cannot prove Postgres' atomicity or drizzle's savepoint behaviour.
 *
 * Proven here:
 *   1. A throw in the middle of a multi-insert transaction leaves ZERO rows
 *      (the first two inserts were rolled back with the third).
 *   2. Nested `tx.transaction()` runs on SAVEPOINTs: a failing inner
 *      transaction is rollback-only-partial (its own rows vanish) while the
 *      outer transaction still commits its remaining writes (#674 §2
 *      "nested transaction support").
 *   3. Control: a clean multi-step transaction commits everything.
 *
 * Uses a scratch table created/dropped by the suite itself (no business
 * tables touched) and self-skips when DATABASE_URL is unreachable.
 */
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pgSslConfig } from '@/lib/db/ssl-config';
import { db } from '@/drizzle/db';

const PROBE_TABLE = 'nucrm_rollback_probe_674';
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

describe.skipIf(!dbReachable)('transaction rollback chaos test (#674 §2/§8)', () => {
  // db.execute() hands back the raw driver result; tolerate both the rows
  // array and the { rows } wrapper shape.
  const asRows = <T>(res: unknown): T[] =>
    Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] })?.rows ?? []);

  const rowCount = async (): Promise<number> => {
    const res = await db.execute(sql.raw(`SELECT count(*)::int AS c FROM ${PROBE_TABLE}`));
    return Number(asRows<{ c: number }>(res)[0]?.c ?? -1);
  };

  beforeAll(async () => {
    // Table name is a suite constant — never derived from input.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${PROBE_TABLE}`));
    await db.execute(sql.raw(`CREATE TABLE ${PROBE_TABLE} (step text primary key)`));
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${PROBE_TABLE}`));
  });

  beforeEach(async () => {
    await db.execute(sql.raw(`TRUNCATE ${PROBE_TABLE}`));
  });

  it('leaves no partial rows when a mid-transaction error is thrown', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('a')`));
        await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('b')`));
        throw new Error('forced mid-write failure');
      }),
    ).rejects.toThrow('forced mid-write failure');

    expect(await rowCount()).toBe(0);
  });

  it('rolls back only the failing inner savepoint; outer writes still commit (#674 §2)', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('outer-1')`));
      await expect(
        tx.transaction(async (inner) => {
          await inner.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('inner')`));
          throw new Error('forced inner failure');
        }),
      ).rejects.toThrow('forced inner failure');
      await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('outer-2')`));
    });

    const res = await db.execute(
      sql.raw(`SELECT step FROM ${PROBE_TABLE} ORDER BY step`),
    );
    const steps = asRows<{ step: string }>(res).map((r) => r.step);
    // The outer transaction is NOT aborted by the inner failure: both outer
    // rows committed and the inner savepoint's row vanished.
    expect(steps).toEqual(['outer-1', 'outer-2']);
  });

  it('commits every step of a clean transaction (control)', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('c1')`));
      await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('c2')`));
      await tx.execute(sql.raw(`INSERT INTO ${PROBE_TABLE} (step) VALUES ('c3')`));
    });
    expect(await rowCount()).toBe(3);
  });
});
