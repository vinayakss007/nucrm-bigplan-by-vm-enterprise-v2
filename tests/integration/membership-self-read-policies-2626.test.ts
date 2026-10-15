/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2626 — the self-scoped membership reads, proven on a live catalogue.
 *
 * WHY A LIVE RUN (and why tests/unit/membership-self-rls-2626.test.ts
 * alone is not enough): a mocked db has no policy executor. The exact failure
 * mode was invisible to mocks for two years — pg_policy rows that look present
 * to the superuser CI login role but match zero rows for the ordinary user who
 * actually triggers them. So this suite mints a NOSUPERUSER/NOBYPASSRLS probe
 * (#2474 helper), inserts two workspaces' fixtures on the superuser connection,
 * and reads tenant_members/roles AS the restricted role under the three GUC
 * states requireAuth produces: app.current_user set, empty (reset), absent.
 *
 * The migration file is applied idempotently in beforeAll (drop-then-create
 * shape), so this passes both on a CI database that already ran `db:migrate`
 * and on one that has not seen 0127 yet.
 *
 * Self-skips when no database is reachable, like rls-policy-shape-2438.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ensureRlsProbeRole,
  probeRoleClientFromPool,
  releaseRlsProbeRole,
  type ProbeRoleHandle,
} from '../helpers/rls-probe-role';

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  try {
    const probe = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, max: 1 });
    await probe.query('SELECT 1');
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable();

const PROBE_ROLE = 'rls_2626_probe_role';
const MIGRATION = readFileSync('drizzle/migrations/0127_membership_self_scoped_select.sql', 'utf8');

let pool: Pool;
let probe: ProbeRoleHandle | undefined;

const tenantA = randomUUID();
const tenantB = randomUUID();
const roleA = randomUUID();
const roleB = randomUUID();
const userA = randomUUID();   // active member of tenantA
const userB = randomUUID();   // active member of tenantB
const userPending = randomUUID(); // PENDING member of tenantA — must stay invisible
const memberIds: string[] = [];

interface Read { n: number }

async function readAsProbe(
  sql: string,
  currentUser: string | null,
  params: unknown[] = [],
): Promise<Read[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${PROBE_ROLE}"`);
    if (currentUser !== null) {
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [currentUser]);
    }
    const res = await client.query(sql, params as never[]);
    await client.query('ROLLBACK');
    return res.rows as Read[];
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

describe.skipIf(!dbAvailable)('membership self-scoped SELECT policies (#2626)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

    await pool.query(MIGRATION);
    probe = await ensureRlsProbeRole(probeRoleClientFromPool(pool), PROBE_ROLE);

    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Self Read A', $2), ($3, 'Self Read B', $4)`,
      [tenantA, `sr-a-${tenantA.slice(0, 8)}`, tenantB, `sr-b-${tenantB.slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO roles (id, tenant_id, name, slug) VALUES
         ($1, $2, 'Rep A', 'sales_rep'), ($3, $4, 'Rep B', 'sales_rep')`,
      [roleA, tenantA, roleB, tenantB],
    );
    for (const [id, tag] of [[userA, 'a'], [userB, 'b'], [userPending, 'p']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`,
        [id, `rls-2626-${tag}-${id.slice(0, 8)}@example.invalid`, `R2626 ${tag}`],
      );
    }
    const mk = async (userId: string, tenantId: string, roleId: string, status: string) => {
      const res = await pool.query(
        `INSERT INTO tenant_members (tenant_id, user_id, role_id, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, userId, roleId, status],
      );
      memberIds.push(res.rows[0].id as string);
    };
    await mk(userA, tenantA, roleA, 'active');
    await mk(userB, tenantB, roleB, 'active');
    await mk(userPending, tenantA, roleA, 'pending');
  });

  afterAll(async () => {
    if (!pool) return;
    if (memberIds.length) {
      await pool.query(`DELETE FROM tenant_members WHERE id = ANY($1::uuid[])`, [memberIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM roles WHERE id = ANY($1::uuid[])`, [[roleA, roleB]]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[userA, userB, userPending]]).catch(() => {});
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => {});
    if (probe) {
      const leaks = await releaseRlsProbeRole(probeRoleClientFromPool(pool), probe, { dropRole: true });
      for (const leak of leaks) console.warn(`[2626 rls] could not unwind the probe role: ${leak}`);
    }
    await pool.end();
  });

  it('shows a proven user its own active membership', async () => {
    const rows = await readAsProbe(
      `SELECT count(*)::int AS n FROM tenant_members WHERE user_id = $1`, [userA], userA,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('context-less reads DENY (zero rows) instead of aborting the statement', async () => {
    const rows = await readAsProbe(`SELECT count(*)::int AS n FROM tenant_members`, null);
    expect(rows[0]?.n).toBe(0);
  });

  it('an empty (reset) app.current_user cannot cast-match or leak rows', async () => {
    const rows = await readAsProbe(`SELECT count(*)::int AS n FROM tenant_members`, '');
    expect(rows[0]?.n).toBe(0);
  });

  it('pending memberships stay invisible even to their own user', async () => {
    const rows = await readAsProbe(
      `SELECT count(*)::int AS n FROM tenant_members WHERE user_id = $1`, [userPending], userPending,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('the roles arm admits exactly the role of the user''s active membership', async () => {
    const rows = await readAsProbe(
      `SELECT count(*)::int AS n FROM roles WHERE id = $1`, [roleA], userA,
    );
    expect(rows[0]?.n).toBe(1);
    const other = await readAsProbe(
      `SELECT count(*)::int AS n FROM roles WHERE id = $1`, [roleB], userA,
    );
    expect(other[0]?.n).toBe(0);
  });

  it('requireAuth''s exact join shape returns a membership row with permissions', async () => {
    const joined = await readAsProbe(
      `SELECT count(*)::int AS n
         FROM users u
         INNER JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
         LEFT JOIN roles r ON r.id = tm.role_id
        WHERE u.id = $1`, [userA], userA,
    );
    expect(joined[0]?.n).toBe(1);
  });
});
