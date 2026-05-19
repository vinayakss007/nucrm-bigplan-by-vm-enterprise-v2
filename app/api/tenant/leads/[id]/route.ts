import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, users, leadActivities } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/tenant/leads/[id]
 * Get a single lead with activities
 */
export async function GET(
  request: NextRequest, 
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;
    
    const lead = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ),
      with: {
        company: true,
      }
    });
    
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Get assigned user details
    let assignedUser = null;
    if (lead.assignedTo) {
      assignedUser = await db.query.users.findFirst({
        where: eq(users.id, lead.assignedTo),
        columns: {
          fullName: true,
          avatarUrl: true,
        }
      });
    }

    // Get creator details
    let creator = null;
    if (lead.createdBy) {
      creator = await db.query.users.findFirst({
        where: eq(users.id, lead.createdBy),
        columns: {
          fullName: true,
        }
      });
    }
    
    // Get recent activities
    const activities = await db.query.leadActivities.findMany({
      where: and(
        eq(leadActivities.leadId, id),
        eq(leadActivities.tenantId, ctx.tenantId)
      ),
      orderBy: [desc(leadActivities.performedAt)],
      limit: 50
    });
    
    return NextResponse.json({
      ...lead,
      assigned_name: assignedUser?.fullName,
      assigned_avatar: assignedUser?.avatarUrl,
      created_by_name: creator?.fullName,
      activities,
    });
  } catch (error: any) {
    console.error('Error fetching lead:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lead' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tenant/leads/[id]
 * Update a lead
 */
export async function PATCH(
  request: NextRequest, 
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;
    const body = await request.json();
    
    // Verify lead exists and belongs to tenant
    const existing = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ),
      columns: { id: true }
    });
    
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    
    // Update mapping (snake_case from body to camelCase for Drizzle)
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (body.first_name !== undefined) updateData.firstName = body.first_name;
    if (body.last_name !== undefined) updateData.lastName = body.last_name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.title !== undefined) updateData.title = body.title;
    if (body.company_name !== undefined) updateData.companyName = body.company_name;
    if (body.company_id !== undefined) updateData.companyId = body.company_id;
    if (body.lead_source !== undefined) updateData.source = body.lead_source;
    if (body.lead_status !== undefined) updateData.leadStatus = body.lead_status;
    if (body.lifecycle_stage !== undefined) updateData.lifecycleStage = body.lifecycle_stage;
    if (body.authority_level !== undefined) updateData.authorityLevel = body.authority_level;
    if (body.need_description !== undefined) updateData.needDescription = body.need_description;
    if (body.timeline !== undefined) updateData.timeline = body.timeline;
    if (body.timeline_target_date !== undefined) updateData.timelineTargetDate = body.timeline_target_date;
    if (body.country !== undefined) updateData.country = body.country;
    if (body.state !== undefined) updateData.state = body.state;
    if (body.city !== undefined) updateData.city = body.city;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.postal_code !== undefined) updateData.postalCode = body.postal_code;
    if (body.linkedin_url !== undefined) updateData.linkedinUrl = body.linkedin_url;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.assigned_to !== undefined) updateData.assignedTo = body.assigned_to;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.notes !== undefined) updateData.internalNotes = body.notes;
    if (body.custom_fields !== undefined) updateData.customFields = body.custom_fields;
    if (body.score !== undefined) updateData.score = body.score;

    const [updatedLead] = await db.update(leads)
      .set(updateData)
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ))
      .returning();
    
    // Log activity for status changes
    if (body.lead_status) {
      await db.insert(leadActivities).values({
        tenantId: ctx.tenantId,
        leadId: id,
        performedBy: ctx.userId,
        activityType: 'status_change',
        description: `Lead status changed to ${body.lead_status}`,
        activityData: { new_status: body.lead_status },
      });
    }
    
    return NextResponse.json(updatedLead);
  } catch (error: any) {
    console.error('Error updating lead:', error);
    return NextResponse.json(
      { error: 'Failed to update lead' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tenant/leads/[id]
 * Soft delete a lead
 */
export async function DELETE(
  request: NextRequest, 
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'leads.delete')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;
    
    const [deleted] = await db.update(leads)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId 
      })
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ))
      .returning({ id: leads.id });

    if (!deleted) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete', entityType: 'lead', entityId: id,
    });

    return NextResponse.json({ success: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (error: any) {
    console.error('Error deleting lead:', error);
    return NextResponse.json(
      { error: 'Failed to delete lead' },
      { status: 500 }
    );
  }
}
