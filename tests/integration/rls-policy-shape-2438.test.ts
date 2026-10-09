/**
 * #2438 — a missing tenant context must DENY, never ABORT.
 *
 * WHY THIS RUNS AGAINST A REAL DATABASE
 * -------------------------------------
 * The defect is a Postgres-level behaviour difference between
 * `current_setting('app.current_tenant')` (one argument: raises
 * `unrecognized configuration parameter`, aborting the statement) and
 * `current_setting('app.current_tenant', true)` (two arguments: returns NULL, so
 * the policy compares against NULL and denies the row). Nothing in a mock can
 * distinguish those — the abort happens in the executor, and a mocked `db` has
 * no executor. Two further facts make a live run mandatory rather than merely
 * convenient:
 *
 *   1. The roles the tests would otherwise run as are blind to it. CI connects
 *      as the `postgres` SUPERUSER and superusers bypass RLS even under
 *      `FORCE ROW LEVEL SECURITY`, so every assertion written from the test
 *      connection's own perspective passes regardless of the policy. This suite
 *      therefore creates a NOSUPERUSER / NOBYPASSRLS role and `SET ROLE`s to it,
 *      the only way to be genuinely subject to the policy.
 *   2. The catalogue comparison has to be made against real `pg_get_expr`
 *      output. `tests/unit/rls-policy-shape-guard-2438.test.ts` pins the
 *      detector against captured deparse strings; this file runs the *same
 *      exported SQL* through Postgres, so the POSIX evaluation, the
 *      `polqual`/`polwithcheck` UNION and the discovery floor are all proven on
 *      a live catalogue rather than assumed.
 *
 * WHAT EACH TEST LOCKS DOWN
 * -------------------------
 *  - the whole-schema sweep reports `pass` on a provisioned schema, and the
 *    `contacts` policy in particular is the fail-closed form;
 *  - NON-VACUITY: a scratch table carrying `0037`'s strict pair IS named, in
 *    both halves of the policy. Without this control "0 offenders" is
 *    indistinguishable from a detector that matches nothing — which is how
 *    `0039:79-81`'s per-table `RAISE WARNING` hid a skipped table in the first
 *    place;
 *  - the behaviour itself: as the restricted role, with the GUC never set,
 *    `SELECT count(*) FROM contacts` returns 0 and does not raise, while a
 *    context-less INSERT is rejected by `row-level security` (42501) and not by
 *    an unknown-parameter error.
 *
 * Self-skips when no database is reachable, like
 * tests/integration/superadmin-panel-sql.test.ts, and drops every role, table,
 * policy and row it creates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { dropRlsProbeRole, ensureRlsProbeRole, withOwnerSession } from '../helpers/rls-probe-role-2474';
import {
  MIN_POLICY_EXPRESSIONS,
  buildShapeSweepSql,
  parseShapeSweep,
  evaluateShapeSweep,
} from '../../scripts/rls-policy-shape.mjs';

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

/** Ordinary role that RLS is actually enforced against. */
const PROBE_ROLE = 'rls_shape_2438_role';
/** Scratch table used to prove the sweep detects the aborting shape. */
const SCRATCH = 'rls_2438_scratch';
/** `0037:239` + `0037:247-249`, verbatim — the shape that must be detected. */
const STRICT_PAIR = `(tenant_id)::text = current_setting('app.current_tenant')`;

let pool: Pool;
const tenantA = randomUUID();
const tenantB = randomUUID();
const contactIds: string[] = [];

async function sweep(): Promise<ReturnType<typeof parseShapeSweep>> {
  const res = await pool.query(buildShapeSweepSql());
  // Same three columns the CI script reads out of `psql -t -A -F'|'`, routed
  // through the same parser so neither side can drift from the other.
  const row = res.rows[0] ?? {};
  return parseShapeSweep(`${row.strict_count}|${row.offenders ?? ''}|${row.total}`);
}

async function contactsPolicy(): Promise<{ using: string; check: string | null }> {
  const res = await pool.query(
    `SELECT pg_get_expr(p.polqual, p.polrelid)::text AS using_expr,
            pg_get_expr(p.polwithcheck, p.polrelid)::text AS check_expr
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = 'contacts' AND p.polname = 'tenant_isolation'`,
  );
  return { using: res.rows[0]?.using_expr ?? '', check: res.rows[0]?.check_expr ?? null };
}

