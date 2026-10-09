/**
 * Capture / restore of one table's RLS state, for integration tests that have to
 * change it (#2455).
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/integration/superadmin-panel-sql.test.ts` proved the trial-check RLS
 * behaviour by dropping **every** policy on `activities` and re-creating one it
 * typed by hand. Two things followed from that: a second policy on that table —
 * added by some future migration — was destroyed on every database the suite ran
 * against, and the policy the proof relied on was a copy of a string rather than
 * the shipped object, so a migration that changed or removed the
 * `app.is_super_admin` bypass kept passing the test while the schema got worse.
 * #2451 hit the same class on `contacts` and fixed it in
 * `rls-connection-affinity.test.ts`; this is that pattern, generalised (any
 * policy name, not just `tenant_isolation`) so the `activities` half got the same
 * treatment.
 *
 * The pure half (`buildCreatePolicySql`, `planRlsRestore`, the flag statements) is
 * what the unit tests plant violations against: `pg_policies.qual` /
 * `.with_check` are Postgres' own deparses, which are valid input to
 * `USING (…)` / `WITH CHECK (…)`, so restoring that text verbatim is the whole
 * trick — nothing is re-typed and nothing is invented.
 */
import type { Pool } from 'pg';

export type CapturedPolicy = {
  name: string;
  /** pg_policies.cmd, already upper-cased by Postgres: ALL | SELECT | INSERT | UPDATE | DELETE */
  cmd: string;
  /** PERMISSIVE | RESTRICTIVE */
  permissive: string;
  roles: string[];
  qual: string | null;
  withCheck: string | null;
};

export type CapturedRls = {
  table: string;
  enabled: boolean;
  forced: boolean;
  policies: CapturedPolicy[];
};

