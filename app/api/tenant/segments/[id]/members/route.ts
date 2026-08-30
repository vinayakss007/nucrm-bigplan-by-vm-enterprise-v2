/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Segment membership (#1633).
 *   GET  /api/tenant/segments/[id]/members  — list the cached member ids
 *   POST /api/tenant/segments/[id]/members  — refresh: re-evaluate the segment's
 *        filters and materialize the result into `segment_members`, updating
 *        `segments.last_refreshed_at`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments, segmentMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { evaluateSegment, isSegmentEntityType, SegmentFilterError } from '@/lib/segments/evaluate';

async function loadSegment(id: string, tenantId: string) {
  const [seg] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId)))
    .limit(1);
  return seg;
}

export const GET = withApiRoute(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const ctx = await requireAuth(req);
      if (ctx instanceof NextResponse) return ctx;
      const { id } = await params;

      const seg = await loadSegment(id, ctx.tenantId);
      if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

      const rows = await db
        .select({ entityId: segmentMembers.entityId, addedAt: segmentMembers.addedAt })
        .from(segmentMembers)
        .where(and(eq(segmentMembers.segmentId, id), eq(segmentMembers.tenantId, ctx.tenantId)));

      return NextResponse.json({
        data: rows.map((r) => r.entityId),
        meta: {
          count: rows.length,
          entity_type: seg.entityType,
          last_refreshed_at: seg.lastRefreshedAt,
        },
      });
    } catch (err) {
      await logError({ error: err, context: 'segments/[id]/members GET', requestMethod: 'GET' });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
);

export const POST = withApiRoute(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const limited = await rateLimitMutating(req, 'segments', 'post');
      if (limited) return limited;

      const ctx = await requireAuth(req);
      if (ctx instanceof NextResponse) return ctx;
      const { id } = await params;

      const seg = await loadSegment(id, ctx.tenantId);
      if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

      if (!isSegmentEntityType(seg.entityType)) {
        return NextResponse.json(
          { error: `Segment entity type "${seg.entityType}" is not supported for evaluation` },
          { status: 422 },
        );
      }

      // Evaluate filters -> matching ids (tenant-scoped, soft-delete excluded).
      let matchedIds: string[];
      try {
        matchedIds = await evaluateSegment({
          tenantId: ctx.tenantId,
          entityType: seg.entityType,
          config: seg.config,
        });
      } catch (e) {
        if (e instanceof SegmentFilterError) {
          return NextResponse.json({ error: `Invalid segment filters: ${e.message}` }, { status: 422 });
        }
        throw e;
      }

      // Materialize atomically: replace the cache, then stamp last_refreshed_at.
      const refreshedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .delete(segmentMembers)
          .where(and(eq(segmentMembers.segmentId, id), eq(segmentMembers.tenantId, ctx.tenantId)));

        if (matchedIds.length) {
          await tx.insert(segmentMembers).values(
            matchedIds.map((entityId) => ({
              segmentId: id,
              tenantId: ctx.tenantId,
              entityId,
            })),
          );
        }

        await tx
          .update(segments)
          .set({ lastRefreshedAt: refreshedAt, updatedAt: refreshedAt })
          .where(and(eq(segments.id, id), eq(segments.tenantId, ctx.tenantId)));
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'refresh',
        entityType: 'segment',
        entityId: id,
        newData: { member_count: matchedIds.length },
      });

      return NextResponse.json({
        ok: true,
        data: { member_count: matchedIds.length, last_refreshed_at: refreshedAt },
      });
    } catch (err) {
      await logError({ error: err, context: 'segments/[id]/members POST', requestMethod: 'POST' });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
);
