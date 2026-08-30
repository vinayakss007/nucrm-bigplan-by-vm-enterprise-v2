/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { acquireLock } from '@/lib/cache';
import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sessions, invitations, passwordResets } from '@/drizzle/schema';
import { lt, and, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest) => {
  // Two ways to authorize this job:
  //  1. the scheduler presents the shared CRON_SECRET, or
  //  2. a logged-in super admin triggers it manually from the dashboard.
  // #1087: the superadmin path means the settings UI no longer needs to send a
  // cron secret from the browser (it previously sent an empty one).
  const secretOk = verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET);
  if (!secretOk) {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse || !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:cleanup', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }
  try {
    const r: Record<string, number> = {};

    // 1. Sessions cleanup (#1275)
    // Delete expired sessions in bounded batches instead of a single
    // unbounded DELETE. A single statement holds a write lock over every
    // matching row for the whole delete, which causes lock contention on a
    // large sessions table. Postgres DELETE has no LIMIT, so each batch
    // targets a capped subquery of ids. Each batch runs as its own statement
    // (NOT inside the big transaction) so lock hold time stays short.
    const SESSION_BATCH = 1000;
    const MAX_SESSION_ITERATIONS = 10000; // safety cap to avoid an infinite loop
    let sessionsDeleted = 0;
    for (let i = 0; i < MAX_SESSION_ITERATIONS; i++) {
      const batch = await db.execute(sql`
        DELETE FROM ${sessions}
        WHERE ${sessions.id} IN (
          SELECT ${sessions.id} FROM ${sessions}
          WHERE ${sessions.expiresAt} < NOW()
          LIMIT ${SESSION_BATCH}
        )
      `);
      const removed = batch.rowCount ?? 0;
      sessionsDeleted += removed;
      if (removed === 0) break;
    }
    r['sessions'] = sessionsDeleted;

    await db.transaction(async (tx) => {
      // 2. Invitations cleanup: older than 7 days and not accepted
      const invExpiry = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const invitationsResult = await tx.delete(invitations)
        .where(and(
          lt(invitations.expiresAt, invExpiry),
          isNull(invitations.acceptedAt)
        ));
      r['invitations'] = invitationsResult.rowCount ?? 0;

      // 3. Password resets cleanup
      const resetsResult = await tx.delete(passwordResets)
        .where(lt(passwordResets.expiresAt, new Date()));
      r['resets'] = resetsResult.rowCount ?? 0;
    });

    // 4. Purge trash items older than 30 days
    try {
      const result = await db.execute(sql`SELECT public.purge_trash() as count`);
      const row = result.rows[0] as { count: number };
      r['trash_purged'] = row?.count ?? 0;
    } catch (err) {
      void logError({ error: err, context: 'cron/cleanup purge-trash' });
      r['trash_purged'] = 0;
    }

    return NextResponse.json({ ok: true, cleaned: r });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    void logError({ error: err, context: 'cron/cleanup' });
    return apiError(err); 
  }
});
