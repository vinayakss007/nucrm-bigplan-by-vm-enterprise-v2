/**
 * Bulk Ticket Operations
 * POST /api/tenant/tickets/bulk
 * Body: { action, ticket_ids?, payload?, selectAll?, filters? }
 * Actions: assign, status, priority, delete, archive, restore
 * When selectAll=true, ticket_ids is optional; tickets are resolved from filters.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { supportTickets, tenantMembers } from '@/drizzle/schema';
import { eq, and, inArray, or, ilike, isNull, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_BULK = 500;

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export async function POST(req: NextRequest) {
  const limited = await checkRateLimit(req, { action: 'bulk', max: 10, windowMinutes: 60 });
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'service-helpdesk');
    if (modErr) return modErr;

    const rawBody = await req.json();
    const action = rawBody.action;
    const selectAll = rawBody.selectAll === true;
    const filters = rawBody.filters as { q?: string; status?: string } | undefined;

    let ticket_ids: string[] = rawBody.ticket_ids ?? [];

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

      if (!ticket_ids.length) {
        return NextResponse.json({ error: 'No tickets match the provided filters' }, { status: 404 });
      }
      if (ticket_ids.length > MAX_BULK) {
        return NextResponse.json({ error: `Max ${MAX_BULK} tickets per bulk operation (matched ${ticket_ids.length})` }, { status: 400 });
      }
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
        const permErr = requirePerm(ctx, 'tickets.manage');
        if (permErr) return permErr;

        const assignTo = rawBody.payload?.assigned_to;
        if (!assignTo) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });

        // Validate target user belongs to tenant
        const [member] = await db.select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, assignTo)))
          .limit(1);
        if (!member) return NextResponse.json({ error: 'User not found in tenant' }, { status: 404 });

        await db.update(supportTickets).set({ assignedTo: assignTo, updatedAt: new Date() }).where(inArray(supportTickets.id, validIds));
        affected = validIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_assign', entityType: 'ticket', newData: { count: validIds.length, user_id: assignTo } });
        break;
      }
      case 'status': {
        const permErr = requirePerm(ctx, 'tickets.manage');
        if (permErr) return permErr;

        const newStatus = rawBody.payload?.status;
        if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
          return NextResponse.json({ error: `payload.status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
        }
        const update: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
        if (newStatus === 'resolved') update.resolvedAt = new Date();
        await db.update(supportTickets).set(update).where(inArray(supportTickets.id, validIds));
        affected = validIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_status', entityType: 'ticket', newData: { count: validIds.length, status: newStatus } });
        break;
      }
      case 'priority': {
        const permErr = requirePerm(ctx, 'tickets.manage');
        if (permErr) return permErr;

        const newPriority = rawBody.payload?.priority;
        if (!newPriority || !VALID_PRIORITIES.includes(newPriority)) {
          return NextResponse.json({ error: `payload.priority must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
        }
        await db.update(supportTickets).set({ priority: newPriority, updatedAt: new Date() }).where(inArray(supportTickets.id, validIds));
        affected = validIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_priority', entityType: 'ticket', newData: { count: validIds.length, priority: newPriority } });
        break;
      }
      case 'delete': {
        const permErr = requirePerm(ctx, 'tickets.delete');
        if (permErr) return permErr;

        await db.update(supportTickets).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(inArray(supportTickets.id, validIds));
        affected = validIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_delete', entityType: 'ticket', newData: { count: validIds.length } });
        break;
      }
      case 'archive': {
        const permErr = requirePerm(ctx, 'tickets.delete');
        if (permErr) return permErr;

        await db.update(supportTickets).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(inArray(supportTickets.id, validIds));
        affected = validIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_archive', entityType: 'ticket', newData: { count: validIds.length } });
        break;
      }
      case 'restore': {
        const permErr = requirePerm(ctx, 'tickets.manage');
        if (permErr) return permErr;

        // For restore, we need to find tickets that ARE deleted
        const deletedTickets = await db
          .select({ id: supportTickets.id })
          .from(supportTickets)
          .where(
            and(
              inArray(supportTickets.id, ticket_ids),
              eq(supportTickets.tenantId, ctx.tenantId),
              sql`${supportTickets.deletedAt} IS NOT NULL`
            )
          );

        const restoreIds = deletedTickets.map(r => r.id);
        if (!restoreIds.length) {
          return NextResponse.json({ error: 'No archived tickets found' }, { status: 404 });
        }

        await db.update(supportTickets).set({ deletedAt: null, deletedBy: null }).where(inArray(supportTickets.id, restoreIds));
        affected = restoreIds.length;
        logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_restore', entityType: 'ticket', newData: { count: restoreIds.length } });
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
