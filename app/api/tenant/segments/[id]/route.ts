/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { isEntityId } from '@/lib/id';

export const DELETE = withApiRoute(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const limited = await rateLimitMutating(req, 'segments', 'delete');
      if (limited) return limited;

      const ctx = await requireAuth(req);
      if (ctx instanceof NextResponse) return ctx;
      // #3151 — this is the only hard delete in the family: no tombstone, and
      // `segment_members` leaves with it by the `onDelete: 'cascade'` FK
      // (`drizzle/schema/segments.ts:39`), so the bulk `restore` action cannot
      // bring either back. Deleting a segment another team's automations read
      // off is authoring, and authoring takes `segments.manage`.
      const deny = requirePerm(ctx, 'segments.manage');
      if (deny) return deny;

      const { id } = await params;
      // #2781 — the handler's own catch would turn this segment's uuid cast into a 500.
      if (!isEntityId(id)) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

      // Delete only within the caller's tenant. segment_members rows are
      // removed automatically via the ON DELETE CASCADE FK on segment_id.
      const [deleted] = await db
        .delete(segments)
        .where(and(eq(segments.id, id), eq(segments.tenantId, ctx.tenantId)))
        .returning({ id: segments.id, name: segments.name });

      if (!deleted) {
        return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'delete',
        entityType: 'segment',
        entityId: deleted.id,
        oldData: { name: deleted.name },
      });

      return NextResponse.json({ ok: true, message: 'Segment deleted' });
    } catch (err) {
      await logError({ error: err, context: 'segments/[id] DELETE', requestMethod: 'DELETE' });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
);
