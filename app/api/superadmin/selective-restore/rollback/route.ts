/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { db } from '@/drizzle/db';
import { selectiveRestoreLogs } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

const schema = z.object({ restore_log_id: z.string().min(1) });

/**
 * POST: Rollback a restore to its pre-restore snapshot — currently refused: the 501 below says why.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const limited = await rateLimitMutating(request, 'selectiveRestore', 'post');
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { restore_log_id } = validated.data;

    const [restoreLog] = await db
      .select({ id: selectiveRestoreLogs.id })
      .from(selectiveRestoreLogs)
      .where(eq(selectiveRestoreLogs.id, restore_log_id))
      .limit(1);

    if (!restoreLog) {
      return NextResponse.json({ error: 'Restore log not found' }, { status: 404 });
    }

    // No rollback target exists. `execute` creates a pre-restore snapshot and streams its id to the
    // client, but nothing stores that id: `selective_restore_logs` has no snapshot column,
    // `restore_snapshots` has no restore column, and the audit row's envelope never carried one. The
    // previous code read `pre_restore_snapshot_id`, a column that exists in no schema file and not in
    // preprod — Postgres raised 42703, and this route's handler then set the *succeeded* restore's
    // status to 'failed' before answering a generic 500. Refusing here writes nothing.
    // Enabling this path is a decision, not a fix: rollbackToSnapshot() deletes every tenant row in
    // each snapshotted table. PP-044.
    return NextResponse.json(
      {
        error: 'Rollback unavailable',
        details:
          'A restore log is not linked to its pre-restore snapshot, so there is no rollback target. See docs/infra/PREPROD-ISSUE-REGISTER.md PP-044.',
        restore_log_id,
      },
      { status: 501 }
    );
  } catch (err) {
    await logError({ error: err, context: 'selective-restore/rollback POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
