/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2826 on a real PostgreSQL — the leg a unit test cannot cover.
 *
 * `tests/unit/trash-auto-cleanup-total-2826.test.ts` drives the handlers with a fake `db`
 * that returns what node-postgres returns, which proves the arithmetic. What only a live
 * server can prove is that the query the handler now runs returns a JS **number**: that is
 * a property of drizzle's `count()` decoder against this driver, not of this repo's code.
 *
 * Both halves are asserted here, plus the ground truth the total must match — one SQL
 * statement that adds the same five counts server-side:
 *
 *   contacts 3 | companies 2 | deals 0 | tasks 1 | leads 4   →  10
 *
 * The zero in the middle is the point: `"3" + "2" + "0" + "1" + "4"` is `"32014"`, so an
 * empty table shifts every digit after it instead of contributing nothing.
 *
 * Self-skips when no database is reachable, like the other integration suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, count as drizzleCount, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { contacts, companies, deals, leads, tasks } from '@/drizzle/schema';
import type { DbClient } from '@/drizzle/db';

const TENANT = '00000000-0000-4000-8000-000000002826';
/** contacts 3, companies 2, deals 0 (never inserted), tasks 1, leads 4. */
const EXPECTED_TOTAL = 10;
const CUTOFF = new Date(Date.now() - 30 * 86_400_000);
const NAME_OF = {
  contacts: 'first_name',
  companies: 'name',
  tasks: 'title',
  leads: 'first_name',
} as const;

type TrashTable = typeof contacts | typeof companies | typeof deals | typeof tasks | typeof leads;

/** The route's own predicate, on one tenant's tombstones past the retention window. */
function trashed(table: TrashTable) {
  return and(eq(table.tenantId, TENANT), isNotNull(table.deletedAt), lt(table.deletedAt, CUTOFF));
}

async function connect(): Promise<{ pool: Pool; client: PoolClient } | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { Pool: PgPool } = await import('pg');
  const pool = new PgPool({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    return { pool, client };
  } catch {
    await pool.end().catch(() => {});
    return null;
  }
}

const connection = await connect();
const d = connection ? describe : describe.skip;
const client = connection?.client;
const pool = connection?.pool;

d('#2826 the counts the trash panel adds are numbers on a real server', () => {
  let db: DbClient;

  beforeAll(async () => {
    if (!client) return;
    // FORCE RLS hides these rows from a connection with no tenant pinned, so pin the probe
    // tenant before drizzle reads through this client.
    await client.query(`SELECT set_config('app.is_super_admin', 'true', false)`);
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT]);
    db = drizzle(client) as unknown as DbClient;

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'probe 2826', $2)
       ON CONFLICT (id) DO NOTHING`,
      [TENANT, `probe-2826-${Date.now()}`],
    );
    // 3 / 2 / 1 / 4 tombstones, all 90 days past — and no deals row, which is what makes
    // the concatenation observable rather than merely wrong.
    for (const [table, n] of Object.entries({ contacts: 3, companies: 2, tasks: 1, leads: 4 })) {
      await client.query(
        `INSERT INTO ${table} (tenant_id, ${NAME_OF[table as keyof typeof NAME_OF]}, deleted_at)
         SELECT $1, 'probe2826 ' || g, now() - interval '90 days' FROM generate_series(1, $2) g`,
        [TENANT, n],
      );
    }
  });

  afterAll(async () => {
    if (!client || !pool) return;
    for (const table of ['contacts', 'companies', 'leads', 'tasks', 'deals']) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
    }
    await client.query(`DELETE FROM tenants WHERE id = $1`, [TENANT]);
    client.release();
    await pool.end();
  });

  it('the fragment the route used to run returns a string, which is the whole bug', async () => {
    // Tripwire, not a permanent fact: if the repo ever registers a `numeric`/`int8`
    // `setTypeParser` — #2774's open contract-wide decision — this stops being true and the
    // coercion in the handler becomes redundant rather than wrong.
    const rows = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(trashed(contacts));
    expect(typeof rows[0]!.count, 'int8 arrives as a string: node-postgres, no setTypeParser')
      .toBe('string');
    expect(String(rows[0]!.count)).toBe('3');
  });

  it('count() returns the number the response promises', async () => {
    const rows = await db.select({ count: drizzleCount() }).from(contacts).where(trashed(contacts));
    expect(typeof rows[0]!.count).toBe('number');
    expect(rows[0]!.count).toBe(3);
  });

  it('the handler sum equals what the server itself adds', async () => {
    const perTable = await Promise.all([
      db.select({ count: drizzleCount() }).from(contacts).where(trashed(contacts)),
      db.select({ count: drizzleCount() }).from(companies).where(trashed(companies)),
      db.select({ count: drizzleCount() }).from(deals).where(trashed(deals)),
      db.select({ count: drizzleCount() }).from(tasks).where(trashed(tasks)),
      db.select({ count: drizzleCount() }).from(leads).where(trashed(leads)),
    ]);
    const counts = perTable.map((r) => Number(r[0]?.count ?? 0));
    expect(counts, '3 / 2 / 0 / 1 / 4').toEqual([3, 2, 0, 1, 4]);
    const summed = counts.reduce((a, b) => a + b, 0);

    const { rows } = await client!.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM contacts  WHERE tenant_id = $1 AND deleted_at < now() - interval '30 days')
            + (SELECT count(*) FROM companies  WHERE tenant_id = $1 AND deleted_at < now() - interval '30 days')
            + (SELECT count(*) FROM deals      WHERE tenant_id = $1 AND deleted_at < now() - interval '30 days')
            + (SELECT count(*) FROM tasks      WHERE tenant_id = $1 AND deleted_at < now() - interval '30 days')
            + (SELECT count(*) FROM leads      WHERE tenant_id = $1 AND deleted_at < now() - interval '30 days') AS total`,
      [TENANT],
    );
    expect(summed, 'the number the panel shows').toBe(EXPECTED_TOTAL);
    expect(summed).toBe(Number(rows[0]!.total));

    // The pre-fix expression over the same values: glue, not a sum.
    expect(counts.map(String).join('')).toBe('32014');
    expect(Number(counts.map(String).join(''))).not.toBe(EXPECTED_TOTAL);
  });
});
