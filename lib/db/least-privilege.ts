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
 * Companion probe (#2306): how many uuid `tenant_id` tables does the connecting
 * role OWN, and are any of them not FORCE ROW LEVEL SECURITY? An owner of an
 * un-FORCE'd table is exempt from its policies just like a superuser is, so the
 * role attributes alone are not a sufficient verdict.
 */
export const TENANT_TABLE_OWNERSHIP_SQL = `
  SELECT count(*) FILTER (WHERE NOT c.relforcerowsecurity)::int AS unforced_owned,
         count(*)::int                                          AS owned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attisdropped = false
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'uuid'
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
`;

/**
 * The minimal query surface the probes need. Both the `pg` Pool used by the
 * operational scripts and the app's `query()` from `lib/db/client` satisfy it,
 * and a unit test can supply a plain stub — which is why this module still does
 * not import `pg`.
 */
export type RolePrivilegeQuerier = <T extends Record<string, unknown>>(
  sql: string,
) => Promise<{ rows: T[] }>;

/** Raised when the connection role can bypass RLS, or cannot be verified. */
export class RlsRoleBypassError extends Error {
  readonly verdict: RolePrivilegeVerdict | null;

  constructor(message: string, verdict: RolePrivilegeVerdict | null = null) {
    super(message);
    this.name = 'RlsRoleBypassError';
    this.verdict = verdict;
  }
}

/**
 * Strip any `postgres://user:pass@host/db` shape out of a message before it is
 * logged, emitted in an alert, or written to a CI log. The guard runs against
 * production URLs; it must never leak one (#2306).
 */
export function redactConnectionString(text: string): string {
  return text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"]*/gi, '[redacted-connection-string]')
    .replace(/\/\/[^@/\s]*@/g, '//***:***@');
}

/**
 * Read the role facts this evaluator needs from a live connection.
 *
 * Throws `RlsRoleBypassError` when the connecting role cannot even be
 * determined — "unknown" is not "safe" for a guard whose whole purpose is to
 * turn a silent failure into a loud one.
 */
export async function collectRolePrivilegeFacts(
  run: RolePrivilegeQuerier,
  options: { probeOwnership?: boolean } = {},
): Promise<RolePrivilegeFacts> {
  const who = await run<{ rolname: string; rolsuper: boolean | null; rolbypassrls: boolean | null }>(
    ROLE_PRIVILEGE_SQL,
  );
  const role = who.rows[0];
  if (!role || typeof role.rolname !== 'string') {
    throw new RlsRoleBypassError('could not determine the connecting role — refusing to assume RLS is enforced');
  }

  const facts: {
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    ownsTenantTables?: number | null;
    hasUnforcedTables?: boolean | null;
  } = {
    rolname: role.rolname,
    rolsuper: Boolean(role.rolsuper),
    rolbypassrls: Boolean(role.rolbypassrls),
  };

  if (options.probeOwnership !== false) {
    try {
      const own = await run<{ owned: number | null; unforced_owned: number | null }>(
        TENANT_TABLE_OWNERSHIP_SQL,
      );
      const row = own.rows[0];
      if (row) {
        facts.ownsTenantTables = Number(row.owned ?? 0);
        facts.hasUnforcedTables = Number(row.unforced_owned ?? 0) > 0;
      }
    } catch {
      // Ownership is a refinement of the verdict, not a precondition: when the
      // probe is unavailable (restricted metadata access) fall back to the
      // role-attribute-only verdict rather than masking the connection error.
      facts.ownsTenantTables = null;
      facts.hasUnforcedTables = null;
    }
  }

  return facts;
}

/**
 * The single source of truth for "may this connection serve tenant data?".
 *
 * Returns the verdict when RLS binds against the role, and throws
 * `RlsRoleBypassError` — with every blocking finding, connection-string free —
 * when it does not. Callers that must not die (the app process) catch it and
 * alert; callers that are gates (the deploy step, CI, `check-db-role-privileges`)
 * let the non-zero exit do the aborting.
 */
export async function assertRoleIsRlsConstrained(
  run: RolePrivilegeQuerier,
  options: { probeOwnership?: boolean } = {},
): Promise<RolePrivilegeVerdict> {
  const facts = await collectRolePrivilegeFacts(run, options);
  const verdict = evaluateRolePrivileges(facts);

  if (!verdict.ok) {
    throw new RlsRoleBypassError(
      redactConnectionString(
        `RLS IS NOT ENFORCED against the connecting role. ${verdict.failures
          .map((f) => f.message)
          .join(' ')}`,
      ),
      verdict,
    );
  }

  return verdict;
}

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
