/**
 * Least-privilege connection-role evaluation (#2253).
 *
 * The NuCRM schema turns on ROW LEVEL SECURITY (and FORCE RLS) on every
 * tenant-scoped table. Two Postgres facts silently defeat all of that:
 *
 *   1. A role with `rolsuper` (a cluster superuser) BYPASSES RLS entirely —
 *      no policy is ever consulted for its queries.
 *   2. A role with `rolbypassrls` (BYPASSRLS) does the same, and the table
 *      owner is exempt from its own policies unless the table is FORCE'd.
 *
 * If the application connects as the `postgres` superuser (the historical
 * default), all 225 `tenant_isolation` policies are decorative — isolation
 * lives only in application code.
 *
 * This module is the single, dependency-free source of truth for the verdict
 * ("is this connection role safe to serve tenant data?"). `pg` is intentionally
 * NOT imported here: the check scripts pass in the raw `pg_roles` row so this
 * logic stays unit-testable without a database.
 */

/** A role's privileges as reported by `pg_roles` (+ optional ownership count). */
export interface RolePrivilegeFacts {
  /** `rolname` of the role the session connected as (`current_user`). */
  readonly rolname: string;
  /** `rolsuper` — cluster superuser: bypasses RLS and every permission check. */
  readonly rolsuper: boolean;
  /** `rolbypassrls` — explicit BYPASSRLS attribute: skips RLS but not ACLs. */
  readonly rolbypassrls: boolean;
  /**
   * How many tenant-scoped tables the role OWNS. `null`/`undefined` means
   * ownership was not probed and is not asserted (see `ownsTenantTables`).
   */
  readonly ownsTenantTables?: number | null;
  /** Whether any tenant table is missing FORCE RLS (owner is then exempt). */
  readonly hasUnforcedTables?: boolean | null;
}

export type RolePrivilegeSeverity = 'ok' | 'fail';

export interface RolePrivilegeFinding {
  readonly severity: RolePrivilegeSeverity;
  readonly code:
    | 'superuser'
    | 'bypassrls'
    | 'owner-without-force'
    | 'enforced'
    | 'unknown';
  readonly message: string;
}

export interface RolePrivilegeVerdict {
  /** True only when RLS is genuinely enforced against this role. */
  readonly ok: boolean;
  readonly findings: RolePrivilegeFinding[];
  /** The blocking findings (`severity === 'fail'`), for callers that log/exit. */
  readonly failures: RolePrivilegeFinding[];
}

/**
 * The SQL that fetches the facts this evaluator consumes. Kept here so the
 * guard script and any future integration share one query definition.
 */
export const ROLE_PRIVILEGE_SQL = `
  SELECT
    current_user                                   AS rolname,
    (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS rolsuper,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls
`;

/**
 * Decide whether a connection role is subject to the tenant RLS policies.
 *
 * Rules, in order of severity:
 *   - superuser  -> FAIL (bypasses RLS, unconditional).
 *   - bypassrls  -> FAIL (bypasses RLS by attribute).
 *   - owns tenant tables AND some are not FORCE'd -> FAIL (owner exemption).
 *   - otherwise                                   -> OK (policies bind).
 */
export function evaluateRolePrivileges(facts: RolePrivilegeFacts): RolePrivilegeVerdict {
  const findings: RolePrivilegeFinding[] = [];

  if (facts.rolsuper) {
    findings.push({
      severity: 'fail',
      code: 'superuser',
      message:
        `role "${facts.rolname}" is a cluster SUPERUSER (rolsuper=true) — it bypasses ROW LEVEL SECURITY entirely, ` +
        `so every tenant_isolation policy is a no-op for this connection. Connect as a non-superuser role (e.g. nucrm_app).`,
    });
  }

  if (facts.rolbypassrls) {
    findings.push({
      severity: 'fail',
      code: 'bypassrls',
      message:
        `role "${facts.rolname}" has the BYPASSRLS attribute (rolbypassrls=true) — RLS is skipped for this connection. ` +
        `Remove BYPASSRLS or connect as a least-privilege role (e.g. nucrm_app).`,
    });
  }

  const owns = facts.ownsTenantTables ?? null;
  const unforced = facts.hasUnforcedTables ?? null;
  if (owns !== null && owns > 0 && unforced === true) {
    findings.push({
      severity: 'fail',
      code: 'owner-without-force',
      message:
        `role "${facts.rolname}" owns ${owns} tenant-scoped table(s) that are not FORCE ROW LEVEL SECURITY — ` +
        `a table owner is exempt from its own policies. Either FORCE every table or connect as a non-owner role.`,
    });
  }

  const failures = findings.filter((f) => f.severity === 'fail');
  const ok = failures.length === 0;

  if (ok) {
    findings.push({
      severity: 'ok',
      code: 'enforced',
      message:
        `role "${facts.rolname}" is non-superuser and non-BYPASSRLS — tenant_isolation RLS policies are enforced against it.`,
    });
  }

  return { ok, findings, failures };
}
