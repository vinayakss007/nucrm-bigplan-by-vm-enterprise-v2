import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, users, leadActivities } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { updateLeadSchema } from '@/lib/api/schemas';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';

/**
 * GET /api/tenant/leads/[id]
 * Get a single lead with activities
 */
export async function GET(
  request: NextRequest, 
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;
    const rawBody = await request.json();

    // Validate shared fields with schema
    const validated = validateBody(updateLeadSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (v.first_name !== undefined) updateData.firstName = v.first_name;
    if (v.last_name !== undefined) updateData.lastName = v.last_name;
    if (v.email !== undefined) updateData.email = v.email;
    if (v.phone !== undefined) updateData.phone = v.phone;
    if (rawBody.title !== undefined) updateData.title = rawBody.title;
    if (rawBody.company_name !== undefined) updateData.companyName = rawBody.company_name;
    if (rawBody.company_id !== undefined) updateData.companyId = rawBody.company_id;
    if (v.source !== undefined) updateData.source = v.source;
    if (v.status !== undefined) updateData.leadStatus = v.status;
    if (rawBody.lifecycle_stage !== undefined) updateData.lifecycleStage = rawBody.lifecycle_stage;
    if (rawBody.authority_level !== undefined) updateData.authorityLevel = rawBody.authority_level;
    if (rawBody.need_description !== undefined) updateData.needDescription = rawBody.need_description;
    if (rawBody.timeline !== undefined) updateData.timeline = rawBody.timeline;
    if (rawBody.timeline_target_date !== undefined) updateData.timelineTargetDate = rawBody.timeline_target_date;
    if (rawBody.budget !== undefined) updateData.budget = rawBody.budget === '' || rawBody.budget == null ? null : String(rawBody.budget);
    if (rawBody.budget_currency !== undefined) updateData.budgetCurrency = rawBody.budget_currency;
    if (rawBody.company_industry !== undefined) updateData.companyIndustry = rawBody.company_industry;
    if (rawBody.value !== undefined) updateData.value = rawBody.value === '' || rawBody.value == null ? null : String(rawBody.value);
    if (rawBody.country !== undefined) updateData.country = rawBody.country;
    if (rawBody.state !== undefined) updateData.state = rawBody.state;
    if (rawBody.city !== undefined) updateData.city = rawBody.city;
    if (rawBody.address !== undefined) updateData.address = rawBody.address;
    if (rawBody.postal_code !== undefined) updateData.postalCode = rawBody.postal_code;
    if (rawBody.linkedin_url !== undefined) updateData.linkedinUrl = rawBody.linkedin_url;
    if (rawBody.website !== undefined) updateData.website = rawBody.website;
    if (v.assigned_to !== undefined) updateData.assignedTo = v.assigned_to;
    if (rawBody.tags !== undefined) updateData.tags = rawBody.tags;
    if (v.notes !== undefined) updateData.internalNotes = v.notes;
    if (v.custom_fields !== undefined) updateData.customFields = v.custom_fields;
    if (v.score !== undefined) updateData.score = v.score;

    const [updatedLead] = await db.update(leads)
      .set(updateData)
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ))
      .returning();
    
    // Log activity for status changes
    if (rawBody.lead_status) {
      await db.insert(leadActivities).values({
        tenantId: ctx.tenantId,
        leadId: id,
        performedBy: ctx.userId,
        activityType: 'status_change',
        description: `Lead status changed to ${rawBody.lead_status}`,
        activityData: { new_status: rawBody.lead_status },
      });
    }

    fireWebhooks(ctx.tenantId, 'lead.updated', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    
    return NextResponse.json(updatedLead);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    fireWebhooks(ctx.tenantId, 'lead.deleted', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ success: true, message: 'Moved to trash. Restore within 30 days.' });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error deleting lead:', error);
    return NextResponse.json(
      { error: 'Failed to delete lead' },
      { status: 500 }
    );
  }
}
