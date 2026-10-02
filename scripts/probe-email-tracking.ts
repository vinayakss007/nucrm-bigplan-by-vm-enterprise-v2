#!/usr/bin/env npx tsx
/**
 * Do the two public email-tracking endpoints record anything? (#61, #63)
 *
 * WHY THIS EXISTS
 * ---------------
 * Two layers of the same silent-success bug.
 *
 * 1. The pixel URL was wrong (`/api/email/track/open?id=`, a path with no
 *    route, answered 401 by the auth middleware) — fixed in e6e0aa0c.
 * 2. A correct URL is only half of "opens are recorded". `/api/track/open` and
 *    `/api/track/click` are public, so their connection carries no
 *    `app.current_tenant`, while `email_tracking` had a single policy that only
 *    matches the tenant named by that GUC. The lookup found nothing, so:
 *      /open   answered 200 with a GIF and never moved open_count;
 *      /click  failed its #1981 gate, so a real link redirected to '/' too.
 *    Neither raised an error — RLS refuses by matching zero rows.
 *
 * Reading a count of 0 out of `email_tracking` proves nothing on its own: RLS
 * hides the table from a super-admin context as well, so "no rows" and "no rows
 * I am allowed to see" look identical. This probe therefore seeds a real row
 * through the tenant's own context, asks what each context can see, drives the
 * live HTTP endpoints, and reads the result back through a context that can.
 *
 * ASSERTIONS:
 *   1. A no-context session cannot read the row — the mechanism, and the proof
 *      that the privilege granted in 0105 is narrow rather than a hole.
 *   2. A session with app.tracking_lookup CAN read it by id (needs migration
 *      0105 applied; this check is the live gate on that migration).
 *   3. GET /api/track/open?t=<id> increments open_count, stamps opened_at and,
 *      when the row names a contact, writes the one "Email opened" activity.
 *   4. GET /api/track/click?t=<id>&url=<wrapped> redirects to the wrapped URL
 *      (not '/'), increments click_count and stamps clicked_at.
 *   5. Teardown leaves nothing behind.
 *
 * SAFETY: writes only into a SIM tenant (name LIKE 'SIM%'), the rows are deleted
 * in the same run, and nothing real is touched.
 *
 * Usage:
 *   npm run probe:email-tracking
 *   --skip-http   assert the RLS mechanism only (no container needed)
 */
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { Pool, type QueryResult } from 'pg';
import { pgSslConfig } from '../lib/db/ssl-config';

const SUBJECT = 'probe-email-tracking — not a real message';
const RECIPIENT = 'probe-email-tracking@example.test';
const CONTAINER = 'nucrm-app';
/** The destination a sender would wrap. Pre-encoded exactly as a mail client
 *  would send it, because the route decodeURIComponent()s the param. */
const WRAPPED = 'https%3A%2F%2Fexample.com%2Fprobe-click';
const WRAPPED_EXPECT = 'https://example.com/probe-click';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}

/**
 * Run `fn` inside ONE transaction that names `tenantId` for RLS — the identity
 * a sender (cron/process-sequences) carries. Empty `tenantId` with
 * `trackingLookup` is the public pixel's read; empty and no lookup GUC is the
 * anonymous context the routes used to run in.
 */
