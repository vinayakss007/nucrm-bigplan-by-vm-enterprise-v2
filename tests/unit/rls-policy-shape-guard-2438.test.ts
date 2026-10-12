/**
 * #2438 — the fail-closed tenant_isolation shape detector.
 *
 * WHAT THIS PROVES
 * ----------------
 * One character distinguishes a policy that denies a context-less query from a
 * policy that aborts it: whether `current_setting('app.current_tenant')` is
 * called with the `missing_ok` second argument. Without it Postgres raises
 * `unrecognized configuration parameter` and the whole statement dies; with it
 * the GUC becomes NULL, the comparison becomes NULL, and the row is denied. That
 * is the difference `0039_rls_fail_closed_policy.sql` was written to impose
 * (*"That is an ERROR, not a DENY — it aborts the entire statement"*, `0039:5-7`)
 * and the difference `0039:79-81` can hide, because its per-table loop swallows
 * every skip into a `RAISE WARNING`.
 *
 * A detector for that has to be tested against the shapes it will actually see,
 * so every fixture below is `pg_get_expr` output captured from a real database
 * in this repo's own migration order — the `0037` strict pair, the `0039` CASE
 * rewrite, the `0088` parent-reference form, the `0092` super-admin-bypass form
 * `contacts` actually carries in production, and the plain `NULLIF` form
 * `0107`/`0122`-class policies use. Four of the five must not match; the one
 * that must match is the aborting one.
 *
 * WHY BOTH DIRECTIONS
 * -------------------
 * A sweep that matches nothing looks identical to a schema with nothing wrong.
 * `nucrm_full` — a scratch database that had drifted into exactly that state —
 * is what made this issue look already-fixed for as long as nobody compared the
 * catalogue against a rule. So the detector is pinned by positive controls (a
 * strict policy IS named) and negative controls (fail-closed policies are NOT),
 * plus the discovery floor that makes "saw zero policies" an error rather than a
 * pass.
 *
 * The pattern is a *POSIX* string evaluated by Postgres (`e ~ pattern`), not a
 * JS regex, so `tests/integration/rls-policy-shape-2438.test.ts` runs the same
 * exported SQL against a live catalogue and re-checks both directions there.
 * What this file can pin statically is that the shape discrimination holds,
 * that the SQL and the JS characterisation read from one constant, and that the
 * verdict cannot silently degrade to a pass.
 */
import { describe, it, expect } from 'vitest';
import {
  STRICT_TENANT_ISOLATION_PATTERN,
  MIN_POLICY_EXPRESSIONS,
  buildShapeSweepSql,
  parseShapeSweep,
  evaluateShapeSweep,
} from '../../scripts/rls-policy-shape.mjs';

// ——— real `pg_get_expr` output, captured from migrated databases ———

/** `0037_tenant_isolation_hardening` for a table whose tenant_id is NOT NULL. */
const STRICT_0037 = `(tenant_id)::text = current_setting('app.current_tenant'::text)`;

/** `0039_rls_fail_closed_policy`'s rewrite. */
const FAILCLOSED_0039 = `(tenant_id IS NULL) OR (tenant_id =
 CASE
     WHEN (NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) THEN NULL::uuid
     ELSE (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid
 END)`;

/** `0088`-style child table, tenant resolved through a parent EXISTS. */
const PARENT_REF_0088 = `((NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid IS NOT NULL)
 AND EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_emails.contact_id) AND (c.tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)))`;

/** The shape `contacts` carries in production, from `0092`'s loop. */
const BYPASS_0092 = `((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)
  OR ((NULLIF(current_setting('app.is_super_admin'::text, true), ''::text))::boolean = true))`;

/** Plain strict-equality fail-closed form (`0107` / `0122`-class). */
const NULLIF_PLAIN = `(tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)`;

/** `0037`'s guard-plus-compare variant, also two-argument. */
const GUARD_0037 = `((current_setting('app.current_tenant'::text, true) <> ''::text)
  AND (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid))`;

const FAIL_CLOSED = [FAILCLOSED_0039, PARENT_REF_0088, BYPASS_0092, NULLIF_PLAIN, GUARD_0037];
const ABORTING = [STRICT_0037, `(tenant_id = current_setting('app.current_tenant'))`];

// Postgres evaluates the pattern with `~`; JS is used here only to pin the
// discrimination, and `[^,)]*` behaves identically in both engines.
const asJs = () => new RegExp(STRICT_TENANT_ISOLATION_PATTERN);

