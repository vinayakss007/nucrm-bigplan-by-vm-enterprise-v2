/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2455 — one extraction of the `tenant_isolation` policy that migration 0092
 * actually ships, so a test can prove that object instead of a copy of it.
 *
 * `tests/integration/superadmin-panel-sql.test.ts` used to type the policy's
 * USING/WITH CHECK arms into the file by hand. Two things go wrong with a
 * hand-typed copy: the shipped object and the tested object are two strings that
 * nothing ties together, so the day a migration changes the arm the test keeps
 * proving the OLD rule; and the copy is what gets CREATEd after the suite has
 * DROPped the real one, so the test also *installs* its private idea of RLS over
 * the database's. #2438 was filed for exactly this failure mode.
 *
 * So the fixture text here is read out of `0092_metrics_tables_superadmin_bypass.sql`
 * at run time. If that migration stops mentioning `app.is_super_admin`, or
 * regresses to the single-argument `current_setting()` call that RAISES
 * `unrecognized configuration parameter` instead of denying, this module throws
 * and the suites that depend on it fail — rather than quietly re-adding by hand
 * what the migration removed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATION_0092 = join(
  'drizzle',
  'migrations',
  '0092_metrics_tables_superadmin_bypass.sql',
);

/** The policy name 0092 (re)creates on each table in its loop. */
export const SHIPPED_POLICY_NAME = 'tenant_isolation';

/**
 * A `current_setting()` called with one argument raises 42704 on an unset GUC,
 * which aborts the statement instead of denying the row — the shape #2438
 * exists to keep out of the schema. Two-arg form returns NULL, the comparison
 * yields NULL, RLS denies. In migration source the arity is visible directly:
 * a raising call closes right after its string.
 */
const RAISING_CURRENT_SETTING = /current_setting\(\s*'[^']*'\s*\)/;

export type ShippedPolicy = {
  /**
   * The full `CREATE POLICY …` statement for one table, whitespace-normalised.
   * `policyName` defaults to the shipped one; a test that must not overwrite a
   * shipped object passes its own name and gets the same arms under it.
   */
  statementFor: (table: string, policyName?: string) => string;
  /** The single-line template as it appears in the migration, `%I` intact. */
  template: string;
  /** Every `current_setting()` name the arms consult — proves the bypass is one of them. */
  settings: string[];
};

/**
 * Pull the `format('CREATE POLICY …', t)` template out of 0092.
 *
 * The migration spells the statement as a run of adjacent single-quoted SQL
 * literals — Postgres' own concatenation rules inside `format()` — with every
 * embedded quote doubled (`''`). Reassembling it means collecting those literals
 * and un-doubling their quotes, not copying the block: the copy is what drifted.
 */
export function readShippedPolicy(migrationPath = MIGRATION_0092, root = '.'): ShippedPolicy {
  const source = readFileSync(join(root, migrationPath), 'utf8');
  const start = source.indexOf("'CREATE POLICY");
  if (start === -1) {
    throw new Error(`${migrationPath} no longer builds a CREATE POLICY statement — #2455's extraction has nothing to read`);
  }

  const parts: string[] = [];
  let i = start;
  let done = false;
  while (i < source.length && !done) {
    if (source[i] !== "'") {
      // Adjacent literals are separated only by whitespace and newlines; anything
      // else means the template ended earlier than expected.
      if (!/\s/.test(source[i] as string)) break;
      i++;
      continue;
    }
    let j = i + 1;
    let literal = '';
    while (j < source.length) {
      if (source[j] === "'") {
        if (source[j + 1] === "'") { literal += "'"; j += 2; continue; }
        break;
      }
      literal += source[j];
      j++;
    }
    parts.push(literal);
    i = j + 1;
    // The last chunk of the template closes the statement with `);`.
    if (literal.trimEnd().endsWith(');')) done = true;
  }

  const template = parts.join('').replace(/\s+/g, ' ').trim();
  if (!/^CREATE POLICY/.test(template) || !template.includes('WITH CHECK')) {
    throw new Error(`extracted policy template from ${migrationPath} is not a complete CREATE POLICY … WITH CHECK statement: ${template.slice(0, 120)}`);
  }
  if (!template.includes('app.is_super_admin')) {
    throw new Error(
      `${migrationPath} no longer gives tenant_isolation an app.is_super_admin arm. `
      + 'The super-admin RLS proofs in tests/integration depend on that bypass; update them deliberately rather than letting a fixture re-add it.',
    );
  }
  if (RAISING_CURRENT_SETTING.test(template)) {
    throw new Error(
      `${migrationPath} shipped a single-argument current_setting() in tenant_isolation — that raises instead of denying (#2438).`,
    );
  }

  const settings = [...new Set([...template.matchAll(/current_setting\(\s*'([^']+)'/g)].map((m) => m[1] as string))];

  return {
    template,
    settings,
    statementFor: (table: string, policyName = SHIPPED_POLICY_NAME) => {
      // Both land inside a quoted identifier in DDL, so only the characters
      // Postgres itself allows unquoted-and-lowercase are accepted here.
      const ident = /^[a-z_][a-z0-9_]*$/;
      if (!ident.test(table) || !ident.test(policyName)) {
        throw new Error(`refusing to build DDL for a non-conforming identifier: ${table} / ${policyName}`);
      }
      return template.replace(`"${SHIPPED_POLICY_NAME}"`, `"${policyName}"`).replace('%I', `"${table}"`);
    },
  };
}

/** One row of `pg_policies`, restricted to what decides whether a super admin is admitted. */
export type CapturedPolicy = {
  name: string;
  cmd: string;
  permissive: string;
  roles: string[];
  qual: string | null;
  withCheck: string | null;
};

/**
 * Does this table's RLS actually let `app.is_super_admin` through, on both sides
 * of the statement?
 *
 * `USING` gates the rows a command may see; `WITH CHECK` gates the rows a command
 * may write. A policy that only carries the bypass in one of them is HALF a
 * super-admin bypass, which is exactly the state that made #2455's suite read a
 * row it could not mark. Reading `pg_policies` and asking this question keeps the
 * test honest about the LIVE object instead of the one it just created.
 *
 * Only a policy that applies to everyone counts. A bypass written `TO
 * some_other_role` does nothing for this suite's role, and treating it as enough
 * would leave the proof running with no policy it can use. The asymmetry is
 * deliberate: guessing WRONG here installs a second, distinctly-named fixture that
 * teardown drops, which costs nothing, while guessing it the other way makes the
 * suite's own INSERT fail.
 */
export function admitsSuperAdmin(policies: CapturedPolicy[]): { reads: boolean; writes: boolean } {
  const appliesToEveryone = (roles: string[]) =>
    roles.length === 0 || roles.some((r) => r === 'public' || r === '=public');
  const hasBypass = (arm: string | null) => (arm ?? '').includes('app.is_super_admin');
  const usable = policies.filter((p) => appliesToEveryone(p.roles ?? []));
  return {
    reads: usable.some((p) => (p.cmd === 'ALL' || p.cmd === 'SELECT') && hasBypass(p.qual)),
    writes: usable.some((p) => (p.cmd === 'ALL' || p.cmd === 'INSERT') && hasBypass(p.withCheck)),
  };
}
