/**
 * #2253 / #2306 — Guard: the CURRENT DATABASE_URL role must not be able to
 * bypass RLS.
 *
 * Fails (exit 1) if the role the connection authenticates as is a cluster
 * SUPERUSER or has BYPASSRLS — the exact condition that silently turns every
 * `tenant_isolation` policy into a no-op. Also flags the subtler owner-exempt
 * case: the role owns tenant tables that are not FORCE ROW LEVEL SECURITY.
 *
 * This is the CLI face of `lib/db/least-privilege.ts`, which is the single
 * source of truth for the invariant: the SQL, the verdict logic and the message
 * redaction all live there, so the nightly guard (`.github/workflows/
 * nightly-soak.yml`), the deploy gate (`.github/workflows/deploy.yml`) and the
 * app startup guard (`lib/db/role-privilege-guard.ts`) cannot drift apart.
 *
 * It reads only catalog metadata (no rows), so it is safe to point at production.
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
import {
  assertRoleIsRlsConstrained,
  redactConnectionString,
  RlsRoleBypassError,
} from '../lib/db/least-privilege.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
  if (!config({ path: join(ROOT, file), quiet: true }).error) break;
}

/** Masks the user:password segment only, so the host/DB stay readable in logs. */
function redact(u) {
  return String(u).replace(/\/\/[^@/\s]*@/, '//***:***@');
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
    // One runner, one probe, one verdict — exactly what the deploy gate, the
    // nightly guard and the app startup check.
    const run = (sql) => pool.query(sql);
    let verdict;
    try {
      verdict = await assertRoleIsRlsConstrained(run);
    } catch (err) {
      if (!(err instanceof RlsRoleBypassError)) throw err;
      for (const f of err.verdict ? err.verdict.findings : []) {
        console.log(`  [${f.severity === 'fail' ? 'FAIL' : 'OK'}] ${f.message}`);
      }
      console.error(`[check-db-role] ${redact(err.message)}`);
      console.error('[check-db-role] connection role can bypass RLS (#2253/#2306) — refusing');
      process.exit(1);
    }

    console.log(`[check-db-role] db: ${redact(databaseUrl)}`);
    for (const f of verdict.findings) {
      const tag = f.severity === 'fail' ? 'FAIL' : 'OK';
      console.log(`  [${tag}] ${f.message}`);
    }
    console.log('[check-db-role] PASS — RLS is enforced against the connection role');
  } catch (err) {
    // A driver error can echo the URL back — scrub it completely, not just the
    // credential segment.
    console.error(
      `[check-db-role] error: ${redactConnectionString(err instanceof Error ? err.message : String(err))}`,
    );
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
