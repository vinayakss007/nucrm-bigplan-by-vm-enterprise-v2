/**
 * POST /api/tenant/leads/[id]/convert
 *
 * Converts a lead → contact, optionally creates a linked deal.
 * Marks the lead as converted and stores the resulting contact_id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { convertLeadSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, contacts, companies, deals, pipelines, leadActivities, activities, dealStages } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { createNotification } from '@/lib/notifications';

export async function POST(
  request: NextRequest, 
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'leads.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const rawBody = await request.json().catch(() => ({}));
    const validated = validateBody(convertLeadSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const {
      create_deal    = false,
      deal_title,
      deal_value     = 0,
      deal_stage,
      pipeline_id,
      assigned_to,
    } = v;

    // Load the lead
    const lead = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, id),
        eq(leads.tenantId, ctx.tenantId),
        isNull(leads.deletedAt)
      )
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    if (lead.leadStatus === 'converted' && lead.convertedContactId) {
      return NextResponse.json({
        error: 'Lead already converted',
        contact_id: lead.convertedContactId,
      }, { status: 409 });
    }

    const assignee = assigned_to || lead.assignedTo || ctx.userId;

    const result = await db.transaction(async (tx) => {
      // ── 1. Resolve company ──────────────────────────────────────────
      let companyId: string | null = lead.companyId;
      
      if (!companyId && lead.companyName?.trim()) {
        const existingCo = await tx.query.companies.findFirst({
          where: and(
            eq(companies.tenantId, ctx.tenantId),
            sql`lower(${companies.name}) = lower(${lead.companyName.trim()})`,
            isNull(companies.deletedAt)
          ),
          columns: { id: true }
        });

        if (existingCo) {
          companyId = existingCo.id;
        } else {
          const [co] = await tx.insert(companies).values({
            tenantId: ctx.tenantId,
            name: lead.companyName.trim(),
            industry: lead.companyIndustry || null,
            website: lead.website || null,
            createdBy: ctx.userId
          }).returning({ id: companies.id });
          if (!co) throw new Error('Failed to create company');
          companyId = co.id;
        }
      }

      // ── 2. Check for existing contact with same email ───────────────
      let contactId: string | null = null;
      let isNewContact = false;

      if (lead.email) {
        const existing = await tx.query.contacts.findFirst({
          where: and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.email, lead.email.toLowerCase().trim()),
            isNull(contacts.deletedAt)
          ),
          columns: { id: true, score: true }
        });

        if (existing) {
          // Merge key lead fields into existing contact
          contactId = existing.id;
          await tx.update(contacts).set({
            phone: lead.phone || undefined,
            jobTitle: lead.title || undefined,
            companyId: companyId || undefined,
            assignedTo: assignee as any,
            leadStatus: 'qualified',
            lifecycleStage: 'opportunity',
            score: Math.max(existing.score || 0, lead.score || 0),
            updatedAt: new Date()
          }).where(eq(contacts.id, contactId));
        } else {
          isNewContact = true;
        }
      } else {
        isNewContact = true;
      }

      if (isNewContact) {
        const [contact] = await tx.insert(contacts).values({
          tenantId: ctx.tenantId,
          firstName: lead.firstName,
          lastName: lead.lastName || '',
          email: lead.email?.toLowerCase().trim() || null,
          phone: lead.phone || null,
          jobTitle: lead.title || null,
          companyId: companyId,
          leadStatus: 'qualified',
          leadSource: lead.source || 'converted_lead',
          lifecycleStage: 'opportunity',
          score: lead.score ?? 0,
          tags: lead.tags ?? [],
          country: lead.country || null,
          city: lead.city || null,
          linkedinUrl: lead.linkedinUrl || null,
          assignedTo: assignee as any,
          createdBy: ctx.userId,
          notes: lead.internalNotes || null,
        }).returning({ id: contacts.id });
        if (!contact) throw new Error('Failed to create contact');
        contactId = contact.id;
      }

      // ── 3. Mark lead as converted ───────────────────────────────────
      await tx.update(leads).set({
        leadStatus: 'converted',
        isConverted: true,
        convertedAt: new Date(),
        convertedContactId: contactId,
        lifecycleStage: 'opportunity',
        updatedAt: new Date()
      }).where(eq(leads.id, id));

      // Log activity on the lead
      await tx.insert(leadActivities).values({
        tenantId: ctx.tenantId,
        leadId: id,
        performedBy: ctx.userId,
        activityType: 'converted',
        description: 'Lead converted to contact',
        activityData: { contact_id: contactId, created_by: ctx.userId }
      }).catch(() => {});

      // ── 4. Optionally create a deal ─────────────────────────────────
      let dealId: string | null = null;
      if (create_deal) {
        const fullName = `${lead.firstName} ${lead.lastName || ''}`.trim();
        const title = (deal_title?.trim()) ||
          (lead.companyName ? `${lead.companyName} — ${fullName}` : fullName || 'New Deal');

        // Resolve pipeline
        let resolvedPipelineId = pipeline_id || null;
        if (!resolvedPipelineId) {
          const defaultPipeline = await tx.query.pipelines.findFirst({
            where: and(
              eq(pipelines.tenantId, ctx.tenantId),
            )
          });
          resolvedPipelineId = defaultPipeline?.id ?? null;
        }

        // Get first stage of the pipeline if stage not provided
        let resolvedStageId = deal_stage;
        if (!resolvedStageId && resolvedPipelineId) {
          const firstStage = await tx.query.dealStages.findFirst({
            where: eq(dealStages.pipelineId, resolvedPipelineId),
            orderBy: (stages, { asc }) => [asc(stages.order)]
          });
          resolvedStageId = firstStage?.id;
        }

        if (resolvedStageId) {
          const [deal] = await tx.insert(deals).values({
            tenantId: ctx.tenantId,
            title: title,
            stageId: resolvedStageId,
            amount: (typeof deal_value === 'number' ? deal_value : parseFloat(deal_value) || 0).toString(),
            contactId: contactId,
            companyId: companyId,
            pipelineId: resolvedPipelineId,
            assignedTo: assignee as any,
            createdBy: ctx.userId,
          }).returning({ id: deals.id });
          if (!deal) throw new Error('Failed to create deal');
          dealId = deal.id;

          // Log deal creation activity
          await tx.insert(activities).values({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            contactId: contactId,
            dealId: dealId,
            entityType: 'deal',
            entityId: dealId,
            eventType: 'deal_created',
            action: 'create',
            description: 'Deal created from lead conversion',
          }).catch(() => {});
        }
      }

      return { contactId: contactId!, dealId, isNewContact };
    });

    // ── 5. Side-effects (outside transaction) ──────────────────────────
    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'lead_converted', entityType: 'lead', entityId: id,
      newData: { contact_id: result.contactId, deal_id: result.dealId },
    });

    await fireWebhooks(ctx.tenantId, 'contact.created', {
      id: result.contactId,
      lead_id: id,
      converted_from_lead: true,
    }).catch(() => {});

    // Notify assignee if different from converter
    if (assignee !== ctx.userId) {
      await createNotification({
        userId: assignee,
        tenantId: ctx.tenantId,
        type: 'contact_assigned' as any,
        title: `Lead converted: ${lead.firstName} ${lead.lastName ?? ''}`.trim(),
        body: result.dealId ? 'A new contact and deal have been created for you.' : 'A new contact has been created for you.',
        link: `/tenant/contacts/${result.contactId}`,
      });
    }

    return NextResponse.json({
      ok: true,
      contact_id: result.contactId,
      deal_id: result.dealId,
      is_new_contact: result.isNewContact,
      message: result.isNewContact ? 'Lead converted to new contact.' : 'Lead merged into existing contact.',
    }, { status: 201 });

  } catch (error: any) {
    console.error('[lead convert] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
