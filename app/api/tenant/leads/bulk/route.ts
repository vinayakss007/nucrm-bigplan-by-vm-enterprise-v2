/**
 * Bulk Lead Operations
 * POST /api/tenant/leads/bulk
 * Body: { action, lead_ids, payload? }
 * Actions: status, assign, tag, delete
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, tenantMembers, contacts, sequences, sequenceEnrollments, segments, segmentMembers } from '@/drizzle/schema';
import { eq, and, inArray, sql, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';

const MAX_BULK = 500;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { action, lead_ids, payload = {} } = body;

    if (!Array.isArray(lead_ids) || !lead_ids.length)
      return NextResponse.json({ error: 'lead_ids array required' }, { status: 400 });
    if (lead_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} leads per bulk operation` }, { status: 400 });

    // Validate all IDs belong to this tenant
    const validLeads = await db
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          inArray(leads.id, lead_ids),
          eq(leads.tenantId, ctx.tenantId),
          sql`${leads.deletedAt} IS NULL`
        )
      );
    
    const validIds = validLeads.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid leads found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'status': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
        if (!STATUSES.includes(payload.lead_status))
          return NextResponse.json({ error: `lead_status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        
        const res = await db
          .update(leads)
          .set({ 
            leadStatus: payload.lead_status, 
            updatedAt: new Date() 
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'assign': {
        const deny = requirePerm(ctx, 'leads.assign');
        if (deny) return deny;
        if (!payload.assigned_to) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });
        
        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, payload.assigned_to),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
          
        if (!member) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        
        const res = await db
          .update(leads)
          .set({ 
            assignedTo: payload.assigned_to, 
            updatedAt: new Date() 
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'tag': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        
        const res = await db
          .update(leads)
          .set({
            tags: sql`array_append(${leads.tags}, ${tag})`,
            updatedAt: new Date()
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId),
              sql`NOT (${tag} = ANY(${leads.tags}))`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'leads.delete');
        if (deny) return deny;
        
        const res = await db
          .update(leads)
          .set({ 
            deletedAt: new Date(), 
            deletedBy: ctx.userId, 
            isArchived: true 
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId),
              sql`${leads.deletedAt} IS NULL`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'convert': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        
        const res = await db
          .update(leads)
          .set({ 
            lifecycleStage: 'customer', 
            updatedAt: new Date() 
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'update_field': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });
        
        const res = await db
          .update(leads)
          .set({
            customFields: sql`jsonb_set(COALESCE(${leads.customFields}, '{}'::jsonb), ${'{"' + fieldKey + '"}'}::text[], ${JSON.stringify(fieldValue)}::jsonb, true)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }
      case 'archive': {
        const deny = requirePerm(ctx, 'leads.delete');
        if (deny) return deny;
        const res = await db
          .update(leads)
          .set({
            isArchived: true,
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'restore': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const res = await db
          .update(leads)
          .set({
            isArchived: false,
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'add_to_segment': {
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId)))
          .limit(1);
        if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        const memberValues = validIds.map(entityId => ({ segmentId: segId, entityId, tenantId: ctx.tenantId }));
        const resSeg = await db.insert(segmentMembers).values(memberValues).onConflictDoNothing();
        affected = resSeg.rowCount ?? memberValues.length;
        break;
      }
      case 'add_to_sequence': {
        const deny = requirePerm(ctx, 'automations.manage');
        if (deny) return deny;
        const sequenceId = payload['sequence_id'] as string | undefined;
        if (!sequenceId) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });
        
        const [seq] = await db.select({ id: sequences.id }).from(sequences)
          .where(and(eq(sequences.id, sequenceId), eq(sequences.tenantId, ctx.tenantId), isNull(sequences.deletedAt)))
          .limit(1);
        if (!seq) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
        
        const leadContacts = await db
          .select({ contactId: leads.contactId })
          .from(leads)
          .where(
            and(
              inArray(leads.id, validIds),
              eq(leads.tenantId, ctx.tenantId),
              sql`${leads.contactId} IS NOT NULL`
            )
          );
        
        const contactIds = [...new Set(leadContacts.map(l => l.contactId).filter(Boolean))] as string[];
        if (!contactIds.length)
          return NextResponse.json({ error: 'No leads with linked contacts found' }, { status: 400 });
        
        const enrollValues = contactIds.map(contactId => ({
          tenantId: ctx.tenantId,
          sequenceId,
          contactId,
          enrolledBy: ctx.userId,
          status: 'active',
          currentStep: 1,
        }));
        
        const res = await db.insert(sequenceEnrollments).values(enrollValues).onConflictDoNothing();
        affected = res.rowCount ?? enrollValues.length;
        
        await db.update(sequences).set({ enrollCount: sql`COALESCE(${sequences.enrollCount}, 0) + ${affected}` })
          .where(eq(sequences.id, sequenceId));
        
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'lead',
      newData: { count: affected, lead_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'leads/bulk', tenantId: undefined });
    return apiError(err);
  }
}
