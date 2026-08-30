/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const DELETE = withApiRoute(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const limited = await rateLimitMutating(req, 'segments', 'delete');
      if (limited) return limited;

      const ctx = await requireAuth(req);
      if (ctx instanceof NextResponse) return ctx;

      const { id } = await params;

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
      void logError({ error: err, context: 'tenant/segments/[id] DELETE' });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
);
