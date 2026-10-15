/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2530 — compliance requests record `status: 'processing'`, run the job,
 * then stamp `completed`/`failed`. A hard interruption between the two
 * (connection drop, statement timeout, OOM — not a JS throw, which the
 * routes' own catch already marks `failed`) left the row stuck at
 * `processing` forever, so the lifecycle record disagreed with the data:
 * worst on `gdpr_delete`, where an interrupted `anonymizeTenantData` can
 * leave PII partially erased while the UI still claims the erasure is
 * underway.
 *
 * The pair cannot be wrapped in one `db.transaction()`: the job that runs
 * between the two writes is multi-table on the global pool, and a
 * transaction held open across it would lock every row it touches for the
 * job's whole duration (the same reasoning reports/[id] used when #2530's
 * first fix kept the report read outside the transaction). The recoverable
 * shape is instead: a `processing` row older than STALE_PROCESSING_MS
 * cannot be live — the routes run inline within one request — so the read
 * path reaps it to a terminal `failed` state, which the UI already renders,
 * instead of trusting it.
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { complianceRequests } from '@/drizzle/schema/compliance';

export const STALE_PROCESSING_MS = 15 * 60 * 1000;

export async function reapStaleProcessingRequests(
  tenantId: string,
  types: string[],
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
  const reaped = await db
    .update(complianceRequests)
    .set({
      status: 'failed',
      errorMessage: `interrupted: still 'processing' after ${Math.round(STALE_PROCESSING_MS / 60000)} minutes with no terminal state (#2530 reap)`,
      updatedAt: now,
    })
    .where(
      and(
        eq(complianceRequests.tenantId, tenantId),
        inArray(complianceRequests.type, types),
        eq(complianceRequests.status, 'processing'),
        lt(complianceRequests.createdAt, cutoff),
      ),
    )
    .returning({ id: complianceRequests.id });
  return reaped.length;
}
