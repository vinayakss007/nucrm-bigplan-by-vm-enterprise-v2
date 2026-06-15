/**
 * POST /api/tenant/leads/[id]/assign
 *
 * Hand a lead off to another team member.
 *
 *  - Updates leads.assigned_to
 *  - Inserts a row into lead_assignments (handoff history)
 *  - Emits an `activities` row (event_type='lead_reassigned') so the
 *    contact's system-events timeline shows who handed it off and why
 *  - Notifies the new assignee
 *
 * Body: { assigned_to: uuid, reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, leadAssignments, leadActivities, activities, users, tenantMembers } from '@/drizzle/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';

const assignSchema = z.object({
  assigned_to: z.string().uuid('assigned_to must be a uuid'),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'leads.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    let rawBody;
    try { rawBody = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const validated = validateBody(assignSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { assigned_to: newAssignee, reason } = validated.data;

    // Verify the lead exists and belongs to the tenant.
    const lead = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt),
      ),
      columns: {
        id: true,
        leadOid: true,
        firstName: true,
        lastName: true,
        contactId: true,
        assignedTo: true,
      },
    });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (lead.assignedTo === newAssignee) {
      return NextResponse.json({ ok: true, message: 'Already assigned to this user', no_op: true });
    }

    // Verify the target user is a member of this tenant.
    const membership = await db.query.tenantMembers.findFirst({
      where: and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, newAssignee)),
      columns: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Target user not found in this tenant' }, { status: 400 });
    }
    const target = await db.query.users.findFirst({
      where: eq(users.id, newAssignee),
      columns: { id: true, fullName: true, email: true },
    });
    if (!target) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 400 });
    }

    let fromUserName: string | null = null;
    if (lead.assignedTo) {
      const from = await db.query.users.findFirst({
        where: eq(users.id, lead.assignedTo),
        columns: { fullName: true },
      });
      fromUserName = from?.fullName ?? null;
    }

    await db.transaction(async (tx) => {
      // 1. Flip the lead's owner.
      await tx.update(leads)
        .set({ assignedTo: newAssignee, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.tenantId, ctx.tenantId)));

      // 2. Append to handoff history.
      await tx.insert(leadAssignments).values({
        tenantId: ctx.tenantId,
        leadId: id,
        contactId: lead.contactId,
        userId: newAssignee,
        reason: reason || null,
      });

      // 3. Lead-side activity (legacy table the lead detail page reads).
      await tx.insert(leadActivities).values({
        tenantId: ctx.tenantId,
        leadId: id,
        performedBy: ctx.userId,
        activityType: 'reassigned',
        description: `Reassigned${fromUserName ? ` from ${fromUserName}` : ''} to ${target.fullName ?? target.email}${reason ? ` — ${reason}` : ''}`,
        activityData: {
          from_user_id: lead.assignedTo,
          to_user_id: newAssignee,
          reason: reason ?? null,
        },
      });

      // 4. Unified activities row for the contact's system-events timeline.
      await tx.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: lead.contactId,
        entityType: 'lead',
        entityId: id,
        eventType: 'lead_reassigned',
        action: 'reassign',
        description: `Lead ${lead.leadOid ?? ''} reassigned${fromUserName ? ` from ${fromUserName}` : ''} to ${target.fullName ?? target.email}${reason ? ` — ${reason}` : ''}`.trim(),
        metadata: {
          lead_oid: lead.leadOid,
          from_user_id: lead.assignedTo,
          from_user_name: fromUserName,
          to_user_id: newAssignee,
          to_user_name: target.fullName ?? target.email,
          reason: reason ?? null,
        },
      });
    });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'reassign',
      entityType: 'lead',
      entityId: id,
      newData: { from_user_id: lead.assignedTo, to_user_id: newAssignee, reason: reason ?? null },
    });

    // Notify the new owner.
    if (newAssignee !== ctx.userId) {
      await createNotification({
        userId: newAssignee,
        tenantId: ctx.tenantId,
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'contact_assigned' as any,
        title: `Lead handed off to you${lead.leadOid ? `: ${lead.leadOid}` : ''}`,
        body: `${lead.firstName} ${lead.lastName ?? ''}`.trim() + (reason ? ` — ${reason}` : ''),
        link: `/tenant/leads/${id}`,
      }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[leads/assign] error:', error);
    return apiError(error, "Internal server error", 500);
  }
}
