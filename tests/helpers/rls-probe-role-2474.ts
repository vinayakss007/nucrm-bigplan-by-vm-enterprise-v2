/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2474 — the one way an integration suite mints an RLS probe role.
 *
 * `GRANT <privilege> ON SCHEMA public TO <role>` is not a small catalog write: it
 * is an UPDATE of the single `pg_namespace` row named `public`. vitest runs one
 * worker per file, so the four suites that each issued one in `beforeAll` all
 * landed inside the same second and raced that one tuple. Postgres waits for an
 * in-flight updater, but once the update chain has moved past the version a
 * waiter read it raises `XX000 tuple concurrently updated` rather than retrying —
 * a lottery whose odds rise with every racer, which is why it surfaced in
 * `superadmin-panel-sql.test.ts` on a CI run of a PR that never edited that file.
 *
 * `GRANT pg_read_all_data / pg_write_all_data TO <role>` writes nothing shared:
 * each is one fresh `pg_auth_members` row keyed on the caller's own role name, so
 * two suites minting probe roles touch no common tuple and no advisory lock is
 * needed to serialise them. That is the whole fix — the roles stay per-suite
 * because each suite asserts a different privilege *failure*, and a shared probe
 * would have to be the union of those, which is how a fixture stops proving.
 *
 * Measured on Postgres 16 against the CI-shaped `nucrm_test`, with the role
 * created exactly as `ensureRlsProbeRole` does and reached by `SET ROLE` the way
 * every caller here reaches it:
 *
 * - `rolsuper`/`rolbypassrls` of both predefined roles: `f`/`f`. Membership
 *   grants read and write, not exemption — RLS still binds the probe, which is
 *   the property these suites exist to assert.
 * - `has_schema_privilege(…,'public','USAGE')`: true. USAGE comes with membership,
 *   so there is no schema ACL to grant and no schema ACL to restore.
 * - SELECT / INSERT / UPDATE / DELETE on a table: true. TRUNCATE: false — strictly
 *   narrower than `GRANT … ON ALL TABLES IN SCHEMA public`, and no caller here
 *   truncates as the probe.
 * - The same memberships on a **NOINHERIT** role: SELECT false. Membership
 *   privileges are unreachable through a non-inheriting role even under
 *   `SET ROLE`, so `INHERIT` below is load-bearing: a caller that re-adds
 *   `NOINHERIT` gets `42501 permission denied` where it asserts
 *   `42501 row-level security`, and the two are distinguished only by the
 *   message the assertions check.
 * - After `DROP ROLE`, rows in `pg_class` whose `relacl` mentions the role: 0.
 *   The role appears in no object ACL, so #2466's
 *   `DROP ROLE … cannot be dropped because some objects depend on it` has no
 *   cause left to `DROP OWNED BY` around.
 *
 * `DROP ROLE` also clears the role's own memberships, including the
 * `GRANT <role> TO CURRENT_USER` that lets the session `SET ROLE` to it, so
 * teardown is one statement.
 *
 * The second finding, from this PR's own first run: one statement, issued by the
 * OWNER. `role` is not a setting `RESET ALL` resets, so a suite that normalises a
 * borrowed connection with `RESET ALL` and releases it returns it to the pool
 * still wearing the probe role, and the teardown `DROP ROLE` that lands on that
 * connection asks the probe to drop itself. Both `withOwnerSession` below and the
 * `RESET ROLE` added to the suites' borrow/release paths come from that.
 */

/** Privileges a probe needs and no more; both are NOBYPASSRLS-safe (see above). */
const PROBE_MEMBERSHIPS = ['pg_read_all_data', 'pg_write_all_data'] as const;

/** A pg client, narrowed to what role DDL needs — keeps this helper pg-free. */
type DdlClient = {
  query: (statement: string) => Promise<unknown>;
  release: () => void;
};

