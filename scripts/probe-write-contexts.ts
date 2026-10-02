#!/usr/bin/env npx tsx
/**
 * Which RLS context can a background WRITER actually use? (#42/#45/#7/#56)
 *
 * WHY THIS EXISTS
 * ---------------
 * probe:rls answers what each context can READ. The recurring bug class is the
 * other half: a cron or panel job that writes on behalf of a tenant, fails,
 * logs and continues — leaving "Failed query: insert into …" in error_logs as
 * the only trace, with no mention of RLS.
 *
 * This script attempts one real INSERT through each context and prints which
 * the database accepts, next to the live policy text that decides it. It exists
 * because the answer is NOT uniform: `activities` carries
 *
 *   tenant_isolation [ALL] … OR current_setting('app.is_super_admin')::boolean = true
 *
 * so a platform-context write is allowed there — while the tables still open in
 * #7 and #56 have no such branch and refuse the same statement with 42501. Any
 * fix that assumed one shape would be wrong for the other, and the assumption
 * was indeed wrong once while writing this.
 *
 * ASSERTIONS (what must stay true for the code that ships):
 *   1. withSecurityContext() can write the trial-check dedup marker — the cron
 *      fix in #42/#45 depends on exactly this, so a future policy tightening
 *      that removes the super-admin branch fails here rather than silently
 *      re-arming the repeat-email bug at 00:00.
 *   2. The marker is invisible to a context naming a different tenant, i.e. the
 *      write went into the tenant it named and not everywhere.
 *   3. Teardown leaves nothing behind in either table.
 *   4. An anonymous analytics event, written on the bare pool with no tenant
 *      context, is STORED with NULL tenant/user. This is the shape
 *      /api/track/event uses for every visitor that has not signed in, and it
 *      broke with 22P02 `invalid input syntax for type uuid: ""` — raised by
 *      the policy reading the unset `app.current_tenant` GUC, not by the column.
 *      Fixed by NULLIF(…, '') in tenant_isolation plus 0096's
 *      `analytics_events_insert … WITH CHECK true`; either half regressing
 *      silently drops the entire anonymous page-view stream.
 *
 * SAFETY: writes only into a SIM tenant (name LIKE 'SIM%'), the rows are deleted
 * in the same run, and nothing real is touched.
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.gate.json --import ./scripts/load-env.mjs \
 *     scripts/probe-write-contexts.ts
 *   Add --tenant <uuid> to target a specific SIM tenant.
 */
import { Pool } from 'pg';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { pgSslConfig } from '../lib/db/ssl-config';
import { tenants } from '@/drizzle/schema/core';
import { activities } from '@/drizzle/schema/activity';
import { analyticsEvents } from '@/drizzle/schema/analytics';
import { withSecurityContext, withTenantContext } from '@/lib/db/rls';
import { recordEvent } from '@/lib/analytics/store';
import { isUuid } from '@/lib/id';

