/**
 * #2393 — the auto-backup liveness filters, executed against a real database.
 *
 * The unit suite proves the cron ROUTE issues these statements; this file
 * proves the statements do what they claim, which no mock can — the exclusion
 * happens in Postgres' executor.
 *
 * The bug: deleting a tenant is a tombstone UPDATE, so
 * `backup_schedules … ON DELETE cascade` never fires and the gone tenant keeps
 * an `enabled = true` schedule. The old selection read only
 * `enabled`/`next_run_at`, and the one tenant predicate it did have
 * (`status != 'suspended'`) was both the wrong column and the wrong vocabulary.
 *
 * The last test is the negative control: it re-runs the pre-fix predicate over
 * the same rows and asserts it DOES return the stale schedules. Without it a
 * green suite would only prove that nothing is ever due.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/superadmin-panel-sql.test.ts, and deletes every row it adds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  dueSchedulesSql,
  globalScheduleExistsSql,
  liveTenantIdsSql,
  tenantBackupRowSql,
  tenantIsLive,
} from '../../lib/cron/auto-backup-sql';

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const probe = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await probe.connect();
    client.release();
    await probe.end();
    return true;
  } catch {
    await probe.end().catch(() => {});
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();
const d = dbAvailable ? describe : describe.skip;

const dialect = new PgDialect();
function render(node: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(node as never) as { sql: string; params: unknown[] };
  return { sql: q.sql, params: q.params ?? [] };
}

let pool: Pool;
const LIVE_TENANT = randomUUID();
const TOMBSTONED_TENANT = randomUUID();
const DELETED_STATUS_TENANT = randomUUID();
const SUSPENDED_TENANT = randomUUID();

async function q(sqlText: string, params: unknown[] = []) {
  return pool.query(sqlText, params);
}

async function run(node: unknown) {
  const { sql, params } = render(node);
  return (await q(sql, params)).rows;
}

async function dueScheduleTenantIds(): Promise<(string | null)[]> {
  const rows = await run(dueSchedulesSql()) as Array<{ tenant_id: string | null }>;
  return rows.map((r) => r.tenant_id);
}

/** `enabled`/`next_run_at` only — the predicate as it stood before #2393. */
async function dueScheduleTenantIdsPreFix(): Promise<(string | null)[]> {
  const { rows } = await q(`
    SELECT tenant_id FROM backup_schedules
    WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())`);
  return rows.map((r: { tenant_id: string | null }) => r.tenant_id);
}

type SchedOpts = {
  tenantId?: string | null;
  enabled?: boolean;
  deletedAt?: Date | null;
};

// next_run_at is bound as raw SQL text because the two cases are NOW()±, which
// a parameter cannot express without a cast.
const NOW_PAST = "NOW() - INTERVAL '1 hour'";
const NOW_FUTURE = "NOW() + INTERVAL '1 day'";

const createdSchedules: string[] = [];

async function seedSchedule(opts: SchedOpts & { nextRunAt: string }) {
  const id = randomUUID();
  createdSchedules.push(id);
  await q(`
    INSERT INTO backup_schedules
      (id, tenant_id, schedule_type, backup_type, retention_days, enabled, next_run_at, deleted_at)
    VALUES ($1, $2, 'daily', 'full', 90, $3, ${opts.nextRunAt}, $4)`,
  [
    id,
    opts.tenantId === undefined ? LIVE_TENANT : opts.tenantId,
    opts.enabled ?? true,
    opts.deletedAt ?? null,
  ]);
  return id;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  const rows: Array<[string, string, Date | null]> = [
    [LIVE_TENANT, 'trialing', null],
    [TOMBSTONED_TENANT, 'suspended', new Date()],
    [DELETED_STATUS_TENANT, 'deleted', null],
    [SUSPENDED_TENANT, 'suspended', null],
  ];
  for (const [id, status, deletedAt] of rows) {
    await q(`INSERT INTO tenants (id, name, slug, status, deleted_at)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [id, `t ${id.slice(0, 8)}`, `t-${id.slice(0, 8)}-${status}`, status, deletedAt]);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM backup_schedules WHERE id = ANY($1::uuid[])`, [createdSchedules]);
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
    [LIVE_TENANT, TOMBSTONED_TENANT, DELETED_STATUS_TENANT, SUSPENDED_TENANT],
  ]);
  await pool.end();
});

