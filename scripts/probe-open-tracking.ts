#!/usr/bin/env npx tsx
/**
 * Does the open-tracking pixel actually record an open? (#61)
 *
 * WHY THIS EXISTS
 * ---------------
 * The pixel URL was wrong (`/api/email/track/open?id=`, a path with no route,
 * answered 401 by the auth middleware) and is fixed in e6e0aa0c. A correct URL
 * is only half of "opens are recorded": `/api/track/open` runs its lookup and
 * its UPDATE on the bare pool with NO tenant context, because it is public and
 * unauthenticated, while `email_tracking` is RLS-guarded by a policy that only
 * matches the tenant named by `app.current_tenant`. If that combination hides
 * the row, the route answers 200 with a GIF, finds nothing, and records nothing
 * — the same silent-success failure mode as the bad URL, one layer down.
 *
 * Reading a count of 0 out of `email_tracking` proves nothing on its own: RLS
 * hides the table from a super-admin context too, so "no rows" and "no rows I am
 * allowed to see" look identical. This probe therefore seeds a real row through
 * the tenant's own context, drives the live HTTP endpoint, and reads it back
 * through a context that can see it.
 *
 * ASSERTIONS:
 *   1. A no-context session — what the public route uses — can see the seeded
 *      row by id. This is the mechanism under test.
 *   2. GET /api/track/open?t=<id> on the running container increments
 *      open_count and stamps opened_at.
 *   3. Teardown leaves nothing behind: the tracking row and any `Email opened`
 *      activity it caused are gone.
 *
 * SAFETY: writes only into a SIM tenant (name LIKE 'SIM%'), the rows are deleted
 * in the same run, and nothing real is touched.
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.gate.json --import ./scripts/load-env.mjs \
 *     scripts/probe-open-tracking.ts
 *   --skip-http   assert the RLS mechanism only (no container needed)
 */
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { Pool, type QueryResult } from 'pg';
import { pgSslConfig } from '../lib/db/ssl-config';

const SUBJECT = 'probe-open-tracking — not a real message';
const CONTAINER = 'nucrm-app';
const NO_USER = '00000000-0000-0000-0000-000000000000';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}

/**
 * Run `fn` inside a transaction that names `tenantId` for RLS — the identity a
 * sender (cron/process-sequences) carries. With NO tenant named it is the
 * anonymous context, which is what the public route runs in.
 */