/**
 * Run role DDL on a session that is not wearing a role.
 *
 * Measured on the same PG16 (`SET ROLE zz_a` then `SELECT current_user`):
 *
 *   RESET ALL   → current_user is STILL zz_a
 *   RESET ROLE  → current_user is postgres again
 *
 * `role` is not a GUC that `RESET ALL` touches, so every suite here that believed
 * it was normalising a connection before releasing it — `RESET ALL` in a
 * `finally` — was in fact returning a connection still wearing the probe role to
 * the pool. A teardown that then does `pool.query('DROP ROLE …')` gets that
 * connection back and asks the probe role to drop itself: `ERROR: permission
 * denied to drop role / DETAIL: Only roles with the CREATEROLE attribute and the
 * ADMIN option on the target roles may drop roles`. That is what this PR's own
 * first run hit, in both `analytics-ingest-rls` and `superadmin-panel-sql`, with
 * all 22 assertions green — and on `main` the identical failure was invisible
 * because those teardowns were `.catch(() => {})`-wrapped, which is how the roles
 * got left behind in the first place.
 *
 * The same applies to `GRANT "<role>" TO CURRENT_USER`: it has to be issued by
 * the owner, so setup goes through here too.
 *
 * `ROLLBACK` first, because a released-dirty connection can also be inside an
 * aborted transaction, and in that state every other statement — including
 * `RESET ALL` — fails with `current transaction is aborted`. Outside a
 * transaction it is only a WARNING, never an error.
 */
export async function withOwnerSession(
  borrow: () => Promise<DdlClient>,
  run: (runDdl: (statement: string) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const client = await borrow();
  try {
    await client.query('ROLLBACK');
    await client.query('RESET ROLE');
    await client.query('RESET ALL');
    await run(statement => client.query(statement));
  } finally {
    // Hand it back the way it came, so the next borrower is not the one to find out.
    await client.query('RESET ROLE').catch(() => {});
    await client.query('RESET ALL').catch(() => {});
    client.release();
  }
}

/** A probe role is a literal name from the suite that owns it, never data. */
function assertRoleName(role: string): void {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(role)) {
    throw new Error(
      `refusing to mint a probe role from ${JSON.stringify(role)} — names go into DDL unquoted-by-parameter, ` +
        'so a suite passes a literal, lowercase identifier it owns end-to-end',
    );
  }
}

/**
 * Create-if-absent, then hand the privileges through membership.
 *
 * The ALTER branch is not decoration: a role left by an older run of the same
 * name — including one that predates this file and was created `NOINHERIT` — is
 * re-set to the attributes this helper guarantees, so the suites never depend on
 * which migration last touched the shared database.
 *
 * `runDdl` is `(sql) => pool.query(sql)` for the pg-based suites and
 * `(sql) => db.execute(sql.raw(sql))` for the drizzle one; nothing here is
 * parameterised, because DDL takes no bind parameters.
 */
export async function ensureRlsProbeRole(runDdl: (statement: string) => Promise<unknown>, role: string): Promise<void> {
  assertRoleName(role);
  await runDdl(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" NOSUPERUSER NOBYPASSRLS INHERIT NOLOGIN;
      ELSE
        ALTER ROLE "${role}" NOSUPERUSER NOBYPASSRLS INHERIT NOLOGIN;
      END IF;
    END $$;
  `);
  for (const m of PROBE_MEMBERSHIPS) await runDdl(`GRANT ${m} TO "${role}"`);
  await runDdl(`GRANT "${role}" TO CURRENT_USER`);
}

/**
 * Leave the database holding nothing this suite added.
 *
 * Deliberately not wrapped in `.catch(() => {})`: swallowing teardown DDL errors
 * is what let the destructive version of #2455 survive every CI run, and a role
 * this form leaves behind is a role the next run has to guess the state of.
 */
export async function dropRlsProbeRole(runDdl: (statement: string) => Promise<unknown>, role: string): Promise<void> {
  assertRoleName(role);
  await runDdl(`DROP ROLE IF EXISTS "${role}"`);
}