const MARKER_DESCRIPTION = 'probe-write-contexts — not a real warning';

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): boolean {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
  return ok;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const markerWhere = (tenantId: string) =>
  and(
    eq(activities.tenantId, tenantId),
    eq(activities.eventType, 'trial_warning'),
    sql`${activities.description} = ${MARKER_DESCRIPTION}`
  );

/** Exactly the row app/api/cron/trial-check/route.ts writes for the dedup marker. */
function markerValues(tenantId: string) {
  return {
    tenantId,
    userId: null,
    eventType: 'trial_warning',
    description: MARKER_DESCRIPTION,
    entityType: 'tenant',
    entityId: tenantId,
    action: 'trial_warning',
  };
}

async function main(): Promise<void> {
  // Loopback pgbouncer, like every other host-side probe: the managed endpoint's
  // certificate chain is not verifiable from outside the container network, and
  // this URL carries no sslmode param to override lib/db/ssl-config.ts.
  if (process.env.PROBE_DATABASE_URL) process.env.DATABASE_URL = process.env.PROBE_DATABASE_URL;

  const wanted = arg('--tenant');
  if (wanted && !isUuid(wanted)) throw new Error('--tenant must be a uuid');

  const target = await withSecurityContext(async (tx) => {
    const [row] = await tx
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(
        wanted
          ? eq(tenants.id, wanted)
          : and(sql`${tenants.name} LIKE 'SIM%'`, isNull(tenants.deletedAt))
      )
      .orderBy(sql`${tenants.createdAt} DESC`)
      .limit(1);
    return row ?? null;
  });
  if (!target) throw new Error('no SIM tenant to write into — refusing to run against a real customer');
  console.log(`target tenant: ${target.name} (${target.id})`);

  // The catalog row that decides assertion 1, read straight from pg_policies,
  // plus the error_logs read in assertion 3. A pool, not tx.execute(): drizzle
  // hands raw catalog SQL back in the driver's own result shape, and neither
  // read has a reason to depend on it. Lives for the whole run.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: pgSslConfig(),
    connectionTimeoutMillis: 10_000,
  });
  const policyRes = await pool.query(
    `SELECT qual::text AS qual, with_check::text AS wcheck
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'activities'
       AND policyname = 'tenant_isolation'
     LIMIT 1`
  );
  const policy = policyRes.rows[0] as { qual: string | null; wcheck: string | null } | undefined;
  const mentionsSuperAdmin = /is_super_admin/.test(`${policy?.qual ?? ''}${policy?.wcheck ?? ''}`);
  console.log(
    `activities tenant_isolation: super-admin branch=${mentionsSuperAdmin ? 'yes' : 'no'}\n`
  );

  await withSecurityContext((tx) => tx.delete(activities).where(markerWhere(target.id)));

  // ── 1. The context the shipped cron uses ─────────────────────────────────
  let securityWrite: { ok: boolean; code?: string; message: string } = { ok: true };
  try {
    await withSecurityContext((tx) => tx.insert(activities).values(markerValues(target.id)));
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string; message?: string }; message: string };
    securityWrite = { ok: false, code: err.cause?.code ?? err.code, message: err.cause?.message ?? err.message };
  }
  check(
    'withSecurityContext() can write a tenant-scoped activities marker (trial-check depends on it)',
    securityWrite.ok,
    securityWrite.ok ? 'insert accepted' : `${securityWrite.code}: ${securityWrite.message}`
  );
  if (!securityWrite.ok && mentionsSuperAdmin) {
    console.log('         .. the policy still names is_super_admin, so this is not a policy tightening —\n            look at the GUC the transaction actually carries');
  }

  // ── 2. The row went to the tenant it named, and only that one ────────────
  const otherTenantRead = await withTenantContext(
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    (tx) => tx.select({ id: activities.id }).from(activities).where(markerWhere(target.id))
  );
  check('a context naming a different tenant cannot see the row', otherTenantRead.length === 0, `rows=${otherTenantRead.length}`);

  const ownRead = await withTenantContext(target.id, '00000000-0000-0000-0000-000000000000', (tx) =>
    tx.select({ id: activities.id }).from(activities).where(markerWhere(target.id))
  );
  check('the tenant it was written for can see it', ownRead.length === 1, `rows=${ownRead.length}`);

  // ── 3. Anonymous analytics ingest, on the bare pool (no tenant context) ───
  // This is the shape /api/track/event uses for a visitor with no session:
  // recordEvent() writes through `db`, which sets no app.* GUC at all. The
  // failure it must never return to is 22P02 invalid input syntax for type
  // uuid: "" — raised not by the column but by the policy expression reading
  // the unset GUC. error_logs held 11 of them (2026-09-29 08:53 → 09-30 11:48,
  // none since) once the policy grew NULLIF(…, '') and 0096 added the
  // `WITH CHECK true` INSERT policy. Both halves are load-bearing, so assert
  // against the live table rather than trusting that they are still there.
  const anonBefore = await withSecurityContext((tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(analyticsEvents).where(eq(analyticsEvents.anonId, 'probe-write-contexts'))
  );
  const anonStartedAt = new Date();
  // recordEvent() swallows every error by design (analytics must never break
  // the request that triggered it), so a rejected insert is invisible here: no
  // throw, no row. The only proof it happened is the error_logs row it writes.
  // Assert on the row, and on failure print what logError recorded — which is
  // the SQLSTATE and reason, now that logError keeps the cause chain.
  await recordEvent({
    anonId: 'probe-write-contexts',
    eventName: 'page_view',
    tenantId: null,
    userId: null,
    isPaid: false,
    planId: null,
    url: '/auth/login',
  });
  const anonRows = await withSecurityContext((tx) =>
    tx
      .select({ id: analyticsEvents.id, tenantId: analyticsEvents.tenantId, userId: analyticsEvents.userId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.anonId, 'probe-write-contexts'))
  );
  const anonPrior = anonBefore[0]?.n ?? 0;
  const anonStored = anonRows.length === anonPrior + 1;
  let anonReason = '';
  if (!anonStored) {
    const logged = await pool.query(
      `SELECT message FROM error_logs
       WHERE context->>'context' = 'analytics: recordEvent' AND created_at > $1
       ORDER BY created_at DESC LIMIT 1`,
      [anonStartedAt]
    );
    anonReason = logged.rows[0]?.message ?? 'insert vanished without an error_logs row';
  }
  check(
    'an anonymous event with no tenant context is stored (NULL tenant/user), not dropped',
    anonStored && anonRows.every((r) => r.tenantId === null && r.userId === null),
    anonStored
      ? `rows=${anonRows.length} prior=${anonPrior} tenantId=${JSON.stringify(anonRows.map((r) => r.tenantId))}`
      : anonReason
  );

  // ── 4. Teardown ──────────────────────────────────────────────────────────
  await withSecurityContext((tx) => tx.delete(activities).where(markerWhere(target.id)));
  await withSecurityContext((tx) => tx.delete(analyticsEvents).where(eq(analyticsEvents.anonId, 'probe-write-contexts')));
  const leftovers = await withSecurityContext(async (tx) => {
    const acts = await tx.select({ id: activities.id }).from(activities).where(markerWhere(target.id));
    const events = await tx.select({ id: analyticsEvents.id }).from(analyticsEvents).where(eq(analyticsEvents.anonId, 'probe-write-contexts'));
    return acts.length + events.length;
  });
  check('nothing is left behind', leftovers === 0, `rows=${leftovers}`);
  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nwrite-context probe aborted: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});
