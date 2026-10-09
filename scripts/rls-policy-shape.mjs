/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Fail-closed tenant_isolation shape detection (#2438).
 *
 * WHY
 * ---
 * A row-level-security policy that reads the tenant GUC with the ONE-argument
 * form — `current_setting('app.current_tenant')` — does not fail closed when no
 * tenant context exists. Postgres raises
 * `unrecognized configuration parameter "app.current_tenant"`, which aborts the
 * whole statement, instead of evaluating the comparison to NULL and denying the
 * row. `0039_rls_fail_closed_policy.sql` exists specifically to end that, and
 * states the distinction verbatim in its own header: *"That is an ERROR, not a
 * DENY — it aborts the entire statement"* (`0039:5-7`).
 *
 * The two shapes are one character apart in behaviour and easy to confuse, so
 * this module names the difference in terms Postgres itself reports: the ARITY
 * of the call. Every safe form passes `missing_ok` (`current_setting(…, true)`),
 * so a `current_setting(` … `)` group whose text contains no comma is an
 * error-raising one.
 *
 * WHY THE PATTERN CARRIES NO QUOTES
 * ---------------------------------
 * The pattern is embedded in a SQL string literal. Doubling the quotes around
 * `'app.current_tenant'` inside that literal is the kind of thing that silently
 * stops matching, and a sweep that matches nothing is indistinguishable from a
 * schema with nothing wrong — which is exactly the failure mode this issue is
 * about (`0039:79-81` swallows per-table skips into a `RAISE WARNING`, so a
 * table left strict is silent by construction). Dropping the quotes from the
 * pattern removes the escape entirely: `[^,)]*` spans them.
 *
 * WHY A FLOOR TRAVELS WITH THE RESULT
 * -----------------------------------
 * `strictCount === 0` is only a pass if the sweep actually saw the policies.
 * Every caller must check `total` against the discovery floor, or the assertion
 * passes vacuously on a schema where the RLS migrations never ran — the same
 * trap that let the original defect through.
 */

/** POSIX pattern matching the error-raising single-argument call. Quote-free by design. */
export const STRICT_TENANT_ISOLATION_PATTERN =
  String.raw`current_setting\([^,)]*app\.current_tenant[^,)]*\)`;

/**
 * The GUC that lets a platform connection (no tenant) see platform-observed
 * tables. `0092_metrics_tables_superadmin_bypass.sql` ORs it into USING and
 * WITH CHECK of `tenant_isolation` on eight tables; without it those tables read
 * as empty to every super-admin surface, which is the permanent-zero class of bug
 * #2411/#2420 spent their lifetimes chasing.
 *
 * Named here so a test can assert the bypass is present WITHOUT retyping the
 * expression: #2455 found an integration suite that re-created `activities`'
 * policy from a hand-copied string, so a migration that deleted the bypass would
 * have been quietly re-added by the test that was supposed to notice.
 */
export const SUPER_ADMIN_BYPASS_PARAM = 'app.is_super_admin';

/**
 * The bypass, in the form that DENIES rather than aborts: the two-argument
 * `current_setting(…, true)`. Deliberately quote-agnostic for the same reason as
 * `STRICT_TENANT_ISOLATION_PATTERN` above — it has to match both Postgres'
 * deparse (`'app.is_super_admin'::text, true`) and the doubled quotes a migration
 * file writes (`''app.is_super_admin'', true`).
 */
export const FAIL_CLOSED_BYPASS_PATTERN =
  /current_setting\([^,)]*app\.is_super_admin[^,)]*,\s*true\s*\)/;

/** True when one policy expression carries the fail-closed bypass. */
export function expressionCarriesSuperAdminBypass(expression) {
  return FAIL_CLOSED_BYPASS_PATTERN.test(String(expression ?? ''));
}

/**
 * Check both halves of a policy. `withCheck` is absent on a read-only policy, so
 * it is only required when Postgres reports one — a WITH CHECK that lacks the
 * bypass is the write-path abort #2438 was filed for.
 *
 * @param {{qual?: string|null, withCheck?: string|null}} policy
 * @returns {{ok: boolean, missing: string[]}}
 */
export function policyCarriesSuperAdminBypass(policy) {
  const missing = [];
  if (!expressionCarriesSuperAdminBypass(policy?.qual)) missing.push('USING');
  if (policy?.withCheck != null && !expressionCarriesSuperAdminBypass(policy.withCheck)) {
    missing.push('WITH CHECK');
  }
  return { ok: missing.length === 0, missing };
}