const POLICY_COMMANDS = new Set(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']);
const POLICY_STRICTNESS = new Set(['PERMISSIVE', 'RESTRICTIVE']);

const quoteIdent = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/**
 * Rebuild a `CREATE POLICY` from the catalogue row that described it. Throws on a
 * cmd/permissive value Postgres would not itself have reported, because a
 * hand-waved `FOR ALL` in a restore would put back something *near* what was
 * there — the failure mode this module exists to end.
 */
export function buildCreatePolicySql(table: string, policy: CapturedPolicy): string {
  if (!POLICY_COMMANDS.has(policy.cmd)) {
    throw new Error(`unexpected policy command on ${table}.${policy.name}: ${policy.cmd}`);
  }
  if (!POLICY_STRICTNESS.has(policy.permissive)) {
    throw new Error(`unexpected policy strictness on ${table}.${policy.name}: ${policy.permissive}`);
  }
  return [
    `CREATE POLICY ${quoteIdent(policy.name)} ON ${quoteIdent(table)}`,
    `AS ${policy.permissive}`,
    `FOR ${policy.cmd}`,
    `TO ${policy.roles.map(quoteIdent).join(', ') || 'public'}`,
    `USING (${policy.qual ?? 'TRUE'})`,
    ...(policy.withCheck ? [`WITH CHECK (${policy.withCheck})`] : []),
  ].join(' ');
}

/**
 * The statements that put `table` back the way `before` described it, given the
 * policy names live now:
 *
 * 1. drop every name `before` did not have — i.e. only what this suite added,
 *    never a policy some other migration created while it ran;
 * 2. for each captured policy, `DROP … IF EXISTS` its own name and then re-create
 *    it from its own catalogue text;
 * 3. restore the ENABLE / FORCE ROW LEVEL SECURITY flags, which `beforeAll` may
 *    have set on a table that never had them.
 *
 * Step 2 drops before it creates because the suite is not the only thing that can
 * touch the table: a policy left in place and merely altered in place would
 * "restore" clean while shipping the altered text, and one still present would
 * make a bare `CREATE POLICY` fail with `already exists`. Re-issuing the captured
 * row is both idempotent and exact — the catalogue text is the restore, so the
 * table ends up byte-for-byte as it started even when nothing was dropped.
 */
export function planRlsRestore(before: CapturedRls, livePolicyNames: string[]): string[] {
  const captured = new Set(before.policies.map((p) => p.name));
  const statements: string[] = [];

  for (const name of livePolicyNames) {
    if (!captured.has(name)) {
      statements.push(`DROP POLICY IF EXISTS ${quoteIdent(name)} ON ${quoteIdent(before.table)}`);
    }
  }
  for (const policy of before.policies) {
    // Includes a captured policy that is missing now — an earlier partial run may
    // have dropped it, and capture-then-diff alone would not bring it back.
    statements.push(`DROP POLICY IF EXISTS ${quoteIdent(policy.name)} ON ${quoteIdent(before.table)}`);
    statements.push(buildCreatePolicySql(before.table, policy));
  }

  statements.push(
    `ALTER TABLE ${quoteIdent(before.table)} ${before.enabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`,
  );
  if (before.forced) {
    statements.push(`ALTER TABLE ${quoteIdent(before.table)} FORCE ROW LEVEL SECURITY`);
  } else {
    statements.push(`ALTER TABLE ${quoteIdent(before.table)} NO FORCE ROW LEVEL SECURITY`);
  }
  return statements;
}

/**
 * `pg_class` calls the RLS flag `relforcerowsecurity` up to PostgreSQL 17 and
 * `relforcerls` from 18 on, and CI runs 16 while preprod runs 18 — so probe for
 * whichever column this server has instead of letting the snapshot query die on a
 * missing column and taking the whole file with it.
 */
async function readRlsFlags(pool: Pool, table: string): Promise<{ enabled: boolean; forced: boolean }> {
  const { rows: cols } = await pool.query<{ attname: string }>(
    `SELECT attname FROM pg_attribute WHERE attrelid = 'pg_class'::regclass AND attname IN ('relrowsecurity', 'relforcerowsecurity', 'relforcerls')`,
  );
  const names = new Set(cols.map((c) => c.attname));
  const forcedCol = names.has('relforcerowsecurity') ? 'relforcerowsecurity' : names.has('relforcerls') ? 'relforcerls' : null;
  if (!names.has('relrowsecurity')) return { enabled: false, forced: false };

  const { rows } = await pool.query<{ enabled: boolean; forced: boolean | null }>(
    `SELECT c.relrowsecurity AS enabled, ${forcedCol ? `c.${forcedCol}` : 'false'} AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [table],
  );
  return { enabled: rows[0]?.enabled === true, forced: rows[0]?.forced === true };
}

/** Every policy on `table`, whatever it is named, as Postgres reports it. */
export async function captureTableRls(pool: Pool, table: string): Promise<CapturedRls> {
  const flags = await readRlsFlags(pool, table);
  // `pg_policies` is scoped by schema + table, so this cannot pick up a same-named
  // policy on a relation in another schema. `roles` is cast to text[] because the
  // view declares name[], which node-postgres hands back as the raw `{public}`.
  const { rows } = await pool.query<{
    policyname: string;
    cmd: string;
    permissive: string;
    roles: string[] | null;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT policyname, cmd, permissive, roles::text[] AS roles, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = $1
      ORDER BY policyname`,
    [table],
  );

  return {
    table,
    ...flags,
    policies: rows.map((r) => ({
      name: r.policyname,
      cmd: r.cmd,
      permissive: r.permissive,
      roles: r.roles ?? [],
      qual: r.qual,
      withCheck: r.with_check,
    })),
  };
}

export async function listPolicyNames(pool: Pool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ polname: string }>(
    `SELECT p.polname
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [table],
  );
  return rows.map((r) => r.polname);
}

/**
 * Put `before` back and report what could not be put back. Failures are returned
 * rather than swallowed: `.catch(() => {})` over a restore is how a shared
 * database ends up quietly missing a production policy (#2451's lesson, restated
 * here for `activities`).
 */
export async function restoreTableRls(
  pool: Pool,
  before: CapturedRls,
): Promise<{ statements: number; failures: string[] }> {
  const live = await listPolicyNames(pool, before.table);
  const statements = planRlsRestore(before, live);
  const failures: string[] = [];

  // One transaction: a restore that dies halfway would leave the table with
  // neither the old policies nor the new ones.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (err) {
        failures.push(`${statement.slice(0, 60)}…: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    if (failures.length === 0) await client.query('COMMIT');
    else await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  if (failures.length > 0) {
    // The rollback put the table back to wherever it had got to; try each
    // statement on its own so one bad CREATE POLICY does not hide the rest.
    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        failures.push(`${statement.slice(0, 60)}…: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { statements: statements.length, failures };
}
