import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { assignContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { createNotification, type NotificationType } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';

// POST: assign one or many contacts to a rep
// { contact_ids: string[], assign_to: string, reason?: string }
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const rawBody = await request.json();
    const validated = validateBody(assignContactSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_ids, assign_to, reason } = v;
    if (!contact_ids?.length) return NextResponse.json({ error:'contact_ids required' }, { status:400 });
    if (!assign_to) return NextResponse.json({ error:'assign_to required' }, { status:400 });

    // Validate assignee is a member
    const [member] = await db
      .select({ userId: tenantMembers.userId, fullName: users.fullName })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(
        and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, assign_to),
          eq(tenantMembers.status, 'active')
        )
      )
      .limit(1);

    if (!member) return NextResponse.json({ error:'Assignee is not an active team member' }, { status:400 });

    // Bulk update
    const result = await db
      .update(contacts)
      .set({ 
        assignedTo: assign_to, 
        lastAssignedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`
        )
      );

    const rowCount = result.rowCount ?? 0;

    // Log assignment history
    // Note: the Drizzle schema uses leadId for leadAssignments. 
    // If these are contacts, we use sql to keep contact_id if the underlying table supports it, 
    // or map to leadId if they are used interchangeably in the new schema.
    // Based on the legacy code, we'll use sql to ensure we hit the right column.
    for (const cid of contact_ids) {
      await db.execute(sql`
        INSERT INTO public.lead_assignments (tenant_id, contact_id, assigned_to, assigned_by, reason)
        VALUES (${ctx.tenantId}, ${cid}, ${assign_to}, ${ctx.userId}, ${reason || null})
      `).catch((err) => console.error('History log failed:', err));
    }

    // Notify assignee
    if (assign_to !== ctx.userId) {
      await createNotification({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        userId: assign_to, tenantId: ctx.tenantId, type:'contact_assigned' as any,
        title: `${rowCount} lead${rowCount!==1?'s':''} assigned to you`,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: reason||undefined, link:'/tenant/leads', entity_type: 'lead' as any,
      });
    }

    await logAudit({ 
      tenantId:ctx.tenantId, 
      userId:ctx.userId, 
      action:'bulk_assign', 
      entityType:'contact', 
      newData:{ count:rowCount, assigned_to:assign_to } 
    });

    return NextResponse.json({ ok:true, assigned: rowCount });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) { 
    return apiError(err); 
  }
}

// DELETE: revoke (unassign) leads — set assigned_to = NULL or reassign to admin
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const rawDelBody = await request.json();
    const delValidated = validateBody(assignContactSchema, rawDelBody);
    if (delValidated instanceof NextResponse) return delValidated;
    const dv = delValidated.data;
    const { contact_ids, reason } = dv;
    if (!contact_ids?.length) return NextResponse.json({ error:'contact_ids required' }, { status:400 });

    // Mark previous assignments as ended
    await db.execute(sql`
      UPDATE public.lead_assignments SET unassigned_at=now()
      WHERE contact_id = ANY(${contact_ids}::uuid[]) AND unassigned_at IS NULL
    `);

    // Unassign — set to null (unowned)
    const result = await db
      .update(contacts)
      .set({ 
        assignedTo: null, 
        lastAssignedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`
        )
      );

    const rowCount = result.rowCount ?? 0;

    await logAudit({ 
      tenantId:ctx.tenantId, 
      userId:ctx.userId, 
      action:'bulk_unassign', 
      entityType:'contact', 
      newData:{ count:rowCount, reason } 
    });

    return NextResponse.json({ ok:true, unassigned: rowCount });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) { 
    return apiError(err); 
  }
}