describe.skipIf(!dbAvailable)('fail-closed tenant_isolation (#2438)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

    // Privileges arrive through role membership, not object ACLs: the
    // `GRANT USAGE ON SCHEMA public` this replaced is an UPDATE of one hot
    // pg_namespace row that four suites were racing (#2474), and
    // tests/helpers/rls-probe-role-2474.ts is what measures the swap.
    await withOwnerSession(() => pool.connect(), (runDdl) => ensureRlsProbeRole(runDdl, PROBE_ROLE));

    await pool.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Shape Sweep A', $2), ($3, 'Shape Sweep B', $4)
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `shape-a-${tenantA.slice(0, 8)}`, tenantB, `shape-b-${tenantB.slice(0, 8)}`],
    );
    for (const [tenant, name] of [[tenantA, 'Ada'], [tenantA, 'Amira'], [tenantB, 'Bjorn']] as const) {
      const id = randomUUID();
      contactIds.push(id);
      await pool.query(
        `INSERT INTO contacts (id, tenant_id, first_name) VALUES ($1, $2, $3)`,
        [id, tenant, name],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    if (contactIds.length) {
      await pool.query(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [contactIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS ${SCRATCH}`).catch(() => {});
    // One statement, and it needs no REVOKE chain in front of it: a probe minted
    // by tests/helpers/rls-probe-role-2474.ts owns nothing and appears in no object ACL, so
    // DROP ROLE clears its memberships (including the SET ROLE grant) with it —
    // measured, and the reason #2466's `some objects depend on it` cannot come
    // back through this door.
    await withOwnerSession(() => pool.connect(), (runDdl) => dropRlsProbeRole(runDdl, PROBE_ROLE));
    await pool.end();
  });

  it('reports pass over the whole provisioned schema', async () => {
    const verdict = evaluateShapeSweep(await sweep());
    // A local run against an unmigrated database lands here as `inconclusive`,
    // which is the correct outcome: the sweep refuses to call an unseen policy
    // set clean. CI provisions RLS first (`node scripts/apply-rls-ci.mjs`).
    expect(verdict.message).not.toBe('');
    expect(verdict.status).toBe('pass');
  });

  it('finds the sweep over a real number of policies, not a stub', async () => {
    const s = await sweep();
    expect(s.total).toBeGreaterThanOrEqual(MIN_POLICY_EXPRESSIONS);
  });

  it('contacts carries a fail-closed USING and, if it has one, a fail-closed WITH CHECK', async () => {
    const { using, check } = await contactsPolicy();
    expect(using.length).toBeGreaterThan(0);
    expect(using).toContain("current_setting('app.current_tenant'::text, true)");
    if (check !== null) {
      expect(check).toContain("current_setting('app.current_tenant'::text, true)");
    }
  });

  it('NON-VACUITY: names a scratch table that carries the aborting pair', async () => {
    await pool.query(`DROP TABLE IF EXISTS ${SCRATCH}`);
    await pool.query(
      `CREATE TABLE ${SCRATCH} (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, note text)`,
    );
    await pool.query(`ALTER TABLE ${SCRATCH} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${SCRATCH} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY tenant_isolation ON ${SCRATCH} FOR ALL
         USING (${STRICT_PAIR}) WITH CHECK (${STRICT_PAIR})`,
    );
    try {
      const before = evaluateShapeSweep(await sweep());
      expect(before.status).toBe('fail');
      // Both halves are named: the WITH CHECK is what makes a context-less
      // INSERT abort too, and a polqual-only sweep would miss it entirely.
      expect(before.message).toContain(`${SCRATCH} [USING]`);
      expect(before.message).toContain(`${SCRATCH} [WITH CHECK]`);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${SCRATCH}`);
    }
    expect(evaluateShapeSweep(await sweep()).status).toBe('pass');
  });

  it('as a non-superuser with the GUC never set, contacts DENIES instead of raising', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE "${PROBE_ROLE}"`);
      // No set_config of any kind: this is the context-less session the policy
      // has to survive. Before the fail-closed rewrite this aborted the
      // statement (`unrecognized configuration parameter`).
      const res = await client.query('SELECT count(*)::int AS n FROM contacts');
      expect(res.rows[0].n).toBe(0);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }
  });

  it('with the tenant GUC set, only that tenant rows are visible', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${PROBE_ROLE}"`);
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantA]);
      const res = await client.query(
        `SELECT first_name FROM contacts WHERE id = ANY($1::uuid[]) ORDER BY first_name`,
        [contactIds],
      );
      expect(res.rows.map((r) => r.first_name)).toEqual(['Ada', 'Amira']);

      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantB]);
      const other = await client.query(
        `SELECT first_name FROM contacts WHERE id = ANY($1::uuid[])`,
        [contactIds],
      );
      expect(other.rows.map((r) => r.first_name)).toEqual(['Bjorn']);
      await client.query('ROLLBACK');
    } finally {
      await client.release();
    }
  });

  it('rejects a context-less INSERT as row-level security, not as an unknown parameter', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE "${PROBE_ROLE}"`);
      const err = await client
        .query(`INSERT INTO contacts (id, tenant_id, first_name) VALUES ($1, $2, 'No Context')`, [
          randomUUID(),
          tenantA,
        ])
        .then(() => null)
        .catch((e) => e);
      expect(err, 'INSERT without a tenant context must not succeed').not.toBeNull();
      expect(err.code).toBe('42501');
      expect(String(err.message)).toContain('row-level security');
      // The whole point of #2438: the failure must be the policy denying the
      // write, never the GUC being missing.
      expect(String(err.message)).not.toMatch(/unrecognized configuration parameter/);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }
  });
});
