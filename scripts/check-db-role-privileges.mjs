/**
 * #2253 — Guard: the CURRENT DATABASE_URL role must not be able to bypass RLS.
 *
 * Fails (exit 1) if the role the connection authenticates as is a cluster
 * SUPERUSER or has BYPASSRLS — the exact condition that silently turns every
 * `tenant_isolation` policy into a no-op. Also flags the subtler owner-exempt
 * case: the role owns tenant tables that are not FORCE ROW LEVEL SECURITY.
 *
 * This is a lightweight, dependency-cheap check meant to run in CI and in the
 * preflight/operator path so an accidental superuser connection is caught
 * before it serves tenant data. It reads only metadata (no rows), so it is safe
 * to point at production.
 *
 * Usage (tsx is used because the shared evaluator is TypeScript):
 *   npx tsx scripts/check-db-role-privileges.mjs
 *   DATABASE_URL=... npx tsx scripts/check-db-role-privileges.mjs
 *
 * Exit codes: 0 = RLS is enforced against this role; 1 = bypass risk / error.
 * NEVER prints the connection string or password.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { evaluateRolePrivileges } from '../lib/db/least-privilege.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
  if (!config({ path: join(ROOT, file), quiet: true }).error) break;
}

function redact(u) {
  return String(u).replace(/\/\/[^@/]*@/, '//***:***@');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[check-db-role] DATABASE_URL is required');
    process.exit(1);
  }

  let ssl = false;
  try {
    const mod = await import('../lib/db/ssl-config');
    ssl = mod.pgSslConfig();
  } catch {
    /* fall back to no ssl override */
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl, connectionTimeoutMillis: 8000 });
  try {
    const who = await pool.query(
      `SELECT current_user AS rolname,
              (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS rolsuper,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`,
    );
    const role = who.rows[0];
    if (!role) {
      console.error('[check-db-role] could not determine connecting role');
      process.exit(1);
    }

    // How many tenant-scoped (uuid tenant_id) tables does this role own, and
    // are any of them not FORCE'd? Ownership + no-FORCE => owner exempt.
    const own = await pool.query(
      `SELECT count(*) FILTER (WHERE NOT c.relforcerowsecurity)::int AS unforced_owned,
              count(*)::int                                          AS owned
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attisdropped = false
         JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'uuid'
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    );
    const owned = own.rows[0]?.owned ?? 0;
    const unforcedOwned = own.rows[0]?.unforced_owned ?? 0;

    const verdict = evaluateRolePrivileges({
      rolname: String(role.rolname),
      rolsuper: Boolean(role.rolsuper),
      rolbypassrls: Boolean(role.rolbypassrls),
      ownsTenantTables: owned,
      hasUnforcedTables: unforcedOwned > 0,
    });

    console.log(`[check-db-role] db: ${redact(databaseUrl)}  role: ${role.rolname}`);
    for (const f of verdict.findings) {
      const tag = f.severity === 'fail' ? 'FAIL' : 'OK';
      console.log(`  [${tag}] ${f.message}`);
    }

    if (!verdict.ok) {
      console.error('[check-db-role] connection role can bypass RLS (#2253) — refusing');
      process.exit(1);
    }
    console.log('[check-db-role] PASS — RLS is enforced against the connection role');
  } catch (err) {
    console.error(`[check-db-role] error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
