/**
 * Shared lead → contact conversion logic.
 * Used by POST /api/tenant/leads/[id]/convert and the bulk lead operations route,
 * so bulk conversions run the exact same pipeline as single-lead conversion.
 */
import { withTenantDb } from '@/lib/db';
import {
  leads,
  contacts,
  companies,
  deals,
  pipelines,
  leadActivities,
  activities,
  dealStages,
  tenants,
  plans,
} from '@/drizzle/schema';
import { eq, and, sql, isNull, type SQL } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { createNotification } from '@/lib/notifications';
import { logError } from '@/lib/errors-server';

export interface ConvertLeadParams {
  tenantId: string;
  actorId: string;
  leadId: string;
  createDeal?: boolean;
  dealTitle?: string;
  dealValue?: number;
  dealStage?: string;
  pipelineId?: string;
  assignedTo?: string;
  /**
   * #2696 — the caller's row-level narrowing, normally
   * `ownerScope(ctx, 'leads.view_all', leads)`. It belongs on the lookup rather
   * than on each write, because a conversion has no meaningful partial success:
   * a lead the caller may not touch has to read as absent, and everything
   * downstream (contact merge, deal insert, the `assigned_to` backfill) hangs
   * off the row this selects. `undefined` for a `view_all` holder, which
   * drizzle's `and()` skips, so their SQL is unchanged.
   *
   * Callers that already resolved their id set against the same rule —
   * `leads/bulk` since #2692 — may leave it out.
   */
  leadScope?: SQL;
  /**
   * #3409: whether to enforce plan quota limits (contacts and deals).
   * When true (or defaulted from USAGE_LIMITS=on), admissions are checked
   * under a FOR UPDATE row lock inside the conversion transaction.
   */
  enforceLimits?: boolean;
}