d('auto-backup tenant liveness (#2393)', () => {
  it('a live tenant with a due schedule is selected', async () => {
    await seedSchedule({ tenantId: LIVE_TENANT, nextRunAt: NOW_PAST });
    expect(await dueScheduleTenantIds()).toContain(LIVE_TENANT);
  });

  it('a tombstoned tenant keeps its enabled schedule, but is not selected', async () => {
    const id = await seedSchedule({ tenantId: TOMBSTONED_TENANT, nextRunAt: NOW_PAST });
    expect(await dueScheduleTenantIds()).not.toContain(TOMBSTONED_TENANT);
    // The row is still sitting there with enabled = true — that is the whole
    // point: the cascade never fired, so filtering is the only defence left.
    const { rows } = await q('SELECT enabled FROM backup_schedules WHERE id = $1', [id]);
    expect(rows[0].enabled).toBe(true);
  });

  it('a status-only vocabulary for "gone" is not selected either', async () => {
    await seedSchedule({ tenantId: DELETED_STATUS_TENANT, nextRunAt: NOW_PAST });
    await seedSchedule({ tenantId: SUSPENDED_TENANT, nextRunAt: NOW_PAST });
    const due = await dueScheduleTenantIds();
    expect(due).not.toContain(DELETED_STATUS_TENANT);
    expect(due).not.toContain(SUSPENDED_TENANT);
  });

  it('the platform-wide schedule has no tenant to be alive, so it stays eligible', async () => {
    await seedSchedule({ tenantId: null, nextRunAt: NOW_PAST });
    expect(await dueScheduleTenantIds()).toContain(null);
  });

  it('honours the schedule tombstone, enabled=false and a future next_run_at', async () => {
    await seedSchedule({ tenantId: LIVE_TENANT, deletedAt: new Date(), nextRunAt: NOW_PAST });
    await seedSchedule({ tenantId: LIVE_TENANT, enabled: false, nextRunAt: NOW_PAST });
    await seedSchedule({ tenantId: LIVE_TENANT, nextRunAt: NOW_FUTURE });
    // Three new schedules, none of them due — and a live one IS still due from
    // the first test, so "empty result" is not what is being asserted here.
    const due = await dueScheduleTenantIds();
    expect(due.filter((t) => t === LIVE_TENANT)).toHaveLength(1);
  });

  it('the default-schedule probe does not count a tombstoned global schedule', async () => {
    // Transaction-scoped: this statement is global by nature, so the fixtures
    // live inside a transaction that is rolled back at the end.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM backup_schedules WHERE tenant_id IS NULL');
      await client.query(`
        INSERT INTO backup_schedules
          (id, tenant_id, schedule_type, backup_type, retention_days, enabled, next_run_at, deleted_at)
        VALUES ($1, NULL, 'monthly', 'full', 90, true, NOW(), NOW())`, [randomUUID()]);

      const { sql, params } = render(globalScheduleExistsSql());
      expect((await client.query(sql, params)).rows).toHaveLength(0);

      // The pre-fix probe counted that tombstone, so a platform whose only
      // global schedule had been deleted never got its default recreated.
      const preFix = await client.query(
        'SELECT 1 FROM backup_schedules WHERE tenant_id IS NULL LIMIT 1');
      expect(preFix.rows).toHaveLength(1);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('the live-tenant list excludes every gone spelling', async () => {
    const ids = (await run(liveTenantIdsSql()) as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(LIVE_TENANT);
    expect(ids).not.toContain(TOMBSTONED_TENANT);
    expect(ids).not.toContain(DELETED_STATUS_TENANT);
    expect(ids).not.toContain(SUSPENDED_TENANT);
  });

  it('the per-tenant probe returns the liveness columns the guard reads', async () => {
    const tombstoned = await run(tenantBackupRowSql(TOMBSTONED_TENANT));
    expect(tombstoned).toHaveLength(1);
    expect(tenantIsLive(tombstoned[0] as never)).toBe(false);

    const live = await run(tenantBackupRowSql(LIVE_TENANT));
    expect(tenantIsLive(live[0] as never)).toBe(true);

    // A hard-erased tenant matches nothing, which is also "gone".
    expect(await run(tenantBackupRowSql(randomUUID()))).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: the pre-fix predicate returns all of them', async () => {
    const stale = await dueScheduleTenantIdsPreFix();
    expect(stale).toContain(TOMBSTONED_TENANT);
    expect(stale).toContain(DELETED_STATUS_TENANT);
    expect(stale).toContain(SUSPENDED_TENANT);
    // And the new one does not — the two disagree on exactly the gone tenants.
    expect(await dueScheduleTenantIds()).not.toContain(TOMBSTONED_TENANT);
  });
});
