/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * POST /api/tenant/documents/[id]/verify — settle a document row against the bytes
 * the object store actually holds (#3297).
 *
 * WHY THIS ROUTE EXISTS
 * --------------------
 * The upload path meters a number the client typed. `route.ts:126` reads
 * `sizeBytes` out of the JSON body, `:154` checks only that it is a positive
 * number, `:182` tests the plan against `checkLimit(ctx,'storageGb')` — whose meter
 * is the SUM OF THAT SAME COLUMN (`lib/usage/tracker.ts:176-189`) — and `:218`
 * persists it. Nothing has ever compared it to the object. So
 * `sizeBytes: 1` plus a 100 MB PUT records one byte, and `max_storage_gb` reports a
 * workspace that is nearly empty while the bucket quietly grows. That is a billing
 * and capacity hole, and it is the reason `usage-snapshot`'s storage figures and the
 * tenant's own usage widget both read as fantasy.
 *
 * A presigned PUT cannot fix it on its own: SigV4 covers `content-length` only when
 * the signing call knew the length, which is why
 * `lib/storage/s3.getSignedPutUrl` now refuses to mint an unbound URL. But the
 * client still declares the number, the row is written before the bytes land, and a
 * browser that abandons an upload mid-PUT leaves a row and an object in different
 * worlds. So the row is corrected here, after the fact, from the store's own answer.
 *
 * THE ORDER IS THE POINT
 * ---------------------
 * measure → settle → re-check the plan. Checking the plan before the measure is
 * checking it against the claim, which is the hole being closed; the assertion in
 * `tests/unit/document-size-verify-3297.test.ts` pins it so a later refactor cannot
 * quietly move `checkLimit` back above the read.
 *
 * `null` vs "I could not tell you" is the other thing this route must not blur.
 * A missing object means the row is describing nothing, so it is tombstoned. A store
 * that answers 503 means nothing at all — and if that were read as "missing", one
 * bad gateway turn would tombstone every row in a tenant's library and the meter
 * would then report the tenant's whole disk as free. `headObjectSize` throws for
 * exactly that case and the route answers 502 without writing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { checkLimit } from '@/lib/usage/middleware';
import { db } from '@/drizzle/db';
import { documents } from '@/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { headObjectSize, deleteObject } from '@/lib/storage/s3';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';

export const POST = withApiRoute(async (request: NextRequest,
  context: { params: Promise<{ id: string }> },) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  // Its own counter (`documents-verify_post`), not `documents_post`: every upload is
  // now two POSTs, and sharing the create bucket would halve how many files a member
  // can upload per window — a 15-file drop would 429 on the settle, not on the upload.
  const limited = await rateLimitMutating(request, 'documents-verify', 'post');
  if (limited) return limited;

  const { id } = await context.params;

  // tenant_id in the predicate, not a JS comparison after an unscoped read:
  // RLS is the second line of defence, not the first (#3342).
  const [row] = await db
    .select({
      id: documents.id,
      tenantId: documents.tenantId,
      name: documents.name,
      s3Key: documents.s3Key,
      s3Bucket: documents.s3Bucket,
      sizeBytes: documents.sizeBytes,
    })
    .from(documents)
    .where(and(
      eq(documents.id, id),
      eq(documents.tenantId, ctx.tenantId),
      isNull(documents.deletedAt),
    ))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const bucket = row.s3Bucket || undefined;

  let measured: number | null;
  try {
    measured = await headObjectSize(row.s3Key, bucket);
  } catch (err) {
    // NOT the arm below. The store failed to answer; the object is not known to be
    // gone. Writing anything here would let an outage shrink the meter.
    const msg = err instanceof Error ? err.message : 'Could not measure the stored object';
    await logError({ error: err, context: 'tenant/documents/[id]/verify HEAD', requestMethod: 'POST' });
    return NextResponse.json({ error: msg, measured: false }, { status: 502 });
  }

  if (measured === null) {
    // Row without bytes: stop counting it, leave nothing to delete.
    await tombstone(id, ctx.tenantId);
    return NextResponse.json({
      error: 'The stored object is not present; the document record was removed',
      declaredBytes: row.sizeBytes,
      measured: false,
    }, { status: 410 });
  }

  const declaredBytes = row.sizeBytes;
  const adjusted = measured !== declaredBytes;

  if (adjusted) {
    await db
      .update(documents)
      .set({ sizeBytes: measured, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)));
  }

  // Re-measured against the plan only now, because the meter above just changed.
  const overStorage = await checkLimit(ctx, 'storageGb');
  if (overStorage) {
    // The bytes are real and the plan cannot hold them. Keeping the row would
    // leave the tenant permanently over the limit they cannot see, so this arm
    // removes the upload it just measured — hard, because the tenant never
    // agreed to store it, and audited, because we deleted their file.
    try {
      await deleteObject(row.s3Key, bucket);
    } catch (err) {
      // Object stays; the row is tombstoned anyway so the meter is honest about
      // what it can still see. A later sweep collects the orphan.
      console.warn('[documents verify] over-quota object delete failed', err instanceof Error ? err.message : err);
    }
    await tombstone(id, ctx.tenantId);
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'document',
      entityId: id,
      metadata: { reason: 'storage_limit_exceeded_on_verify', declaredBytes, measuredBytes: measured },
    });
    return NextResponse.json({
      error: 'The uploaded file does not fit within this plan once measured',
      declaredBytes,
      measuredBytes: measured,
      removed: true,
    }, { status: 413 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      name: row.name,
      declaredBytes,
      measuredBytes: measured,
      adjusted,
    },
  });
});

/** Take a row out of the meter. Scoped by tenant as well as id (#3342). */
async function tombstone(id: string, tenantId: string): Promise<void> {
  const now = new Date();
  await db
    .update(documents)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));
}