/**
 * How many fail-closed bypass arms a migration file's text contains — the shipped
 * object, read from the journal rather than remembered. 0092 writes the pair
 * (USING + WITH CHECK), so a schema built from it should answer 2 arms per policy
 * and the count drops to 0 the day the bypass is removed.
 */
export function countBypassArmsInMigrationSql(sqlText) {
  const matches = String(sqlText ?? '').match(new RegExp(FAIL_CLOSED_BYPASS_PATTERN.source, 'g'));
  return matches ? matches.length : 0;
}

/**
 * Minimum number of `tenant_isolation` policy expressions a real schema has.
 * Measured on the migrated database and on a CI-provisioned one: 198 policies
 * deparsing to 221 USING/WITH CHECK expressions. The floor is well below both
 * and far above any schema that merely forgot to run the migrations.
 */
export const MIN_POLICY_EXPRESSIONS = 100;

/**
 * The sweep, as one SQL statement. Returns `strict_count|offenders|total`.
 *
 * Both halves of the policy are read: `polqual` (USING) and `polwithcheck`
 * (WITH CHECK). Checking only USING would miss the write-path abort — a strict
 * `WITH CHECK` makes every INSERT/UPDATE depend on the GUC too, which is the
 * case the seed/migration/restore paths hit.
 */
export function buildShapeSweepSql() {
  return [
    'WITH exprs AS (',
    "  SELECT c.relname::text AS t, 'USING' AS w,",
    '         pg_get_expr(p.polqual, p.polrelid)::text AS e',
    '    FROM pg_policy p',
    '    JOIN pg_class c ON c.oid = p.polrelid',
    '    JOIN pg_namespace n ON n.oid = c.relnamespace',
    "   WHERE n.nspname = 'public' AND p.polname = 'tenant_isolation'",
    '  UNION ALL',
    "  SELECT c.relname::text, 'WITH CHECK',",
    '         pg_get_expr(p.polwithcheck, p.polrelid)::text',
    '    FROM pg_policy p',
    '    JOIN pg_class c ON c.oid = p.polrelid',
    '    JOIN pg_namespace n ON n.oid = c.relnamespace',
    "   WHERE n.nspname = 'public' AND p.polname = 'tenant_isolation'",
    '     AND p.polwithcheck IS NOT NULL)',
    `SELECT count(*) FILTER (WHERE e ~ '${STRICT_TENANT_ISOLATION_PATTERN}') AS strict_count,`,
    `       coalesce(string_agg(DISTINCT t || ' [' || w || ']', ', ')`,
    `                FILTER (WHERE e ~ '${STRICT_TENANT_ISOLATION_PATTERN}'), '') AS offenders,`,
    '       count(*) AS total',
    '  FROM exprs',
  ].join('\n');
}

/**
 * Parse `psql -t -A -F'|'` output into numbers. Anything unparseable becomes
 * `null` so callers treat it as "the sweep did not run", never as "clean".
 */
export function parseShapeSweep(raw) {
  const parts = String(raw ?? '').trim().split('|');
  if (parts.length < 3) return { strictCount: null, offenders: '', total: null };
  const strictCount = Number(parts[0]);
  const total = Number(parts[2]);
  return {
    strictCount: Number.isFinite(strictCount) ? strictCount : null,
    offenders: parts[1],
    total: Number.isFinite(total) ? total : null,
  };
}

/**
 * Turn a parsed sweep into a verdict. Three states, deliberately:
 *   - `inconclusive` — the sweep did not report, or saw too few policies to
 *     prove anything. This is a failure, not a pass.
 *   - `fail` — at least one error-raising expression exists.
 *   - `pass` — the invariant holds over a schema that has the policies.
 */
export function evaluateShapeSweep(sweep, { minPolicies = MIN_POLICY_EXPRESSIONS } = {}) {
  const { strictCount, offenders, total } = sweep;
  if (strictCount === null || total === null) {
    return {
      status: 'inconclusive',
      message: `could not read the tenant_isolation policy shapes (got ${JSON.stringify([strictCount, total])}) — the sweep must not be treated as a pass`,
    };
  }
  if (total < minPolicies) {
    return {
      status: 'inconclusive',
      message: `only ${total} tenant_isolation policy expression(s) found, expected at least ${minPolicies} — the RLS migrations did not run, so the shape check proves nothing`,
    };
  }
  if (strictCount > 0) {
    return {
      status: 'fail',
      message: `${strictCount} error-raising tenant_isolation expression(s): a missing tenant GUC aborts the statement instead of denying the row — ${offenders}`,
    };
  }
  return {
    status: 'pass',
    message: `${total} tenant_isolation policy expressions, none error-raising`,
  };
}
