/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { assignContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { ownerScope } from '@/lib/api/owner-scope';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldWrite } from '@/lib/rbac/enforce';

// POST: assign one or many contacts to a rep
// { contact_ids: string[], assign_to: string, reason?: string }
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const rawBody = await readJsonBody(request);
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

    // #2618 — despite living under /leads, this route bulk-writes
    // contacts.assigned_to; gate that column on the contacts entity, 403 (the
    // assign value IS the action).
    const { stripped } = await enforceFieldWrite(ctx, 'contacts', { assigned_to: assign_to });
    if (stripped.length > 0) {
      return NextResponse.json(
        { error: `field_permissions restricts: ${stripped.join(', ')}` },
        { status: 403 },
      );
    }

    // #2696 — despite the path, every row this route writes is a `contacts`
    // row, so it is the contacts rule that applies: `contacts.view_all` off
    // (sales_rep, lib/permissions/definitions.ts:132-144) means only contacts
    // assigned to or created by the caller. Both statements below took
    // `contact_ids` as handed and narrowed on tenant + tombstone only, so a
    // caller with `contacts.assign` could re-point — or strip — any contact in
    // the workspace. Resolving the set once also makes the reported count the
    // number of rows actually touched. Same pre-read as the bulk routes (#2673).
    const mine = ownerScope(ctx, 'contacts.view_all', contacts);
    const touchable = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`,
          mine
        )
      );

    const validIds = touchable.map(r => r.id);
    if (!validIds.length) {
      return NextResponse.json({ error: 'No assignable contacts found' }, { status: 404 });
    }

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
          inArray(contacts.id, validIds),
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
    // #2696 — only the ids that were actually written: an assignment trail for a
    // contact this caller does not own would claim a handoff that never happened.
    if (validIds.length > 0) {
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
        const chunk = validIds.slice(i, i + CHUNK_SIZE);
        const values = chunk.map(cid => sql`(${ctx.tenantId}, ${cid}, ${assign_to}, ${ctx.userId}, ${reason || null})`);

        await db.execute(sql`
          INSERT INTO public.lead_assignments (tenant_id, contact_id, assigned_to, assigned_by, reason)
          VALUES ${sql.join(values, sql`, `)}
        `).catch(async () => {
          // Fallback to sequential inserts for this chunk if batch fails
          for (const cid of chunk) {
            await db.execute(sql`
              INSERT INTO public.lead_assignments (tenant_id, contact_id, assigned_to, assigned_by, reason)
              VALUES (${ctx.tenantId}, ${cid}, ${assign_to}, ${ctx.userId}, ${reason || null})
            `).catch((err) => { void logError({ error: err, context: 'tenant/leads/assign history log' }); });
          }
        });
      }
    }

    // Notify assignee
    if (assign_to !== ctx.userId) {
      await createNotification({
        userId: assign_to, tenantId: ctx.tenantId, type:'contact_assigned',
        title: `${rowCount} lead${rowCount!==1?'s':''} assigned to you`,
        body: reason||undefined, link:'/tenant/leads', entity_type: 'lead',
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
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

// DELETE: revoke (unassign) leads — set assigned_to = NULL or reassign to admin
export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'leads', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const rawDelBody = await readJsonBody(request);
    const delValidated = validateBody(assignContactSchema, rawDelBody);
    if (delValidated instanceof NextResponse) return delValidated;
    const dv = delValidated.data;
    const { contact_ids, reason } = dv;
    if (!contact_ids?.length) return NextResponse.json({ error:'contact_ids required' }, { status:400 });

    // #2696 — unassigning is the more destructive half: it leaves a contact
    // owned by nobody. Resolve the set against the same contacts rule as POST,
    // so the raw trail update below only ever names rows the caller may touch.
    const mine = ownerScope(ctx, 'contacts.view_all', contacts);
    const touchable = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`,
          mine
        )
      );

    const validIds = touchable.map(r => r.id);
    if (!validIds.length) {
      return NextResponse.json({ error: 'No unassignable contacts found' }, { status: 404 });
    }

    // Mark previous assignments as ended.
    // #1057: scope by tenant_id — without it, a user with contacts.assign in
    // one tenant could end assignment records in ANY tenant.
    await db.execute(sql`
      UPDATE public.lead_assignments SET unassigned_at=now()
      WHERE contact_id = ANY(${validIds}::uuid[])
        AND tenant_id = ${ctx.tenantId}
        AND unassigned_at IS NULL
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
          inArray(contacts.id, validIds),
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
 
 
  } catch (err) { 
    return apiError(err); 
  }
});