async function inContext<T>(
  pool: Pool,
  tenantId: string,
  userId: string,
  fn: (query: (text: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>,
  superAdmin = false,
): Promise<T> {
  const client = await pool.connect();
  const query = (text: string, params?: unknown[]) => client.query(text, params as unknown[] | undefined);
  try {
    // set_config(…, true) is transaction-local, so everything here has to run
    // inside one: the tenant identity cannot outlive the connection checkout and
    // contaminate the next probe step.
    await query('BEGIN');
    await query(`SELECT set_config('app.current_tenant', $1, true), set_config('app.current_user', $2, true), set_config('app.is_super_admin', $3, true)`, [tenantId, userId, superAdmin ? 'true' : 'false']);
    const out = await fn(query);
    await query('COMMIT');
    return out;
  } catch (err) {
    await query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (process.env.PROBE_DATABASE_URL) process.env.DATABASE_URL = process.env.PROBE_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL / PROBE_DATABASE_URL is required');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: pgSslConfig(), connectionTimeoutMillis: 10_000, max: 2 });
  const probeId = randomUUID();

  // Fixture lookup runs as the platform-security context (that is the only
  // context `tenants` is reachable from); it is read-only, so the GUC cannot
  // leave anything behind.
  const fixtures = await inContext(pool, '', NO_USER, (query) =>
    query(`
      SELECT t.id AS tenant_id, t.name AS tenant_name, t.owner_id,
             (SELECT c.id FROM contacts c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL LIMIT 1) AS contact_id
      FROM tenants t
      WHERE t.name LIKE 'SIM%' AND t.deleted_at IS NULL AND t.owner_id IS NOT NULL
      ORDER BY t.created_at DESC LIMIT 1`),
    true,
  );
  const fix = fixtures.rows[0] as
    | { tenant_id: string; tenant_name: string; owner_id: string; contact_id: string | null }
    | undefined;
  if (!fix) {
    console.error('no SIM tenant with an owner to write into — refusing to run against a real customer');
    await pool.end();
    process.exit(2);
  }
  console.log(`target tenant: ${fix.tenant_name} (${fix.tenant_id})${fix.contact_id ? '' : '  [no contact — contact_id left null]'}`);

  // ── 1. Seed a tracking row exactly as the sender would ────────────────────
  const seeded = await inContext(pool, fix.tenant_id, fix.owner_id, (query) =>
    query(
      `INSERT INTO email_tracking (id, tenant_id, contact_id, recipient, subject, sent_at, open_count)
       VALUES ($1, $2, $3, $4, $5, now(), 0) RETURNING id`,
      [probeId, fix.tenant_id, fix.contact_id, 'probe-open-tracking@example.test', SUBJECT],
    )
  );
  check('seeded an email_tracking row through the tenant context a sender uses', seeded.rowCount === 1, probeId);

  // ── 2. The mechanism: can a NO-context session see it at all? ─────────────
  // Straight off the pool, with no GUC set — exactly the checkout the public
  // route gets, and the only way to ask the question honestly.
  const bare = await pool.query(`SELECT id, open_count FROM email_tracking WHERE id = $1`, [probeId]);
  check(
    'a no-context session (what /api/track/open runs in) can read the row by id',
    bare.rowCount === 1,
    bare.rowCount === 1 ? 'row visible' : 'row invisible → the route returns the GIF and records nothing',
  );

  const policy = await pool.query(
    `SELECT trim(regexp_replace(qual::text, '\\s+', ' ', 'g')) AS qual
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_tracking' LIMIT 1`
  );
  console.log(`         policy: ${String((policy.rows[0] as { qual?: string } | undefined)?.qual ?? 'NONE — table not RLS-enforced')}\n`);

  // ── 3. The live endpoint ──────────────────────────────────────────────────
  if (!process.argv.includes('--skip-http')) {
    try {
      const status = execFileSync('docker', ['exec', CONTAINER, 'node', '-e',
        `fetch('http://127.0.0.1:3000/api/track/open?t=${probeId}')` +
          `.then(r=>console.log(r.status+' '+r.headers.get('content-type')))` +
          `.catch(e=>{console.error(e.message);process.exit(1)})`,
      ], { encoding: 'utf8', timeout: 30_000 }).trim();
      console.log(`         GET /api/track/open?t=… → ${status}`);
    } catch (err) {
      check('the running container answered the pixel request', false, (err as Error).message.split('\n')[0]);
    }
    // The route records the open fire-and-forget, so give it a moment.
    await new Promise((r) => setTimeout(r, 1_500));
  }

  const after = await inContext(pool, fix.tenant_id, fix.owner_id, (query) =>
    query(`SELECT open_count, opened_at::text AS opened_at FROM email_tracking WHERE id = $1`, [probeId])
  );
  const row = after.rows[0] as { open_count: number; opened_at: string | null } | undefined;
  check(
    'the pixel request incremented open_count and stamped opened_at',
    (row?.open_count ?? 0) >= 1 && (row?.opened_at ?? null) !== null,
    row ? `open_count=${row.open_count} opened_at=${row.opened_at ?? 'NULL'}` : 'row not found',
  );

  const failures = await pool.query(
    `SELECT message FROM error_logs
     WHERE context->>'context' = 'track/open' AND created_at > now() - interval '2 minutes'
     ORDER BY created_at DESC LIMIT 1`
  );
  if (failures.rowCount) console.log(`         error_logs says: ${String((failures.rows[0] as { message: string }).message).slice(0, 200)}`);

  // ── 4. Teardown ───────────────────────────────────────────────────────────
  await inContext(pool, fix.tenant_id, fix.owner_id, async (query) => {
    await query(`DELETE FROM activities WHERE metadata->>'tracking_id' = $1`, [probeId]);
    await query(`DELETE FROM email_tracking WHERE id = $1`, [probeId]);
  });
  const left = await pool.query(`SELECT count(*)::int AS c FROM email_tracking WHERE id = $1`, [probeId]);
  check('teardown removed the probe row', (left.rows[0] as { c: number }).c === 0, `${(left.rows[0] as { c: number }).c} left`);

  await pool.end();
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0
    ? '\nRESULT: an open through /api/track/open is recorded end to end\n'
    : `\nRESULT: ${failed.length} check(s) failed — ${failed.map((f) => f.name).join('; ')}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('probe failed:', err instanceof Error ? err.message : String(err));
  process.exit(2);
});
