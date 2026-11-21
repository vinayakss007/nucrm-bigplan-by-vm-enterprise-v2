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
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { db, type DbClient } from '@/drizzle/db';
import { supportTickets } from '@/drizzle/schema';
import { eq, and, inArray, or, ilike, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { canTransitionTicket } from '@/lib/tickets';
import { transitionStatusMany } from '@/lib/state/transition';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const MAX_BULK = 500;

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;

  
  let ctx!: AuthContext;
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    ctx = auth;

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
          ilike(supportTickets.subject, `%${escapeLike(filters.q)}%`),
          ilike(supportTickets.body, `%${escapeLike(filters.q)}%`),
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

    // Validate all IDs belong to this tenant. `status` rides along so the
    // status action can claim the state it read (#3407).
    const valid = await db
      .select({ id: supportTickets.id, status: supportTickets.status })
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
    let skipped = 0;

    switch (action) {
      case 'assign': {
        const userId = payload.user_id;
        if (!userId) return NextResponse.json({ error: 'payload.user_id required' }, { status: 400 });
        await db.transaction(async (tx) => {
          // #3408/#3407: report how many rows the write ACTUALLY touched, and
          // re-assert tenant + live-tombstone in the WHERE — the validation
          // read above is unlocked, so a ticket can be deleted in the gap.
          const rows = await tx.update(supportTickets)
            .set({ assignedTo: userId, updatedAt: new Date() })
            .where(and(
              eq(supportTickets.tenantId, ctx.tenantId),
              inArray(supportTickets.id, validIds),
              isNull(supportTickets.deletedAt),
            ))
            .returning({ id: supportTickets.id });
          affected = rows.length;
          skipped = ticket_ids.length - affected;
          await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_assign', entityType: 'ticket', entityId: validIds[0], newData: { count: affected, skipped, user_id: userId }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'status': {
        const status = payload.status;
        if (!status || !VALID_STATUSES.includes(status)) {
          return NextResponse.json({ error: `payload.status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
        }
        // #3407: only tickets whose state can move to `status` are eligible;
        // the rest are reported as skipped rather than silently rewritten.
        const byFromStatus = new Map<string, string[]>();
        for (const row of valid) {
          if (!canTransitionTicket(row.status, status)) continue;
          const ids = byFromStatus.get(row.status) ?? [];
          ids.push(row.id);
          byFromStatus.set(row.status, ids);
        }

        const update: Record<string, unknown> = { status, updatedAt: new Date() };
        if (status === 'resolved') update.resolvedAt = new Date();

        await db.transaction(async (tx) => {
          // #3407 PR-4A: the claim belongs to the shared transition owner.
          // Each from-state group goes through transitionStatusMany, whose
          // UPDATE pins tenant, from-state and tombstone under the row lock;
          // a ticket another agent moved is simply absent from `rows`.
          for (const [fromStatus, ids] of byFromStatus) {
            const { rows } = await transitionStatusMany(tx, {
              table: supportTickets,
              ids,
              tenantId: ctx.tenantId,
              from: [fromStatus],
              to: status,
              patch: update,
            });
            affected += rows.length;
          }
          skipped = validIds.length - affected;
          await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_status', entityType: 'ticket', entityId: validIds[0], newData: { count: affected, skipped, status }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'priority': {
        const priority = payload.priority;
        if (!priority || !VALID_PRIORITIES.includes(priority)) {
          return NextResponse.json({ error: `payload.priority must be one of: ${VALID_PRIORITIES.join(', ')}` }, { status: 400 });
        }
        await db.transaction(async (tx) => {
          const rows = await tx.update(supportTickets)
            .set({ priority, updatedAt: new Date() })
            .where(and(
              eq(supportTickets.tenantId, ctx.tenantId),
              inArray(supportTickets.id, validIds),
              isNull(supportTickets.deletedAt),
            ))
            .returning({ id: supportTickets.id });
          affected = rows.length;
          skipped = ticket_ids.length - affected;
          await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_priority', entityType: 'ticket', entityId: validIds[0], newData: { count: affected, skipped, priority }, dbOrTx: tx as DbClient });
        });
        break;
      }
      case 'delete': {
        await db.transaction(async (tx) => {
          // Re-assert the live tombstone in the WHERE so a ticket deleted in
          // the gap is not counted as freshly deleted by this operation.
          const rows = await tx.update(supportTickets)
            .set({ deletedAt: new Date() })
            .where(and(
              eq(supportTickets.tenantId, ctx.tenantId),
              inArray(supportTickets.id, validIds),
              isNull(supportTickets.deletedAt),
            ))
            .returning({ id: supportTickets.id });
          affected = rows.length;
          skipped = ticket_ids.length - affected;
          await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'bulk_delete', entityType: 'ticket', entityId: validIds[0], newData: { count: affected, skipped }, dbOrTx: tx as DbClient });
        });
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, affected, skipped, action });

  
  } catch (err) {
    void logError({ error: err, context: 'tenant/tickets/bulk' });
    return apiError(err);
  }
});
