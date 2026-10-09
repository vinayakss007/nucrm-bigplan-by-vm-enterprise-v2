/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2474 — mint an RLS-bound probe role that writes no catalog row anybody else writes.
 *
 * Every integration suite that proves row-level security needs a role that is
 * actually subject to the policies, because the CI login role is a superuser and
 * superusers are RLS-blind. The shape they all reached for was:
 *
 * ```sql
 * CREATE ROLE probe NOSUPERUSER NOBYPASSRLS NOINHERIT;
 * GRANT USAGE ON SCHEMA public TO probe;
 * GRANT SELECT, INSERT ON <table> TO probe;
 * ```
 *
 * and that is a race. `GRANT … ON SCHEMA public` is not an insert: it is an
 * **UPDATE of the single `pg_namespace` row named `public`**, one hot tuple that
 * every suite doing role setup writes at the same moment — `vitest` spawns a
 * worker per file, so all the `beforeAll`s land within about a second of each
 * other. Postgres waits for an updater in progress, but once the update chain has
 * moved past the version it read it raises
 * `error: tuple concurrently updated` {code: 'XX000', file: 'heapam.c',
 * routine: 'simple_heap_update'} rather than retrying. Measured on CI run
 * 37892687755, where five racers were enough and the loser was
 * `superadmin-panel-sql.test.ts` — a file the PR under test had not touched.
 * `GRANT … ON ALL TABLES IN SCHEMA public` is the same story multiplied: 226
 * `pg_class` tuples in one statement.
 *
 * So privileges come from **role membership** instead of object ACLs. `GRANT
 * <role> TO <role>` inserts a fresh `pg_auth_members` row keyed on this run's own
 * name, which is a tuple nobody else can be writing. `pg_read_all_data` and
 * `pg_write_all_data` supply schema `USAGE` plus table read/write without
 * touching `pg_namespace` or `pg_class` at all, and both are
 * `rolsuper = false, rolbypassrls = false`, so the probe stays bound by RLS —
 * that is asserted below rather than assumed, because a probe that bypasses RLS
 * turns every one of these suites green for the wrong reason.
 *
 * TWO THINGS THIS TRADES, STATED PLAINLY
 * --------------------------------------
 * - The role must be `INHERIT`. A `NOINHERIT` member does not inherit, so the
 *   membership would be inert and the probe would see nothing.
 * - `pg_write_all_data` also carries TRUNCATE, REFERENCES and TRIGGER on every
 *   table, and RLS does not police TRUNCATE (it covers SELECT/INSERT/UPDATE/
 *   DELETE). On a test database whose probe role this helper drops again at
 *   teardown that is an acceptable trade for removing a nondeterministic CI
 *   killer; it is not acceptable on a role that outlives a run, which is why
 *   `releaseRlsProbeRole` reports anything it could not unwind instead of
 *   swallowing the failure.
 *
 * WHY THERE IS NO ADVISORY LOCK
 * ------------------------------
 * #2474 suggests memoising one probe role behind `pg_try_advisory_lock` so a
 * single suite writes catalog rows and the rest reuse it. That trades the
 * `pg_namespace` race for two worse ones, so each suite mints its own name
 * instead:
 *   - `CREATE ROLE` on an existing name is an error, so serialising it still
 *     leaves every caller deciding between create, adopt and a lost race; and
 *     `pg_auth_members` rows for one shared role are the same `(grantee,
 *     roleid)` tuple its teardown deletes.
 *   - One shared role means the first suite to finish revokes privileges — or
 *     drops the role — out from under the ~30 that are still asserting through
 *     it. Per-suite names make the write insert-only and the teardown owned,
 *     which removes the contention rather than scheduling it.
 */

/** The predefined roles whose membership stands in for the schema/table ACL grants. */
export const RLS_PROBE_PRIVILEGE_ROLES = ['pg_read_all_data', 'pg_write_all_data'] as const;

/**
 * The helper splices the role name into DDL, where an identifier cannot be sent
 * as a bound parameter. This pattern is what makes that safe: it is also exactly
 * the shape `CREATE ROLE` accepts without quoting, so a name that passes here
 * cannot close the quote it is wrapped in.
 */
const PROBE_ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** The two statements a suite needs, in the shapes `pg` and `drizzle` both answer. */
export interface ProbeRoleClient {
  /** Run a statement for its effect; the result is not read. */
  exec(sqlText: string): Promise<unknown>;
  /** Run a SELECT and hand back its rows. */
  rows(sqlText: string): Promise<Record<string, unknown>[]>;
}

/** What `ensureRlsProbeRole` established, and what `releaseRlsProbeRole` owes. */
export interface ProbeRoleHandle {
  role: string;
  /**
   * False when the cluster already had this role before the call. Roles are
   * cluster-wide while every grant here is per-database, so a pre-existing role
   * belongs to another run and removing it is not this run's claim to make
   * (#2466) — it keeps the role, this helper takes back only what it added.
   */
  createdHere: boolean;
}

/** Adapter for a `pg.Pool` / `pg.Client`. */
export function probeRoleClientFromPool(pool: {
  query(sqlText: string): Promise<{ rows?: unknown[] }>;
}): ProbeRoleClient {
  return {
    exec: (sqlText) => pool.query(sqlText).then(() => undefined),
    rows: (sqlText) =>
      pool.query(sqlText).then((res) => (res.rows ?? []) as Record<string, unknown>[]),
  };
}

