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
 * #3302 — the same property, measured over the WHOLE population.
 *
 * The probe above answers a different question well. It `JOIN`s `pg_attribute …
 * attname = 'tenant_id'`, so its denominator is "tables with a uuid tenant column"
 * and it is structurally incapable of reporting a hole in a table without one.
 * `ai_providers` is enabled, un-FORCED, and absent from every count that screen
 * produces: the guard does not describe it wrongly, it never sees it.
 *
 * So this query deliberately has no column criterion. `relkind = 'r'` in `public` is
 * the whole schema and `relrowsecurity` decides what counts. Ownership and policy
 * presence come back too, because FORCE is only an exemption against the owner, and a
 * table with RLS on and zero policies is a third kind of finding.
 */
export const FULL_FORCE_RLS_CENSUS_SQL = `
  SELECT c.relname                        AS table_name,
         c.relrowsecurity                 AS rls_enabled,
         c.relforcerowsecurity            AS rls_forced,
         (c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS is_owner,
         EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)            AS has_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname
`;

/** Row shape as `pg` returns it; `drizzle` camel-cases the same five aliases. */
export interface ForceRlsCensusRow {
  readonly table_name?: string | null;
  readonly tableName?: string | null;
  readonly rls_enabled?: boolean | string | null;
  readonly rlsEnabled?: boolean | string | null;
  readonly rls_forced?: boolean | string | null;
  readonly rlsForced?: boolean | string | null;
  readonly is_owner?: boolean | string | null;
  readonly isOwner?: boolean | string | null;
  readonly has_policy?: boolean | string | null;
  readonly hasPolicy?: boolean | string | null;
}

export interface ForceRlsCensus {
  /** Ordinary tables in `public`, forced or not. */
  readonly total: number;
  /** The denominator every ratio here uses: tables with RLS switched on. */
  readonly rlsEnabled: number;
  readonly rlsForced: number;
  readonly rlsDisabled: readonly string[];
  /** Enabled but not FORCE'd — the tables the tenant-column screen cannot see. */
  readonly unforced: readonly string[];
  /** …of those, the ones this role owns, which is where the exemption is live today. */
  readonly unforcedOwned: readonly string[];
  /** Enabled with no policy: RLS on an empty rule set denies everything and forces nothing. */
  readonly noPolicy: readonly string[];
  /** False when the census found a hole OR read nothing worth reporting. */
  readonly ok: boolean;
}

/**
 * Catalog flags arrive as booleans through `pg` and as `'t'`/`'f'` when a driver or a
 * fixture hands back the text form. Anything else is false — which is why `ok` also
 * requires a non-zero denominator rather than merely an empty `unforced`.
 */
const catalogBool = (value: unknown): boolean =>
  value === true || value === 't' || value === 'true' || value === 1 || value === '1';

const censusField = (row: Record<string, unknown>, snake: string, camel: string) =>
  row[snake] ?? row[camel];

/** Census rows into counts and name-lists. Pure: no `pg`, no I/O. */
export function evaluateForceRlsCensus(rows: readonly ForceRlsCensusRow[]): ForceRlsCensus {
  const unforced: string[] = [];
  const unforcedOwned: string[] = [];
  const rlsDisabled: string[] = [];
  const noPolicy: string[] = [];
  let rlsEnabled = 0;
  let rlsForced = 0;

  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const name = String(censusField(r, 'table_name', 'tableName') ?? '(unnamed)');
    const enabled = catalogBool(censusField(r, 'rls_enabled', 'rlsEnabled'));
    const forced = catalogBool(censusField(r, 'rls_forced', 'rlsForced'));
    const owned = catalogBool(censusField(r, 'is_owner', 'isOwner'));
    const policy = catalogBool(censusField(r, 'has_policy', 'hasPolicy'));

    if (!enabled) {
      rlsDisabled.push(name);
      continue;
    }
    rlsEnabled += 1;
    if (forced) rlsForced += 1;
    else {
      unforced.push(name);
      if (owned) unforcedOwned.push(name);
    }
    if (!policy) noPolicy.push(name);
  }

  const sorted = (names: string[]) => names.slice().sort((a, b) => a.localeCompare(b));

  return {
    total: rows.length,
    rlsEnabled,
    rlsForced,
    rlsDisabled: sorted(rlsDisabled),
    unforced: sorted(unforced),
    unforcedOwned: sorted(unforcedOwned),
    noPolicy: sorted(noPolicy),
    // "0 of 0" is not a pass. An unmigrated database, a wrong search_path, or a role
    // that cannot read pg_class all answer with an empty or RLS-less catalog — and a
    // destructive script is exactly what waits on this screen's verdict (#3282).
    ok: rlsEnabled > 0 && unforced.length === 0 && noPolicy.length === 0,
  };
}

/** Name up to five offenders; a 226-table schema is not served by a hundred-line detail. */
const NAME_CAP = 5;
const named = (names: readonly string[]): string =>
  names.length <= NAME_CAP
    ? names.join(', ')
    : `${names.slice(0, NAME_CAP).join(', ')} (+ ${names.length - NAME_CAP} more)`;

/**
 * The one line an operator reads. Phrased as "not forced", never as "exposed": the
 * exemption binds the table owner, so where the owner is a superuser with BYPASSRLS
 * the finding is latent until ownership moves — and #3302 says exactly that rather
 * than claiming a live leak this ALTER does not remove today.
 */
export function formatForceRlsCensus(census: ForceRlsCensus): string {
  if (census.rlsEnabled === 0) {
    return `no RLS-enabled tables found in "public" across ${census.total} table(s) — refusing to read an empty catalogue as a pass`;
  }

  const score = `${census.rlsForced}/${census.rlsEnabled} RLS-enabled tables FORCE ROW LEVEL SECURITY`;
  if (census.ok) return score;

  const parts = [score];
  if (census.unforced.length) parts.push(`not forced: ${named(census.unforced)}`);
  if (census.unforcedOwned.length) {
    parts.push(`owned by this role, so its policies are inert there today: ${named(census.unforcedOwned)}`);
  }
  if (census.noPolicy.length) parts.push(`no policy at all: ${named(census.noPolicy)}`);
  return parts.join(' · ');
}

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
