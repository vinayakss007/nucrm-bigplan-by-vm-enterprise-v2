/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/superadmin/selective-restore/logs — Restore History (#2822).
 *
 * The panel at `app/superadmin/selective-restore/page.tsx:149` has asked for this
 * URL since #1328 put it on TanStack Query. Nothing answered it: `app/api/
 * superadmin/selective-restore/` holds `backups/ execute/ preview/ rollback/
 * scope/ users/` and no `logs/`, so every install showed "No restore operations
 * yet" no matter how many restores had run — while `execute/route.ts` kept
 * writing the rows, `rollback/route.ts` kept keying off them, and
 * `monitoring/route.ts` kept counting them. An audit trail that is written,
 * aggregated and joined, but never readable.
 *
 * `restore_mode` and the table list are not columns of `selective_restore_logs`;
 * they live in the audit envelope `createAuditLog` writes into
 * `selective_restore_audit_log.old_data` (the table has no columns for the
 * restore link or the request context — PP-044, needs a migration). The
 * reconstruction lives here, in one place, so that PP-044 promoting those keys
 * to real columns is a change to this file and not to whatever panel reads it
 * next. `backups/route.ts:48` already joins on a jsonb key for the same reason.
 *
 * Fields the restore never stored (`records_affected`, `records_per_table` in the
 * panel's `RestoreLog` type) are absent rather than invented — those numbers
 * belong to the live SSE result at `page.tsx:128`, not to history.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { selectiveRestoreAuditLog, selectiveRestoreLogs, tenants } from '@/drizzle/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { clampInt } from '@/lib/api/query-params';
import { isUuid } from '@/lib/id';
import { logError } from '@/lib/errors-server';

/** The only four values `execute/route.ts` writes (:90 pending, :124 running, :141 completed, :228 failed). */
const RESTORE_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

/** History is a table a human scrolls, not an export feed; the sibling list caps at 50. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface Envelope {
  restore_mode?: string | null;
  tables?: string[] | null;
}

/**
 * `restore_log_id` is the join key, and it only exists inside the jsonb envelope,
 * so this is the one documented place that knows its spelling. One envelope row is
 * written per restore (`execute/route.ts:99`, the single `createAuditLog` call),
 * which is why a Map is enough and last-write-wins needs no tiebreak.
 */
async function envelopesByRestoreLogId(logIds: string[]): Promise<Map<string, Envelope>> {
  if (logIds.length === 0) return new Map();
  const restoreLogId = sql<string>`${selectiveRestoreAuditLog.oldData} ->> 'restore_log_id'`;
  const rows = await db
    .select({
      restoreLogId,
      // `-> 'tables'` (not `->>`) so Postgres hands back the array, not its text
      envelope: sql<Envelope>`jsonb_build_object(
        'restore_mode', ${selectiveRestoreAuditLog.oldData} ->> 'restore_mode',
        'tables', ${selectiveRestoreAuditLog.oldData} -> 'tables'
      )`,
    })
    .from(selectiveRestoreAuditLog)
    .where(and(inArray(restoreLogId, logIds), sql`${restoreLogId} IS NOT NULL`))
    .orderBy(desc(selectiveRestoreAuditLog.performedAt));
  const byId = new Map<string, Envelope>();
  for (const row of rows) {
    if (!byId.has(row.restoreLogId)) byId.set(row.restoreLogId, row.envelope);
  }
  return byId;
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenant_id');
    const status = searchParams.get('status');

    // `tenant_id` is a uuid column, so a typo would raise 22P02 inside the query and
    // `apiError` would answer 404 "not found" — a filter that looks broken rather
    // than refused. Same for `status`: an unrecognised value has no rows by
    // definition, and an empty 200 teaches the operator the history is empty.
    if (tenantId && !isUuid(tenantId)) {
      return NextResponse.json({ error: 'tenant_id must be a UUID' }, { status: 400 });
    }
    if (status && !(RESTORE_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${RESTORE_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const filters = [isNull(selectiveRestoreLogs.deletedAt)];
    if (tenantId) filters.push(eq(selectiveRestoreLogs.tenantId, tenantId));
    if (status) filters.push(eq(selectiveRestoreLogs.status, status));

    // No `.catch(() => [])` here, unlike the sibling `backups` list: a refused read
    // must reach the caller as a failure. #2823 gave this very panel an error branch
    // ("An empty list would mean no restore has ever run") that only works if a
    // broken query cannot be answered as an empty success.
    const rows = await db
      .select({
        id: selectiveRestoreLogs.id,
        backup_id: selectiveRestoreLogs.backupId,
        target_tenant_id: selectiveRestoreLogs.tenantId,
        tenant_name: tenants.name,
        status: selectiveRestoreLogs.status,
        started_at: selectiveRestoreLogs.startedAt,
        completed_at: selectiveRestoreLogs.completedAt,
        error_message: selectiveRestoreLogs.errorMessage,
      })
      .from(selectiveRestoreLogs)
      .leftJoin(tenants, eq(tenants.id, selectiveRestoreLogs.tenantId))
      .where(and(...filters))
      .orderBy(desc(selectiveRestoreLogs.startedAt))
      .limit(limit);

    const envelopes = await envelopesByRestoreLogId(rows.map((r) => r.id));

    const logs = rows.map((row) => {
      const envelope = envelopes.get(row.id);
      const durationMs =
        row.completed_at && row.started_at
          ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
          : undefined;
      return {
        ...row,
        restore_mode: envelope?.restore_mode ?? null,
        // an array of table names, or [] when the restore has no envelope row —
        // the panel renders `.length`, and `-` is what a missing value looks like there
        tables_selected: Array.isArray(envelope?.tables) ? envelope.tables : [],
        ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
      };
    });

    return NextResponse.json({ logs });
  } catch (err) {
    await logError({ error: err, context: 'selective-restore/logs GET', requestMethod: 'GET' });
    return apiError(err);
  }
});