async function inContext<T>(
  pool: Pool,
  opts: { tenantId?: string; userId?: string; superAdmin?: boolean; trackingLookup?: boolean },
  fn: (query: (text: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const query = (text: string, params?: unknown[]) =>
    client.query(text, params as unknown[] | undefined);
  try {
    // set_config(…, true) is transaction-local, so everything here has to run
    // inside one: a GUC cannot outlive the checkout and contaminate the next
    // probe step — which is also exactly why the routes must be checked this way.
    await query('BEGIN');
    await query(
      `SELECT set_config('app.current_tenant', $1, true),
              set_config('app.current_user', $2, true),
              set_config('app.is_super_admin', $3, true),
              set_config('app.tracking_lookup', $4, true)`,
      [
        opts.tenantId ?? '',
        opts.userId ?? '',
        opts.superAdmin ? 'true' : 'false',
        opts.trackingLookup ? 'true' : '',
      ],
    );
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

/** Run one request through the app container and print status + one header. */
function fetchInContainer(path: string, header: string): string {
  return execFileSync('docker', ['exec', CONTAINER, 'node', '-e',
    `fetch('http://127.0.0.1:3000${path}',{redirect:'manual'})` +
      `.then(r=>console.log(r.status+' '+(r.headers.get('${header}')??'-')))` +
      `.catch(e=>{console.error(e.message);process.exit(1)})`,
  ], { encoding: 'utf8', timeout: 30_000 }).trim();
}

async function main(): Promise<void> {
  if (process.env.PROBE_DATABASE_URL) process.env.DATABASE_URL = process.env.PROBE_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL / PROBE_DATABASE_URL is required');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: pgSslConfig(), connectionTimeoutMillis: 10_000, max: 2 });
  const probeId = randomUUID();

  // A contact-bearing tenant is worth having: the "Email opened"/"Email link
  // clicked" activity rows are only written when the tracking row names one, so
  // without a contact two of the assertions below would go untested. The fixture
  // read runs as the platform-security context (the only context `tenants` is
  // reachable from) and is read-only, so the GUC cannot leave anything behind.
  const fixtures = await inContext(pool, { superAdmin: true }, (query) =>
    query(`
      SELECT t.id AS tenant_id, t.name AS tenant_name, t.owner_id,
             (SELECT c.id FROM contacts c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL LIMIT 1) AS contact_id
      FROM tenants t
      WHERE t.name LIKE 'SIM%' AND t.deleted_at IS NULL AND t.owner_id IS NOT NULL
      ORDER BY (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) DESC,
               t.created_at DESC
      LIMIT 1`),
  );
  const fix = fixtures.rows[0] as
    | { tenant_id: string; tenant_name: string; owner_id: string; contact_id: string | null }
    | undefined;
  if (!fix) {
    console.error('no SIM tenant with an owner to write into — refusing to run against a real customer');
    await pool.end();
    process.exit(2);
  }
  console.log(`target tenant: ${fix.tenant_name} (${fix.tenant_id})${fix.contact_id ? '' : '  [no contact — activity-row checks are skipped]'}`);

  // ── Seed a tracking row exactly as the sender would ────────────────────────
  const seeded = await inContext(pool, { tenantId: fix.tenant_id, userId: fix.owner_id }, (query) =>
    query(
      `INSERT INTO email_tracking (id, tenant_id, contact_id, recipient, subject, sent_at, open_count, click_count)
       VALUES ($1, $2, $3, $4, $5, now(), 0, 0) RETURNING id`,
      [probeId, fix.tenant_id, fix.contact_id, RECIPIENT, SUBJECT],
    )
  );
  check('seeded an email_tracking row through the tenant context a sender uses', seeded.rowCount === 1, probeId);

  // ── 1 + 2. The mechanism: which context can resolve the id? ───────────────
  // Straight off the pool with no GUC at all — the checkout the public route
  // used to get, and the only way to ask the question honestly.
  const bare = await pool.query(`SELECT id FROM email_tracking WHERE id = $1`, [probeId]);
  check(
    'a no-context session still cannot read the row (the grant stayed narrow)',
    bare.rowCount === 0,
    bare.rowCount === 0
      ? 'invisible, as intended — only the tracking-lookup GUC admits it'
      : 'LEAK: visible to any connection, which is a cross-tenant read',
  );

  const lookup = await inContext(pool, { trackingLookup: true }, (query) =>
    query(`SELECT tenant_id, open_count FROM email_tracking WHERE id = $1`, [probeId])
  );
  check(
    'app.tracking_lookup admits SELECT on the row for the pixel (needs migration 0105)',
    lookup.rowCount === 1,
    lookup.rowCount === 1 ? 'readable' : 'no such policy yet — apply 0105_email_tracking_pixel_lookup',
  );

  const policies = await pool.query(
    `SELECT policyname, cmd, trim(regexp_replace(coalesce(qual::text,''), '\\s+', ' ', 'g')) AS qual
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_tracking' ORDER BY policyname`
  );
  for (const p of policies.rows as { policyname: string; cmd: string; qual: string }[]) {
    console.log(`         policy ${p.policyname} (${p.cmd}): ${p.qual.slice(0, 150)}`);
  }
  if (!policies.rowCount) console.log('         NONE — table not RLS-enforced');

  const writeProbe = await inContext(pool, { trackingLookup: true }, (query) =>
    query(`UPDATE email_tracking SET open_count = open_count WHERE id = $1`, [probeId])
  );
  check(
    'the lookup GUC grants SELECT only — it cannot write the row',
    writeProbe.rowCount === 0,
    writeProbe.rowCount === 0
      ? 'UPDATE matched 0 rows, so the counters still need a real tenant context'
      : 'UPDATE was allowed without a tenant — too broad',
  );

  // ── 3. The live pixel ─────────────────────────────────────────────────────
  if (!process.argv.includes('--skip-http')) {
    try {
      console.log(`         GET /api/track/open?t=… → ${fetchInContainer(`/api/track/open?t=${probeId}`, 'content-type')}`);
    } catch (err) {
      check('the running container answered the pixel request', false, (err as Error).message.split('\n')[0]);
    }
    // Both routes record fire-and-forget, so give the write a moment.
    await new Promise((r) => setTimeout(r, 1_500));

    const after = await inContext(pool, { tenantId: fix.tenant_id, userId: fix.owner_id }, (query) =>
      query(`SELECT open_count, opened_at::text AS opened_at FROM email_tracking WHERE id = $1`, [probeId])
    );
    const row = after.rows[0] as { open_count: number; opened_at: string | null } | undefined;
    check(
      'the pixel request incremented open_count and stamped opened_at',
      (row?.open_count ?? 0) >= 1 && (row?.opened_at ?? null) !== null,
      row ? `open_count=${row.open_count} opened_at=${row.opened_at ?? 'NULL'}` : 'row not found',
    );

    if (fix.contact_id) {
      const acts = await inContext(pool, { superAdmin: true }, (query) =>
        query(`SELECT action FROM activities WHERE metadata->>'tracking_id' = $1 ORDER BY created_at`, [probeId])
      );
      const actions = (acts.rows as { action: string }[]).map((r) => r.action).join(',');
      check(
        'the first open logged an "email_open" activity on the contact',
        actions.includes('email_open'),
        `activities: ${actions || 'none'}`,
      );
    }

    // ── 4. The live click ───────────────────────────────────────────────────
    try {
      const out = fetchInContainer(`/api/track/click?t=${probeId}&url=${WRAPPED}`, 'location');
      const [, location] = out.split(' ');
      console.log(`         GET /api/track/click?t=…&url=… → ${out}`);
      check(
        'a real tracking id makes the click redirect to the wrapped URL, not /',
        location === WRAPPED_EXPECT,
        `location=${location ?? 'none'}`,
      );
    } catch (err) {
      check('the running container answered the click request', false, (err as Error).message.split('\n')[0]);
    }
    await new Promise((r) => setTimeout(r, 1_500));

    const clicked = await inContext(pool, { tenantId: fix.tenant_id, userId: fix.owner_id }, (query) =>
      query(`SELECT click_count, clicked_at::text AS clicked_at FROM email_tracking WHERE id = $1`, [probeId])
    );
    const crow = clicked.rows[0] as { click_count: number; clicked_at: string | null } | undefined;
    check(
      'the click request incremented click_count and stamped clicked_at',
      (crow?.click_count ?? 0) >= 1 && (crow?.clicked_at ?? null) !== null,
      crow ? `click_count=${crow.click_count} clicked_at=${crow.clicked_at ?? 'NULL'}` : 'row not found',
    );

    const failures = await pool.query(
      `SELECT context->>'context' AS where_, message FROM error_logs
       WHERE context->>'context' LIKE 'track/%' AND created_at > now() - interval '3 minutes'
       ORDER BY created_at DESC LIMIT 3`
    );
    for (const f of failures.rows as { where_: string; message: string }[]) {
      console.log(`         error_logs [${f.where_}]: ${f.message.slice(0, 200)}`);
    }
  }

  // ── 5. Teardown ───────────────────────────────────────────────────────────
  await inContext(pool, { superAdmin: true }, async (query) => {
    await query(`DELETE FROM activities WHERE metadata->>'tracking_id' = $1`, [probeId]);
  });
  await inContext(pool, { tenantId: fix.tenant_id, userId: fix.owner_id }, async (query) => {
    await query(`DELETE FROM email_tracking WHERE id = $1`, [probeId]);
  });
  const left = await inContext(pool, { trackingLookup: true }, (query) =>
    query(`SELECT count(*)::int AS c FROM email_tracking WHERE id = $1`, [probeId])
  );
  const remaining = (left.rows[0] as { c: number } | undefined)?.c ?? -1;
  check('teardown removed the probe row and its activities', remaining === 0, `${remaining} left`);

  await pool.end();
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0
    ? '\nRESULT: an open and a click through the public endpoints are recorded end to end\n'
    : `\nRESULT: ${failed.length} check(s) failed — ${failed.map((f) => f.name).join('; ')}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('probe failed:', err instanceof Error ? err.message : String(err));
  process.exit(2);
});
