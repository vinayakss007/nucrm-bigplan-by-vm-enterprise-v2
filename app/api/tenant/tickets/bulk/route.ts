/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bulk Ticket Operations
 * POST /api/tenant/tickets/bulk
 * Body: { action, ticket_ids?, payload?, selectAll?, filters? }
 * Actions: assign, status, priority, delete
 * When selectAll=true, ticket_ids is optional; tickets are resolved from filters.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db, type DbClient } from '@/drizzle/db';
import { supportTickets } from '@/drizzle/schema';
import { eq, and, inArray, or, ilike, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

const MAX_BULK = 500;

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export async function POST(req: NextRequest) {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;

  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requirePerm(ctx, 'tickets.manage');
    if (modErr) return modErr;

    const body = await readJsonBody(req);
    const { action, payload = {} } = body;
    const selectAll = body.selectAll === true;
    const filters = body.filters as { q?: string; status?: string } | undefined;

    let ticket_ids: string[] = body.ticket_ids ?? [];

    if (selectAll) {
      const whereConditions = [
        eq(supportTickets.tenantId, ctx.tenantId),
        isNull(supportTickets.deletedAt),
      ];
      if (filters?.status) {
        whereConditions.push(eq(supportTickets.status, filters.status));
      }
      if (filters?.q) {
        whereConditions.push(or(
          ilike(supportTickets.subject, `%${filters.q}%`),
          ilike(supportTickets.body, `%${filters.q}%`),
        )!);
      }
      const matched = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(and(...whereConditions));
      ticket_ids = matched.map(r => r.id);
      if (!ticket_ids.length) return NextResponse.json({ error: 'No tickets match the provided filters' }, { status: 404 });
      if (ticket_ids.length > MAX_BULK) return NextResponse.json({ error: `Max ${MAX_BULK} tickets per bulk operation (matched ${ticket_ids.length})` }, { status: 400 });
    } else {
      if (!Array.isArray(ticket_ids) || !ticket_ids.length) {
        return NextResponse.json({ error: 'ticket_ids array required' }, { status: 400 });
      }
      if (ticket_ids.length > MAX_BULK) {
        return NextResponse.json({ error: `Max ${MAX_BULK} tickets per bulk operation` }, { status: 400 });
      }
    }

    // Validate all IDs belong to this tenant
    const valid = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.tenantId, ctx.tenantId),
          inArray(supportTickets.id, ticket_ids),
          isNull(supportTickets.deletedAt),
        )
      );
    const validIds = valid.map(r => r.id);
    if (validIds.length !== ticket_ids.length) {
      return NextResponse.json({ error: `${ticket_ids.length - validIds.length} tickets not found or unauthorized` }, { status: 403 });
    }

    let affected = 0;

    switch (action) {
      case 'assign': {
        const userId = payload.user_id;
        if (!userId) return NextResponse.json({ error: 'payload.user_id required' }, { status: 400 });
        await db.transaction(async (tx) => {
          await tx.update(supportTickets).set({ assignedTo: userId, updatedAt: new Date() }).where(inArray(supportTickets.id, validIds));
          affected = validIds.length;
          logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_assign', entityType: 'ticket', entityId: validIds[0], newData: { count: validIds.length, user_id: userId }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'status': {
        const status = payload.status;
        if (!status || !VALID_STATUSES.includes(status)) {
          return NextResponse.json({ error: `payload.status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
        }
        const update: Record<string, unknown> = { status, updatedAt: new Date() };
        if (status === 'resolved') update.resolvedAt = new Date();
        await db.transaction(async (tx) => {
          await tx.update(supportTickets).set(update).where(inArray(supportTickets.id, validIds));
          affected = validIds.length;
          logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_status', entityType: 'ticket', entityId: validIds[0], newData: { count: validIds.length, status }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'priority': {
        const priority = payload.priority;
        if (!priority || !VALID_PRIORITIES.includes(priority)) {
          return NextResponse.json({ error: `payload.priority must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
        }
        await db.transaction(async (tx) => {
          await tx.update(supportTickets).set({ priority, updatedAt: new Date() }).where(inArray(supportTickets.id, validIds));
          affected = validIds.length;
          logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_priority', entityType: 'ticket', entityId: validIds[0], newData: { count: validIds.length, priority }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'delete': {
        await db.transaction(async (tx) => {
          await tx.update(supportTickets).set({ deletedAt: new Date() }).where(inArray(supportTickets.id, validIds));
          affected = validIds.length;
          logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_delete', entityType: 'ticket', entityId: validIds[0], newData: { count: validIds.length }, dbOrTx: tx as DbClient });
        });
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, affected, action });

  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[tickets bulk]', err);
    return apiError(err);
  }
}
