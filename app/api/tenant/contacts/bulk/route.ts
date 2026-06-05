/**
 * Bulk Contact Operations
 * POST /api/tenant/contacts/bulk
 * Body: { action, contact_ids, payload? }
 * Actions: tag, untag, assign, status, delete, export
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { bulkUpdateSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors';

const MAX_BULK = 500;

export async function POST(req: NextRequest) {
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await req.json();
    const validated = validateBody(bulkUpdateSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { ids: contact_ids, updates: payload } = v;
    const action = rawBody.action;

    if (!Array.isArray(contact_ids) || !contact_ids.length)
      return NextResponse.json({ error: 'contact_ids array required' }, { status: 400 });
    if (contact_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} contacts per bulk operation` }, { status: 400 });

    // Validate all IDs belong to this tenant
    const valid = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contact_ids),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`
        )
      );
    
    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid contacts found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'tag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = (payload['tag'] as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            tags: sql`array_append(${contacts.tags}, ${tag})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId),
              sql`NOT (${tag} = ANY(${contacts.tags}))`
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'untag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = (payload['tag'] as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            tags: sql`array_remove(${contacts.tags}, ${tag})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'assign': {
        const deny = requirePerm(ctx, 'contacts.assign');
        if (deny) return deny;
        const assignTo = payload['assign_to'] as string | undefined;
        if (!assignTo) return NextResponse.json({ error: 'assign_to required' }, { status: 400 });
        
        // Verify assignee is a member
        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, assignTo),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
        
        if (!member) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        
        const res = await db
          .update(contacts)
          .set({
            assignedTo: assignTo,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'status': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const leadStatus = payload['lead_status'] as string | undefined;
        const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
        if (!leadStatus || !STATUSES.includes(leadStatus))
          return NextResponse.json({ error: `lead_status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        
        const res = await db
          .update(contacts)
          .set({
            leadStatus: leadStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'contacts.delete');
        if (deny) return deny;
        
        const res = await db
          .update(contacts)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            isArchived: true,
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId),
              sql`${contacts.deletedAt} IS NULL`
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'do_not_contact': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const val = payload['value'] !== false;
        
        const res = await db
          .update(contacts)
          .set({
            doNotContact: val,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(contacts.id, validIds),
              eq(contacts.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'contact',
      newData: { count: affected, contact_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
  } catch (err: any) {
    console.error('[contacts bulk POST]', err);
    await logError({ error: err, context: 'contacts/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
}