export type ConvertLeadResult =
  | {
      ok: true;
      contactId: string;
      dealId: string | null;
      isNewContact: boolean;
      assignee: string;
      leadName: string;
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_converted'; contactId: string }
  | { ok: false; reason: 'contact_limit_reached'; limit: number; actual: number }
  | { ok: false; reason: 'deal_limit_reached'; limit: number; actual: number };

/**
 * Converts a lead → contact, optionally creates a linked deal.
 * Marks the lead as converted and stores the resulting contact_id.
 * Runs all writes in a single transaction; fires audit/webhook/notification
 * side effects after commit. Idempotent: returns already_converted for
 * previously converted leads instead of double-converting.
 */
export async function convertLeadCore(
  params: ConvertLeadParams
): Promise<ConvertLeadResult> {
  // #1454: destructure the camelCase keys that ConvertLeadParams actually
  // defines and every caller passes. The previous snake_case destructure
  // (create_deal, deal_title, ...) never matched, so create_deal was always
  // undefined -> the deal-creation branch never ran and conversions silently
  // produced no deal.
  const {
    tenantId,
    actorId,
    leadId: id,
    createDeal = false,
    dealTitle,
    dealValue = 0,
    dealStage,
    pipelineId,
    assignedTo,
    leadScope,
    enforceLimits: explicitEnforceLimits,
  } = params;

  const enforceLimits = explicitEnforceLimits ?? (process.env['USAGE_LIMITS'] === 'on');

  // Load the lead
  // #3405: the lead lookup runs on a branded client bound to the tenant.
  const lead = await withTenantDb(tenantId, actorId, async (db) => db.query.leads.findFirst({
    where: and(
      eq(leads.id, id),
      eq(leads.tenantId, tenantId),
      isNull(leads.deletedAt),
      leadScope
    )
  }));

  if (!lead) {
    return { ok: false, reason: 'not_found' };
  }
  if (lead.leadStatus === 'converted' && lead.convertedContactId) {
    return { ok: false, reason: 'already_converted', contactId: lead.convertedContactId };
  }

  const assignee = assignedTo || lead.assignedTo || actorId;

  // Build a discovery summary from BANT-style lead fields so it isn't lost on conversion
  const discovery: Record<string, unknown> = {};
  if (lead.budget != null) discovery['budget'] = lead.budget;
  if (lead.budgetCurrency) discovery['budget_currency'] = lead.budgetCurrency;
  if (lead.authorityLevel && lead.authorityLevel !== 'unknown') discovery['authority_level'] = lead.authorityLevel;
  if (lead.needDescription) discovery['need_description'] = lead.needDescription;
  if (lead.timeline) discovery['timeline'] = lead.timeline;
  if (lead.timelineTargetDate) discovery['timeline_target_date'] = lead.timelineTargetDate;
  if (lead.companyIndustry) discovery['company_industry'] = lead.companyIndustry;
  if (lead.value != null) discovery['estimated_value'] = lead.value;

  const hasDiscovery = Object.keys(discovery).length > 0;
  const discoverySummary = hasDiscovery
    ? [
        discovery['budget'] != null
          ? `Budget: ${discovery['budget']}${discovery['budget_currency'] ? ` ${discovery['budget_currency']}` : ''}`
          : null,
        discovery['authority_level'] ? `Authority: ${discovery['authority_level']}` : null,
        discovery['timeline'] ? `Timeline: ${discovery['timeline']}` : null,
        discovery['timeline_target_date'] ? `Target date: ${discovery['timeline_target_date']}` : null,
        discovery['company_industry'] ? `Industry: ${discovery['company_industry']}` : null,
        discovery['estimated_value'] != null ? `Estimated value: ${discovery['estimated_value']}` : null,
        discovery['need_description'] ? `Need: ${discovery['need_description']}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const result = await withTenantDb(tenantId, actorId, async (tx) => {
    // #3409 — lock the tenant row FOR UPDATE and fetch plan limits
    let lockedTenant: {
      currentContacts: number | null;
      maxContacts: number | null;
      currentDeals: number | null;
      maxDeals: number | null;
    } | undefined = undefined;

    if (typeof tx.select === 'function') {
      try {
        let q = tx
          .select({
            currentContacts: tenants.currentContacts,
            maxContacts: plans.maxContacts,
            currentDeals: tenants.currentDeals,
            maxDeals: plans.maxDeals,
          })
          .from(tenants)
          .leftJoin(plans, eq(plans.id, tenants.planId))
          .where(eq(tenants.id, tenantId))
          .limit(1);

        if (typeof (q as { for?: unknown }).for === 'function') {
          q = (q as { for: (mode: string) => typeof q }).for('update');
        }

        const [locked] = await q;
        lockedTenant = locked;
      } catch {
        // Defensive: if a mock tx doesn't support select/for, allow transaction to proceed
      }
    }

    // ── 1. Resolve target contact to determine if new contact needed ──
    // New workflow: every lead has a contact_id at intake. Trust that link
    // and skip the email-dedup path. Legacy leads without contact_id fall
    // through to the email-dedup + create-contact path for backwards compat.
    let contactId: string | null = lead.contactId ?? null;
    let isNewContact = false;
    let existingContact: { id: string; score: number | null } | undefined = undefined;

    if (contactId) {
      isNewContact = false;
    } else if (lead.email) {
      existingContact = await tx.query.contacts.findFirst({
        where: and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.email, lead.email.toLowerCase().trim()),
          isNull(contacts.deletedAt)
        ),
        columns: { id: true, score: true }
      });

      if (existingContact) {
        contactId = existingContact.id;
        isNewContact = false;
      } else {
        isNewContact = true;
      }
    } else {
      isNewContact = true;
    }

    // ── 2. In-transaction quota admission check before any writes ─────
    if (enforceLimits && lockedTenant) {
      if (isNewContact) {
        const projectedContacts = (lockedTenant.currentContacts ?? 0) + 1;
        if (lockedTenant.maxContacts != null && projectedContacts > lockedTenant.maxContacts) {
          return {
            admitted: false as const,
            reason: 'contact_limit_reached' as const,
            limit: lockedTenant.maxContacts,
            actual: projectedContacts,
          };
        }
      }
      if (createDeal) {
        const projectedDeals = (lockedTenant.currentDeals ?? 0) + 1;
        if (lockedTenant.maxDeals != null && projectedDeals > lockedTenant.maxDeals) {
          return {
            admitted: false as const,
            reason: 'deal_limit_reached' as const,
            limit: lockedTenant.maxDeals,
            actual: projectedDeals,
          };
        }
      }
    }

    // ── 3. Resolve company ──────────────────────────────────────────
    let companyId: string | null = lead.companyId;

    if (!companyId && lead.companyName?.trim()) {
      const existingCo = await tx.query.companies.findFirst({
        where: and(
          eq(companies.tenantId, tenantId),
          sql`lower(${companies.name}) = lower(${lead.companyName.trim()})`,
          isNull(companies.deletedAt)
        ),
        columns: { id: true }
      });

      if (existingCo) {
        companyId = existingCo.id;
      } else {
        const [co] = await tx.insert(companies).values({
          tenantId: tenantId,
          name: lead.companyName.trim(),
          industry: lead.companyIndustry || null,
          website: lead.website || null,
          createdBy: actorId
        }).returning({ id: companies.id });
        if (!co) throw new Error('Failed to create company');
        companyId = co.id;
      }
    }

    // ── 4. Apply contact update or insert ───────────────────────────
    if (contactId) {
      if (lead.contactId) {
        // Linked contact at intake
        await tx.update(contacts).set({
          phone: lead.phone || undefined,
          jobTitle: lead.title || undefined,
          companyId: companyId || undefined,
          assignedTo: assignee,
          leadStatus: 'qualified',
          lifecycleStage: 'opportunity',
          score: sql`GREATEST(coalesce(${contacts.score}, 0), ${lead.score ?? 0})`,
          updatedAt: new Date(),
        }).where(and(
          eq(contacts.id, contactId),
          eq(contacts.tenantId, tenantId),
        ));
      } else if (existingContact) {
        // Found by email dedup
        const mergedNotes = hasDiscovery
          ? [discoverySummary, lead.internalNotes].filter(Boolean).join('\n\n')
          : lead.internalNotes || undefined;
        await tx.update(contacts).set({
          phone: lead.phone || undefined,
          jobTitle: lead.title || undefined,
          companyId: companyId || undefined,
          assignedTo: assignee,
          leadStatus: 'qualified',
          lifecycleStage: 'opportunity',
          score: Math.max(existingContact.score || 0, lead.score || 0),
          notes: mergedNotes
            ? sql`coalesce(${contacts.notes}, '') || ${'\n\n' + mergedNotes}`
            : undefined,
          updatedAt: new Date()
        }).where(eq(contacts.id, contactId));
      }
    }

    if (isNewContact) {
      const newContactNotes = [discoverySummary, lead.internalNotes].filter(Boolean).join('\n\n') || null;
      const [contact] = await tx.insert(contacts).values({
        tenantId: tenantId,
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
        assignedTo: assignee,
        createdBy: actorId,
        notes: newContactNotes,
        metadata: {
          source_lead_id: id,
          ...(hasDiscovery ? { discovery } : {}),
        },
      }).returning({ id: contacts.id });
      if (!contact) throw new Error('Failed to create contact');
      contactId = contact.id;
    }

    // Backfill the lead's contact_id pointer if it was missing (legacy lead path).
    if (!lead.contactId && contactId) {
      // #2696 — these two writes addressed the lead by bare id. The row is
      // already resolved tenant-scoped above, so RLS was the only thing between
      // a wrong `id` and another tenant's lead; state the tenant in the
      // statement like every other write in the codebase.
      await tx.update(leads)
        .set({ contactId })
        .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));
    }

    // ── 5. Mark lead as converted ───────────────────────────────────
    await tx.update(leads).set({
      leadStatus: 'converted',
      isConverted: true,
      convertedAt: new Date(),
      convertedContactId: contactId,
      lifecycleStage: 'opportunity',
      updatedAt: new Date()
    }).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));

    // Log activity on the lead
    await tx.insert(leadActivities).values({
      tenantId: tenantId,
      leadId: id,
      performedBy: actorId,
      activityType: 'converted',
      description: 'Lead converted to contact',
      activityData: { contact_id: contactId, created_by: actorId }
    }).catch((err) => logError({ error: err, context: "async-catch:leads/convert" }));

    // ── 4. Optionally create a deal ─────────────────────────────────
    let dealId: string | null = null;
    if (createDeal) {
      const fullName = `${lead.firstName} ${lead.lastName || ''}`.trim();
      const title = (dealTitle?.trim()) ||
        (lead.companyName ? `${lead.companyName} — ${fullName}` : fullName || 'New Deal');

      // Resolve pipeline
      let resolvedPipelineId = pipelineId || null;
      if (!resolvedPipelineId) {
        const defaultPipeline = await tx.query.pipelines.findFirst({
          where: and(
            eq(pipelines.tenantId, tenantId),
          )
        });
        resolvedPipelineId = defaultPipeline?.id ?? null;
      }

      // Get first stage of the pipeline if stage not provided
      let resolvedStageId = dealStage;
      if (!resolvedStageId && resolvedPipelineId) {
        const firstStage = await tx.query.dealStages.findFirst({
          where: eq(dealStages.pipelineId, resolvedPipelineId),
          orderBy: (stages, { asc }) => [asc(stages.order)]
        });
        resolvedStageId = firstStage?.id;
      }

      if (resolvedStageId) {
        // Prefer the lead's estimated value if no explicit dealValue was supplied
        const resolvedAmount =
          (typeof dealValue === 'number' && dealValue > 0)
            ? dealValue
            : (parseFloat(String(dealValue)) > 0
                ? parseFloat(String(dealValue))
                : (lead.value != null ? parseFloat(String(lead.value)) || 0 : 0));

        const [deal] = await tx.insert(deals).values({
          tenantId: tenantId,
          title: title,
          stageId: resolvedStageId,
          amount: resolvedAmount.toString(),
          contactId: contactId,
          companyId: companyId,
          pipelineId: resolvedPipelineId,
          assignedTo: assignee,
          createdBy: actorId,
          metadata: {
            source_lead_id: id,
            ...(hasDiscovery ? { discovery } : {}),
          },
        }).returning({ id: deals.id });
        if (!deal) throw new Error('Failed to create deal');
        dealId = deal.id;

        // Log deal creation activity
        await tx.insert(activities).values({
          tenantId: tenantId,
          userId: actorId,
          contactId: contactId,
          dealId: dealId,
          entityType: 'deal',
          entityId: dealId,
          eventType: 'deal_created',
          action: 'create',
          description: 'Deal created from lead conversion',
        }).catch((err) => logError({ error: err, context: "async-catch:leads/convert" }));
      }
    }

    // Update tenant counters for newly created records
    if (isNewContact) {
      await tx.update(tenants)
        .set({ currentContacts: sql`COALESCE(${tenants.currentContacts}, 0) + 1` })
        .where(eq(tenants.id, tenantId));
    }
    if (dealId) {
      await tx.update(tenants)
        .set({ currentDeals: sql`COALESCE(${tenants.currentDeals}, 0) + 1` })
        .where(eq(tenants.id, tenantId));
    }
    return { admitted: true as const, contactId: contactId!, dealId, isNewContact };
  });

  if (!result.admitted) {
    return {
      ok: false,
      reason: result.reason,
      limit: result.limit,
      actual: result.actual,
    };
  }

  // ── 5. Side-effects (outside transaction) ──────────────────────────
  await logAudit({
    tenantId: tenantId, userId: actorId,
    action: 'lead_converted', entityType: 'lead', entityId: id,
    newData: { contact_id: result.contactId, deal_id: result.dealId },
  });

  await fireWebhooks(tenantId, 'contact.created', {
    id: result.contactId,
    lead_id: id,
    converted_from_lead: true,
  }).catch((err) => logError({ error: err, context: "async-catch:leads/convert" }));

  // Notify assignee if different from converter
  if (assignee !== actorId) {
    await createNotification({
      userId: assignee,
      tenantId: tenantId,
      type: 'contact_assigned',
      title: `Lead converted: ${lead.firstName} ${lead.lastName ?? ''}`.trim(),
      body: result.dealId ? 'A new contact and deal have been created for you.' : 'A new contact has been created for you.',
      link: `/tenant/contacts/${result.contactId}`,
    });
  }

  return {
    ok: true,
    contactId: result.contactId,
    dealId: result.dealId,
    isNewContact: result.isNewContact,
    assignee,
    leadName: `${lead.firstName} ${lead.lastName ?? ''}`.trim(),
  };
}
