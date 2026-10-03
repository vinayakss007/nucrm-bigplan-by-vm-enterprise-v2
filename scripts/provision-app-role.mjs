/**
 * #2253 — Provision the least-privilege application role and verify it.
 *
 * Runs scripts/provision-app-role.sql (idempotent, NON-schema) against the
 * CURRENT DATABASE_URL — which must be the migration OWNER role (e.g.
 * `postgres`), because only the owner can grant default privileges and manage
 * the role. The password for `nucrm_app` comes from `NUCRM_APP_PASSWORD` and is
 * NEVER echoed, logged, or written to disk.
 *
 * After provisioning it re-derives a `nucrm_app` connection string from the
 * owner URL and confirms, using the shared evaluator in
 * lib/db/least-privilege.ts, that the new role is genuinely subject to RLS
 * (non-superuser, non-BYPASSRLS).
 *
 * Usage:
 *   NUCRM_APP_PASSWORD=... node scripts/provision-app-role.mjs
 *
 * Env:
 *   DATABASE_URL        required — owner/admin connection (superuser is fine HERE)
 *   NUCRM_APP_PASSWORD  required — password to assign to nucrm_app
 *   OWNER_ROLE          optional — migration owner, default "postgres"
 *   SKIP_VERIFY=1       optional — provision without the re-verify step
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { evaluateRolePrivileges } from '../lib/db/least-privilege.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'provision-app-role.sql');

// Redacts any user:password segment so a URL can never leak into stdout/stderr.
function redact(u) {
  return String(u).replace(/\/\/[^@/]*@/, '//***:***@');
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const appPassword = process.env.NUCRM_APP_PASSWORD;
  const ownerRole = process.env.OWNER_ROLE || 'postgres';

  if (!databaseUrl) {
    console.error('[provision] DATABASE_URL is required (must be the migration OWNER role)');
    process.exit(1);
  }
  if (!appPassword) {
    console.error('[provision] NUCRM_APP_PASSWORD is required (from a secret manager, never committed)');
    process.exit(1);
  }

  console.log(`[provision] target db: ${redact(databaseUrl)}  owner: ${ownerRole}`);

  // 1. Run the idempotent provisioning SQL via psql, passing the password as a
  //    quoted psql variable (never inlined into the file).
  execFileSync('psql', [
    databaseUrl,
    '-v', 'ON_ERROR_STOP=1',
    '-v', `app_password=${appPassword}`,
    '-v', `owner_role=${ownerRole}`,
    '-f', sqlPath,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  console.log('[provision] provisioning SQL applied');
  if (process.env.SKIP_VERIFY === '1') return;

  verify(databaseUrl, appPassword).catch((e) => {
    console.error(`[provision] verify FAILED: ${e.message}`);
    process.exit(1);
  });
}

async function verify(databaseUrl, appPassword) {
  // Build a nucrm_app connection from the owner URL (same host/db, new creds).
  const u = new URL(databaseUrl);
  u.username = 'nucrm_app';
  u.password = appPassword;
  const appUrl = u.toString();

  const pool = new Pool({ connectionString: appUrl, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const { rows } = await pool.query(
      `SELECT current_user AS rolname,
              (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS rolsuper,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`,
    );
    const facts = rows[0] || {};
    const verdict = evaluateRolePrivileges({
      rolname: String(facts.rolname ?? 'nucrm_app'),
      rolsuper: Boolean(facts.rolsuper),
      rolbypassrls: Boolean(facts.rolbypassrls),
    });
    for (const f of verdict.findings) console.log(`  [${f.severity}] ${f.message}`);
    if (!verdict.ok) {
      console.error('[provision] nucrm_app is NOT least-privilege after provisioning');
      process.exit(1);
    }
    console.log('[provision] nucrm_app verified as least-privilege (RLS enforced)');
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