describe('tenant_isolation shape detector (#2438)', () => {
  it('names the single-argument call that aborts the statement', () => {
    for (const expr of ABORTING) {
      expect(asJs().test(expr), `should be flagged: ${expr.slice(0, 60)}`).toBe(true);
    }
  });

  it('does not name any fail-closed form, including the super-admin bypass shape', () => {
    for (const expr of FAIL_CLOSED) {
      expect(asJs().test(expr), `should NOT be flagged: ${expr.slice(0, 60)}`).toBe(false);
    }
  });

  it('is not fooled by the other tenant GUCs that share the expression', () => {
    // app.is_super_admin and app.auth_lookup are deliberate bypass paths; a
    // detector that tripped on them would be ignored within a week.
    expect(asJs().test(`((NULLIF(current_setting('app.is_super_admin'::text, true), ''::text))::boolean = true)`)).toBe(false);
    expect(asJs().test(`(current_setting('app.auth_lookup'::text) = 'true'::text)`)).toBe(false);
  });

  it('carries no quotes, so it cannot be silently mis-escaped inside the SQL literal', () => {
    // Doubling `'app.current_tenant'` inside a SQL string literal is exactly how
    // a sweep ends up matching nothing while reporting success.
    expect(STRICT_TENANT_ISOLATION_PATTERN).not.toContain("'");
    expect(STRICT_TENANT_ISOLATION_PATTERN).toContain('app\\.current_tenant');
  });
});

describe('the sweep reads both halves of the policy (#2438)', () => {
  const sql = buildShapeSweepSql();

  it('scans USING and WITH CHECK', () => {
    // 0037 emits a WITH CHECK too, so a write in a context-less session aborts
    // as well; a sweep over polqual alone would call that schema clean.
    expect(sql).toContain('pg_get_expr(p.polqual, p.polrelid)');
    expect(sql).toContain('pg_get_expr(p.polwithcheck, p.polrelid)');
    expect(sql).toContain("'WITH CHECK'");
  });

  it('builds its pattern from the single exported constant', () => {
    // The unit characterisation and the Postgres evaluation cannot drift apart.
    const occurrences = sql.split(STRICT_TENANT_ISOLATION_PATTERN).length - 1;
    expect(occurrences).toBe(2); // the FILTER for the count, and the FILTER for the list
  });

  it('scopes to public.tenant_isolation, where every tenant policy lives', () => {
    expect(sql).toContain("n.nspname = 'public'");
    expect(sql).toContain("p.polname = 'tenant_isolation'");
  });
});

describe('the verdict cannot silently degrade to a pass (#2438)', () => {
  it('parses psql -t -A -F output into numbers', () => {
    expect(parseShapeSweep('0||222\n')).toEqual({ strictCount: 0, offenders: '', total: 222 });
    expect(parseShapeSweep('1|contacts [USING]|222')).toEqual({
      strictCount: 1,
      offenders: 'contacts [USING]',
      total: 222,
    });
  });

  it('treats unparseable output as inconclusive, never as clean', () => {
    for (const junk of ['', 'psql: error', 'null|', undefined]) {
      const verdict = evaluateShapeSweep(parseShapeSweep(junk as string));
      expect(verdict.status).toBe('inconclusive');
      expect(verdict.status).not.toBe('pass');
    }
  });

  it('treats a schema with no policies as inconclusive, not as a pass', () => {
    // Zero offenders because zero policies were found is the vacuous case that
    // let the original defect through.
    //
    // #2450 AC5 keeps this asserted on purpose: `db:sync` produces exactly this
    // shape (227 tables, 0 policies), so this floor is what stops
    // `node scripts/apply-rls-ci.mjs` — and any future command wired over a
    // pushed schema — from reporting an unprotected database as secured.
    const verdict = evaluateShapeSweep({ strictCount: 0, offenders: '', total: 0 });
    expect(verdict.status).toBe('inconclusive');
    expect(verdict.message).toContain('did not run');
  });

  it('reports the floor it measured against', () => {
    const justUnder = evaluateShapeSweep({ strictCount: 0, offenders: '', total: MIN_POLICY_EXPRESSIONS - 1 });
    const justOver = evaluateShapeSweep({ strictCount: 0, offenders: '', total: MIN_POLICY_EXPRESSIONS });
    expect(justUnder.status).toBe('inconclusive');
    expect(justOver.status).toBe('pass');
  });

  it('fails, and names the offenders, when the aborting shape is present', () => {
    const verdict = evaluateShapeSweep({
      strictCount: 2,
      offenders: 'contacts [USING], contacts [WITH CHECK]',
      total: 221,
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.message).toContain('contacts [WITH CHECK]');
    expect(verdict.message).toContain('abort');
  });

  it('passes a production-shaped result', () => {
    // Measured live: 198 policies deparsing to 221 expressions, none aborting.
    expect(evaluateShapeSweep(parseShapeSweep('0||221')).status).toBe('pass');
  });
});