/**
 * Adapter for a `sql`-tagged executor — drizzle's `db.execute` answers with the
 * driver's result, so the same `{ rows }` shape comes back and only the call
 * shape differs. The caller wraps its own text in `sql.raw`, since an identifier
 * cannot be a bound parameter and this helper splices names it has already
 * pattern-checked.
 */
export function probeRoleClientFromExecutor(
  execute: (sqlText: string) => Promise<unknown>,
): ProbeRoleClient {
  return {
    exec: (sqlText) => execute(sqlText),
    rows: async (sqlText) => {
      const result = (await execute(sqlText)) as { rows?: unknown[] } | undefined;
      return (result?.rows ?? []) as Record<string, unknown>[];
    },
  };
}

/**
 * Create the probe role if the cluster has no such name, reset its attributes if
 * it does, hand it read+write through membership, and prove the probe is bound by
 * RLS. Throws if any half of that is not true — a suite whose probe is a
 * superuser, or whose privileges never arrived, is not measuring what its name
 * says it measures.
 */
export async function ensureRlsProbeRole(
  client: ProbeRoleClient,
  role: string,
  options: { login?: boolean } = {},
): Promise<ProbeRoleHandle> {
  if (!PROBE_ROLE_NAME.test(role)) {
    throw new Error(
      `[rls-probe-role] "${role}" is not a bare lower-case identifier — the name is spliced into DDL, ` +
        `so anything else here would be an injection surface rather than a role`,
    );
  }

  const found = await client.rows(`SELECT 1 FROM pg_roles WHERE rolname = '${role}'`);
  const createdHere = found.length === 0;
  const loginClause = options.login ? ' LOGIN' : '';

  await client.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" NOSUPERUSER NOBYPASSRLS INHERIT${loginClause};
      ELSE
        ALTER ROLE "${role}" NOSUPERUSER NOBYPASSRLS INHERIT;
      END IF;
    END $$;
  `);

  // SET ROLE needs the login role to be a member. On CI the login role is a
  // superuser and would not need it, but locally it is often the provisioned
  // app role, and this is an insert into pg_auth_members either way — no hot row.
  await client.exec(`GRANT "${role}" TO CURRENT_USER`);
  for (const privilegeRole of RLS_PROBE_PRIVILEGE_ROLES) {
    await client.exec(`GRANT ${privilegeRole} TO "${role}"`);
  }

  const [probe] = await client.rows(`
    SELECT rolsuper, rolbypassrls, rolinherit,
           pg_has_role('${role}', 'pg_read_all_data', 'MEMBER') AS reads,
           has_schema_privilege('${role}', 'public', 'USAGE') AS schema_usage
      FROM pg_roles
     WHERE rolname = '${role}'
  `);

  if (!probe) throw new Error(`[rls-probe-role] ${role} was not created`);
  if (probe.rolsuper || probe.rolbypassrls) {
    throw new Error(
      `[rls-probe-role] ${role} is rolsuper=${probe.rolsuper} rolbypassrls=${probe.rolbypassrls}; ` +
        `such a role is invisible to RLS, so this suite would prove nothing whatever it asserted`,
    );
  }
  if (!probe.rolinherit) {
    throw new Error(
      `[rls-probe-role] ${role} is NOINHERIT — a non-inheriting member does not take pg_read_all_data, ` +
        `so the membership grants above are inert`,
    );
  }
  if (!probe.reads || !probe.schema_usage) {
    throw new Error(
      `[rls-probe-role] ${role}: privileges did not resolve through membership ` +
        `(pg_has_role=${probe.reads}, USAGE on public=${probe.schema_usage})`,
    );
  }

  return { role, createdHere };
}

/**
 * Take back what `ensureRlsProbeRole` added — if it was this run's to add.
 * Returns one string per statement it could not run rather than swallowing the
 * failure, because every one of these suites already has an opinion about what a
 * leak is worth, and `.catch(() => {})` over teardown DDL is exactly what let the
 * destructive version of #2455 survive CI.
 *
 * The caller's connections must be un-assumed. `REVOKE <probe> FROM CURRENT_USER`
 * is a self-revoke on a connection that is still wearing the probe role, and a
 * self-revoke is `permission denied to revoke role … only roles with the ADMIN
 * option may revoke this role`. `RESET ALL` does not prevent that: on PG 16.15
 * current_user survives it, because the assumed role is not an ordinary GUC — a
 * suite has to `RESET ROLE` before it releases the client.
 */
export async function releaseRlsProbeRole(
  client: ProbeRoleClient,
  handle: ProbeRoleHandle,
  options: { dropRole?: boolean } = {},
): Promise<string[]> {
  const dropRole = options.dropRole ?? handle.createdHere;
  // #2466: a role this run did not create belongs to somebody else — possibly to
  // a suite running in a worker next to this one. Revoking its membership would
  // strip a grant it is reading through, and the `pg_auth_members` rows here are
  // keyed on (role, member), which is precisely the row a concurrent run wrote.
  // So the run that created the role is the only one that may take it back.
  if (!dropRole) return [];

  const failures: string[] = [];
  const attempt = async (label: string, sqlText: string): Promise<void> => {
    try {
      await client.exec(sqlText);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await attempt('REVOKE role FROM CURRENT_USER', `REVOKE "${handle.role}" FROM CURRENT_USER`);
  // No `DROP OWNED BY` in front of this, and none needed: the role owns no objects
  // and appears in no object ACL, because its privileges came in as membership in
  // the predefined roles. `DROP ROLE` takes those memberships with it.
  await attempt('DROP ROLE', `DROP ROLE IF EXISTS "${handle.role}"`);

  return failures;
}
