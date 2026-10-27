/**
 * #3302 — the whole-population FORCE RLS census, run against a real server.
 *
 * WHY THIS IS NOT JUST THE UNIT TEST WITH A DIFFERENT NAME
 * --------------------------------------------------------
 * `tests/unit/force-rls-census-3302.test.ts` hands `evaluateForceRlsCensus` rows it
 * was written from a description of `pg_class`. Two of this file's assertions can only
 * be made by Postgres:
 *
 *   1. that `FULL_FORCE_RLS_CENSUS_SQL` returns the flags the census reads, in the
 *      types the driver hands back — a catalog query whose aliases drift is a screen
 *      that quietly reports zero offenders; and
 *   2. that re-running `ENABLE ROW LEVEL SECURITY` does not restore a `FORCE` that was
 *      removed. The static rule in `check-migration-rls-dml.mjs` decides table coverage
 *      by *first* enable, and its "a FORCE earlier in the chain still counts" case
 *      rests entirely on that. If Postgres cleared `relforcerowsecurity` on re-enable,
 *      the rule would be wrong about 0088, 0107 and every pre-auth hardening file.
 *
 * It also measures the claim the issue actually makes: the two existing screens do not
 * merely report `ai_providers` badly, they never include it. That is asserted by
 * running their own `tenant_id` join against the live catalog and showing the table is
 * absent from it while the census names it.
 *
 * NOTHING IS LEFT APPLIED. Every `ALTER` runs inside a transaction that ends in
 * `ROLLBACK`, and the file re-reads the census after each rollback to prove the
 * revert happened. Applying `0141_ai_providers_force_rls.sql` for real is the owner's
 * deploy step (#2537 keeps that backlog pending); this file is a verifier, the same
 * posture `scripts/db-state.ts` takes.
 *
 * Self-skips when no database is reachable, like the other integration specs.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

import {
  FULL_FORCE_RLS_CENSUS_SQL,
  TENANT_TABLE_OWNERSHIP_SQL,
  evaluateForceRlsCensus,
  formatForceRlsCensus,
  type ForceRlsCensusRow,
} from '@/lib/db/least-privilege';

async function isDatabaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    client.release();
    await pool.end();
    return true;
  } catch {
    await pool.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

/** The tenant-scoped criterion both existing screens use, verbatim from their SQL. */
const TENANT_SCOPED_NAMES_SQL = `
  SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attisdropped = false
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'uuid'
   WHERE n.nspname = 'public' AND c.relkind = 'r'
`;

d('the whole-population FORCE RLS census, against Postgres (#3302)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  const censusOn = async (client: { query: (sql: string) => Promise<{ rows: ForceRlsCensusRow[] }> }) =>
    evaluateForceRlsCensus((await client.query(FULL_FORCE_RLS_CENSUS_SQL)).rows);

  it('reads the live catalog in the shape the evaluator claims', async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{
        table_name: string; rls_enabled: boolean; rls_forced: boolean; is_owner: boolean; has_policy: boolean;
      }>(FULL_FORCE_RLS_CENSUS_SQL);
      expect(rows.length).toBeGreaterThan(100);
      // The five aliases, or the census reads `undefined` as false and reports a
      // perfect score on a schema it did not actually look at.
      expect(Object.keys(rows[0]!).sort()).toEqual(
        ['has_policy', 'is_owner', 'rls_enabled', 'rls_forced', 'table_name'].sort(),
      );
      expect(typeof rows[0]!.rls_enabled).toBe('boolean');
    } finally {
      client.release();
    }
  });

  it('names ai_providers when its FORCE is removed, and stops naming it once the rollback lands', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE "ai_providers" NO FORCE ROW LEVEL SECURITY');
      const broken = await censusOn(client);
      expect(broken.unforced).toContain('ai_providers');
      expect(broken.rlsForced).toBe(broken.rlsEnabled - 1);
      expect(formatForceRlsCensus(broken)).toMatch(/not forced: .*ai_providers/);
      expect(broken.ok).toBe(false);
      await client.query('ROLLBACK');

      const healed = await censusOn(client);
      expect(healed.unforced).not.toContain('ai_providers');
      expect(healed.rlsForced).toBe(healed.rlsEnabled);
      expect(healed.ok).toBe(true);
    } finally {
      client.release();
    }
  });

  it('…which is the point: the tenant-scoped screens never include that table at all', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE "ai_providers" NO FORCE ROW LEVEL SECURITY');
      const census = await censusOn(client);
      const scoped = await client.query<{ table_name: string }>(TENANT_SCOPED_NAMES_SQL);
      const names = scoped.rows.map((r) => r.table_name);

      // Not "reported wrong" — absent. A screen whose denominator is this join cannot
      // print a finding about a table with no uuid tenant_id column, however careful
      // its arithmetic is: ai_providers is in the census and not in the 194.
      expect(census.unforced).toContain('ai_providers');
      expect(names).not.toContain('ai_providers');
      expect(names.length).toBeLessThan(census.total);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('re-running ENABLE does not clear FORCE, which is what makes the static rule temporal', async () => {
    // The unit fixture asserts a FORCE *earlier* in the chain covers a later enable.
    // That is only sound if Postgres leaves relforcerowsecurity alone across an ENABLE,
    // so it is measured here rather than assumed.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE "ai_providers" NO FORCE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY');
      const afterReEnable = await censusOn(client);
      expect(afterReEnable.unforced).toContain('ai_providers');

      await client.query('ALTER TABLE "ai_providers" FORCE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE "ai_providers" ENABLE ROW LEVEL SECURITY');
      const afterReForce = await censusOn(client);
      expect(afterReForce.unforced).not.toContain('ai_providers');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('the ownership probe and the census disagree in exactly the direction #3302 describes', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE "ai_providers" NO FORCE ROW LEVEL SECURITY');
      const own = await client.query<{ unforced_owned: number; owned: number }>(
        TENANT_TABLE_OWNERSHIP_SQL,
      );
      const census = await censusOn(client);
      await client.query('ROLLBACK');

      // The role probe can be a perfect zero while the census is red. `unforced_owned`
      // counts FORCE-less tables the current role owns *that have a uuid tenant_id*, so
      // on the shipped superuser topology it reads 0 for a schema with an offender.
      expect(Number(own.rows[0]!.unforced_owned)).toBe(0);
      expect(census.unforced).toContain('ai_providers');
    } finally {
      client.release();
    }
  });

  it('leaves nothing applied', async () => {
    const client = await pool.connect();
    try {
      const census = await censusOn(client);
      expect(census.ok).toBe(true);
      expect(census.unforced).toEqual([]);
    } finally {
      client.release();
    }
  });
});
