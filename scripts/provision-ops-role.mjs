#!/usr/bin/env node
/**
 * #3280 (ask 1) — Provision the read-only operator role and verify it.
 *
 * Runs scripts/provision-ops-role.sql (idempotent, NON-schema) against the
 * CURRENT DATABASE_URL — which must be the migration OWNER role (e.g.
 * `postgres`), because only the owner can grant default privileges and manage
 * the role. The password for `nucrm_ops` comes from `NUCRM_OPS_PASSWORD` and is
 * NEVER echoed, logged, or written to disk.
 *
 * After provisioning it connects AS `nucrm_ops` and proves three things, each
 * by asking the database rather than by re-reading the script:
 *
 *   1. the role is BYPASSRLS and not a superuser — an operator's count is the
 *      real count, and it still cannot escalate;
 *   2. every session it opens is READ-ONLY — Postgres refuses a write in the
 *      role's own session, which is a stronger claim than "we granted SELECT";
 *   3. the app role is still RLS-bound — the one mistake that would undo
 *      #2253.
 *
 * Usage:
 *   NUCRM_OPS_PASSWORD=... node scripts/provision-ops-role.mjs
 *
 * Env:
 *   DATABASE_URL        required — owner/admin connection (superuser is fine HERE)
 *   NUCRM_OPS_PASSWORD  required — password to assign to nucrm_ops
 *   OWNER_ROLE          optional — migration owner, default "postgres"
 *   SKIP_VERIFY=1       optional — provision without the verify step
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { pgSslConfig } from '../lib/db/ssl-config.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, 'provision-ops-role.sql');

/** Redacts any user:password segment so a URL can never leak into stdout/stderr. */
function redact(u) {
  return String(u).replace(/\/\/[^@/]*@/, '//***:***@');
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const opsPassword = process.env.NUCRM_OPS_PASSWORD;
  const ownerRole = process.env.OWNER_ROLE || 'postgres';

  if (!databaseUrl) {
    console.error('[provision-ops] DATABASE_URL is required (must be the migration OWNER role)');
    process.exit(1);
  }
  if (!opsPassword) {
    console.error('[provision-ops] NUCRM_OPS_PASSWORD is required (from a secret manager, never committed)');
    process.exit(1);
  }

  console.log(`[provision-ops] target db: ${redact(databaseUrl)}  owner: ${ownerRole}`);

  // 1. Run the idempotent provisioning SQL via psql, passing the password as a
  //    quoted psql variable (never inlined into the file).
  execFileSync('psql', [
    databaseUrl,
    '-v', 'ON_ERROR_STOP=1',
    '-v', `ops_password=${opsPassword}`,
    '-v', `owner_role=${ownerRole}`,
    '-f', sqlPath,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  console.log('[provision-ops] provisioning SQL applied');
  if (process.env.SKIP_VERIFY === '1') return;

  verify(databaseUrl, opsPassword).catch((e) => {
    console.error(`[provision-ops] verify FAILED: ${e.message}`);
    process.exit(1);
  });
}

async function verify(databaseUrl, opsPassword) {
  // Build a nucrm_ops connection from the owner URL (same host/db, new creds).
  const u = new URL(databaseUrl);
  u.username = 'nucrm_ops';
  u.password = opsPassword;
  const opsUrl = u.toString();

  // #3381: the URL inherits DATABASE_URL's query string, but node-pg reads no
  // `sslmode` — the shared policy is the only thing that puts TLS on this connection.
  const pool = new Pool({ connectionString: opsUrl, ssl: pgSslConfig(), max: 1, connectionTimeoutMillis: 8000 });
  try {
    const { rows } = await pool.query(
      `SELECT current_user AS rolname,
              (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS rolsuper,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls`,
    );
    const facts = rows[0] || {};
    const rolname = String(facts.rolname ?? '');
    const rolsuper = Boolean(facts.rolsuper);
    const rolbypassrls = Boolean(facts.rolbypassrls);

    if (rolname !== 'nucrm_ops') {
      throw new Error(`connected as ${rolname || '(unknown)'}, expected nucrm_ops`);
    }
    if (rolsuper) {
      throw new Error('nucrm_ops is a superuser — BYPASSRLS is enough, and a superuser can escalate');
    }
    if (!rolbypassrls) {
      throw new Error('nucrm_ops is not BYPASSRLS — an operator count would be filtered, which is the bug #3280 is about');
    }
    console.log('  [OK] nucrm_ops is BYPASSRLS and not a superuser');

    // The read-only default is the role's own setting, so ask the session.
    const { rows: ro } = await pool.query('SHOW default_transaction_read_only');
    const readOnly = String(ro?.[0]?.default_transaction_read_only ?? '');
    if (readOnly !== 'on') {
      throw new Error(`default_transaction_read_only is "${readOnly}", expected "on" — the role is not read-only`);
    }
    console.log('  [OK] every nucrm_ops session starts read-only');

    // Prove the database refuses the write, rather than trusting the GRANT
    // list: a read-only transaction rejects a row lock outright. The probe is
    // wrapped in a transaction that is rolled back either way.
    let refused = false;
    try {
      await pool.query('BEGIN');
      // `tenants` carries a USING (true) SELECT policy, so this statement is
      // not an un-armed read of an RLS-filtered table (#3280's own screen);
      // the row lock is what is being measured, not the row.
      await pool.query('SELECT 1 FROM tenants LIMIT 1 FOR UPDATE');
      await pool.query('ROLLBACK');
    } catch (err) {
      refused = /read-only/i.test(String(err?.message ?? ''));
      try { await pool.query('ROLLBACK'); } catch { /* the transaction is already gone */ }
    }
    if (!refused) {
      throw new Error('nucrm_ops was able to take a row lock — the role is NOT read-only');
    }
    console.log('  [OK] the database refused a write from nucrm_ops');

    // The app role must still be RLS-bound: BYPASSRLS is inheritable, and a
    // membership in either direction would hand the application a bypass.
    const { rows: members } = await pool.query(
      `SELECT member.rolname AS member, granted.rolname AS granted
         FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles granted ON granted.oid = m.roleid
        WHERE (member.rolname = 'nucrm_ops' AND granted.rolname = 'nucrm_app')
           OR (member.rolname = 'nucrm_app' AND granted.rolname = 'nucrm_ops')`,
    );
    if (members.length > 0) {
      throw new Error(
        `nucrm_ops and nucrm_app are members of each other (${members.map((m) => `${m.member} -> ${m.granted}`).join(', ')}) — `
        + 'BYPASSRLS is inherited, and the app role must stay RLS-bound',
      );
    }
    console.log('  [OK] nucrm_app and nucrm_ops are not members of each other');

    console.log('[provision-ops] nucrm_ops verified: BYPASSRLS, read-only, not a superuser');
    console.log(`[provision-ops] connect as: ${redact(opsUrl)}  (password from the secret manager)`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
