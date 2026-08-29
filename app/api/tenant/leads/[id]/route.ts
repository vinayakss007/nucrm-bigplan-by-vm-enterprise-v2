/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, users, leadActivities } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody, uuidField } from '@/lib/api/validate';
import { updateLeadSchema, LEAD_STATUS_VALUES } from '@/lib/api/schemas';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { withConcurrencyGuard } from '@/lib/concurrency';
import { updatedAtMs } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { apiError } from '@/lib/api-error';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * PATCH body schema — every field the route consumes, all routed through Zod.
 * Shared fields reuse the existing updateLeadSchema validators; lead-only
 * BANT/address fields are validated inline. Unknown keys are stripped.
 */
const patchLeadBodySchema = updateLeadSchema
  .pick({
    first_name: true,
    last_name: true,
    email: true,
    phone: true,
    source: true,
    status: true,
    assigned_to: true,
    notes: true,
    custom_fields: true,
    score: true,
  })
  .extend({
    title: z.string().trim().max(200).nullable().optional(),
    company_name: z.string().trim().max(200).nullable().optional(),
    company_id: uuidField.optional().nullable().or(z.literal('')),
    lifecycle_stage: z.string().trim().max(100).nullable().optional(),
    authority_level: z.string().trim().max(100).nullable().optional(),
    need_description: z.string().trim().max(2000).nullable().optional(),
    timeline: z.string().trim().max(100).nullable().optional(),
    timeline_target_date: z.union([z.string().date(), z.literal(''), z.null()]).optional(),
    budget: z.union([z.coerce.number().min(0), z.literal(''), z.null()]).optional(),
    budget_currency: z.string().trim().max(10).nullable().optional(),
    company_industry: z.string().trim().max(100).nullable().optional(),
    value: z.union([z.coerce.number().min(0), z.literal(''), z.null()]).optional(),
    country: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    postal_code: z.string().trim().max(20).nullable().optional(),
    linkedin_url: z.string().trim().max(500).nullable().optional(),
    website: z.string().trim().max(500).nullable().optional(),
    tags: z.array(z.string()).optional(),
    // Canonical wire field for the lead status. Written to the leadStatus
    // column (aliases/overrides `status`) and also recorded on the activity
    // log. Constrained to the shared LEAD_STATUS_VALUES allowlist so the
    // canonical write path can no longer persist arbitrary status strings.
    lead_status: z.enum(LEAD_STATUS_VALUES).optional(),
  });

/**
 * GET /api/tenant/leads/[id]
 * Get a single lead with activities
 */
export const GET = withApiRoute(async (request: NextRequest, 
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'leads.view');
    if (deny) return deny;

    const { id } = await params;
    
    const lead = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ),
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
      data: {
        ...lead,
        assigned_name: assignedUser?.fullName,
        assigned_avatar: assignedUser?.avatarUrl,
        created_by_name: creator?.fullName,
        activities,
      },
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error, context: 'tenant/leads/[id] GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * PATCH /api/tenant/leads/[id]
 * Update a lead
 */
export const PATCH = withApiRoute(async (request: NextRequest, 
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any) => {
  try {
  const limited = await rateLimitMutating(request, 'leads', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'leads.edit');
    if (deny) return deny;

    const { id } = await params;
    const rawBody = await readJsonBody(request);

    // Validate the entire body — every field is routed through Zod
    const validated = validateBody(patchLeadBodySchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Verify lead exists and belongs to tenant
    const [existing] = await db
      .select({ id: leads.id, updatedAt: leads.updatedAt })
      .from(leads)
      .where(and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      ))
      .limit(1);
    
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    
    // Update mapping (snake_case from body to camelCase for Drizzle)
    // All values come from the Zod-validated body — no raw passthrough
  
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (v.first_name !== undefined) updateData.firstName = v.first_name;
    if (v.last_name !== undefined) updateData.lastName = v.last_name;
    if (v.email !== undefined) updateData.email = v.email;
    if (v.phone !== undefined) updateData.phone = v.phone;
    if (v.title !== undefined) updateData.title = v.title;
    if (v.company_name !== undefined) updateData.companyName = v.company_name;
    if (v.company_id !== undefined) updateData.companyId = v.company_id;
    if (v.source !== undefined) updateData.source = v.source;
    if (v.status !== undefined) updateData.leadStatus = v.status;
    // lead_status is the canonical wire field; honor it on the DB write too
    // (it aliases to the same leadStatus column and wins over `status`).
    if (v.lead_status !== undefined) updateData.leadStatus = v.lead_status;
    if (v.lifecycle_stage !== undefined) updateData.lifecycleStage = v.lifecycle_stage;
    if (v.authority_level !== undefined) updateData.authorityLevel = v.authority_level;
    if (v.need_description !== undefined) updateData.needDescription = v.need_description;
    if (v.timeline !== undefined) updateData.timeline = v.timeline;
    if (v.timeline_target_date !== undefined) updateData.timelineTargetDate = v.timeline_target_date;
    if (v.budget !== undefined) updateData.budget = v.budget === '' || v.budget == null ? null : String(v.budget);
    if (v.budget_currency !== undefined) updateData.budgetCurrency = v.budget_currency;
    if (v.company_industry !== undefined) updateData.companyIndustry = v.company_industry;
    if (v.value !== undefined) updateData.value = v.value === '' || v.value == null ? null : String(v.value);
    if (v.country !== undefined) updateData.country = v.country;
    if (v.state !== undefined) updateData.state = v.state;
    if (v.city !== undefined) updateData.city = v.city;
    if (v.address !== undefined) updateData.address = v.address;
    if (v.postal_code !== undefined) updateData.postalCode = v.postal_code;
    if (v.linkedin_url !== undefined) updateData.linkedinUrl = v.linkedin_url;
    if (v.website !== undefined) updateData.website = v.website;
    if (v.assigned_to !== undefined) updateData.assignedTo = v.assigned_to;
    if (v.tags !== undefined) updateData.tags = v.tags;
    if (v.notes !== undefined) updateData.notes = v.notes;
    if (v.custom_fields !== undefined) updateData.customFields = v.custom_fields;
    if (v.score !== undefined) updateData.score = v.score;

    const [updatedLead] = await db.transaction(async (tx) => {
      const [lead] = await withConcurrencyGuard(
        () => tx.update(leads)
          .set(updateData)
          .where(and(
            eq(leads.id, id),
            eq(leads.tenantId, ctx.tenantId),
            updatedAtMs(leads, existing.updatedAt!),
            isNull(leads.deletedAt)
          ))
          .returning(),
        'Lead',
        existing.updatedAt!,
      );

      if (v.lead_status) {
        await tx.insert(leadActivities).values({
          tenantId: ctx.tenantId,
          leadId: id,
          performedBy: ctx.userId,
          activityType: 'status_change',
          description: `Lead status changed to ${v.lead_status}`,
          activityData: { new_status: v.lead_status },
        });
      }

      return [lead];
    });

    fireWebhooks(ctx.tenantId, 'lead.updated', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    
    return NextResponse.json({ data: updatedLead });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    await logError({ error, context: 'tenant/leads/[id] PATCH', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

/**
 * DELETE /api/tenant/leads/[id]
 * Soft delete a lead
 */
export const DELETE = withApiRoute(async (request: NextRequest, 
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  { params }: any) => {
  try {
  const limited = await rateLimitMutating(request, 'leads', 'delete');
  if (limited) return limited;
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
    await logError({ error, context: 'tenant/leads/[id] DELETE', requestMethod: 'DELETE' });
    return apiError(error);
  }
});
