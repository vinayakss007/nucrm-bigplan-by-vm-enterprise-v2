/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createLeadSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { checkLimit } from '@/lib/usage/middleware';
import { db } from '@/drizzle/db';
import { leads, users, companies, leadActivities, activities, contacts } from '@/drizzle/schema';
import { eq, and, or, desc, sql, ilike, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveOrCreateContactForLead } from '@/lib/contacts/resolve';
import { generateLeadOid } from '@/lib/leads/oid';
import { resolveAssignee } from '@/lib/assignment-resolver';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { createNotification } from '@/lib/notifications';
import { escapeLike } from '@/lib/api/sanitize-like';

// Whitelist for sort columns to prevent SQL injection
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALLOWED_SORT_COLUMNS: Record<string, any> = {
  'created_at': leads.createdAt,
  'updated_at': leads.updatedAt,
  'last_activity_at': leads.lastActivityAt,
  'first_name': leads.firstName,
  'last_name': leads.lastName,
  'email': leads.email,
  'company_name': leads.companyName,
  'lead_status': leads.leadStatus,
  'score': leads.score,
};

// GET /api/tenant/leads - List leads with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);

    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get('limit')  ?? '50')));
    const offset = Math.max(0,                parseInt(searchParams.get('offset') ?? '0'));
    const q              = searchParams.get('q')?.trim() ?? '';
    const leadStatus     = searchParams.get('lead_status') ?? '';
    const assignedTo     = searchParams.get('assigned_to') ?? '';

    const rawSortBy = searchParams.get('sort_by') ?? 'created_at';
    const sortByColumn = ALLOWED_SORT_COLUMNS[rawSortBy] || leads.createdAt;
    const sortOrder = searchParams.get('sort_order') === 'ASC' ? sql`ASC` : sql`DESC`;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [
      eq(leads.tenantId, ctx.tenantId),
      isNull(leads.deletedAt)
    ];

    if (!can(ctx, 'leads.view_all')) {
      filters.push(or(eq(leads.assignedTo, ctx.userId), eq(leads.createdBy, ctx.userId)));
    }

    if (leadStatus) {
      filters.push(eq(leads.leadStatus, leadStatus));
    }
    if (assignedTo) {
      filters.push(eq(leads.assignedTo, assignedTo));
    }

    if (q) {
      const searchWildcard = `%${escapeLike(q)}%`;
      filters.push(or(
        ilike(leads.firstName, searchWildcard),
        ilike(leads.lastName, searchWildcard),
        ilike(leads.email, searchWildcard),
        ilike(leads.phone, searchWildcard),
        ilike(leads.companyName, searchWildcard)
      ));
    }

    const [countResult] = await db.select({ 
      count: sql<number>`count(*)::int` 
    })
    .from(leads)
    .where(and(...filters));

    const total = countResult?.count ?? 0;

    const rawData = await db.select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
      title: leads.title,
      companyName: leads.companyName,
      companyId: leads.companyId,
      leadStatus: leads.leadStatus,
      leadSource: leads.source,
      score: leads.score,
      value: leads.value,
      budget: leads.budget,
      assignedTo: leads.assignedTo,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      tags: leads.tags,
      country: leads.country,
      city: leads.city,
      lifecycleStage: leads.lifecycleStage,
      authorityLevel: leads.authorityLevel,
      contactId: leads.contactId,
      assignedName: users.fullName,
      assignedAvatar: users.avatarUrl,
      companyDisplayName: companies.name
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(companies, eq(companies.id, leads.companyId))
    .where(and(...filters))
    .orderBy(sortOrder === sql`ASC` ? sortByColumn : desc(sortByColumn))
    .limit(limit)
    .offset(offset);

    // Map camelCase to snake_case for frontend compatibility
    const data = rawData.map(lead => ({
      id: lead.id,
      first_name: lead.firstName,
      last_name: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      title: lead.title,
      company_name: lead.companyName,
      company_id: lead.companyId,
      lead_status: lead.leadStatus,
      lead_source: lead.leadSource,
      score: lead.score,
      value: lead.value,
      budget: lead.budget,
      assigned_to: lead.assignedTo,
      created_at: lead.createdAt,
      updated_at: lead.updatedAt,
      tags: lead.tags,
      country: lead.country,
      city: lead.city,
      lifecycle_stage: lead.lifecycleStage,
      authority_level: lead.authorityLevel,
      contact_id: lead.contactId,
      assigned_name: lead.assignedName,
      assigned_avatar: lead.assignedAvatar,
      company_display_name: lead.companyDisplayName,
    }));

    return NextResponse.json({
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[leads GET]', error);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}

// POST /api/tenant/leads - Create a new lead
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'leads.create');
    if (deny) return deny;

    const limited = await checkRateLimit(request, { action: 'leads_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const overLimit = await checkLimit(ctx, 'leads');
    if (overLimit) return overLimit;

    const body = await readJsonBody(request);
    const validated = validateBody(createLeadSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    if (v.email) {
      const [existing] = await db.select()
        .from(leads)
        .where(and(
          eq(leads.tenantId, ctx.tenantId),
          sql`lower(${leads.email}) = lower(${v.email})`,
          isNull(leads.deletedAt)
        ))
        .limit(1);

      if (existing) {
        return NextResponse.json(
          { error: 'A lead with this email already exists', is_duplicate: true, duplicate_id: existing.id, duplicate: existing },
          { status: 409 }
        );
      }
    }

    // ── Workflow: every lead is attached to a contact at intake (one contact, many leads) ──
    const newLead = await db.transaction(async (tx) => {
      let contactId: string;
      let companyId: string | null = null;
      let isNewContact = false;

      if (v.contact_id) {
        // User explicitly linked an existing contact
        contactId = v.contact_id;
        // Pull the company from the existing contact
        const [existingContact] = await db.select({ companyId: contacts.companyId })
          .from(contacts)
          .where(and(
            eq(contacts.id, v.contact_id),
            eq(contacts.tenantId, ctx.tenantId),
          ))
          .limit(1);
        companyId = existingContact?.companyId ?? null;
      } else {
        // Resolve-or-create the contact for this lead (email dedup).
        const resolve = await resolveOrCreateContactForLead(tx, ctx.tenantId, ctx.userId, {
          firstName: v.first_name,
          lastName: v.last_name,
          email: v.email,
          phone: v.phone,
          title: v.job_title,
          // An existing company id wins; otherwise the name is resolved-or-created.
          companyId: v.company_id || null,
          companyName: v.company,
          source: v.source,
          score: v.score,
          assignedTo: v.assigned_to || ctx.userId,
        });
        contactId = resolve.contactId;
        companyId = resolve.companyId;
        isNewContact = resolve.isNewContact;
      }

      // Generate human-readable lead OID (per tenant, per year)
      const leadOid = await generateLeadOid(tx, ctx.tenantId);

      // If the caller named an assignee, honour it. Otherwise start with the
      // creator and let the assignment engine (if a rule is configured) decide.
      const explicitAssignee =
        v.assigned_to && String(v.assigned_to).trim() ? String(v.assigned_to) : null;

      const [inserted] = await tx.insert(leads)
        .values({
          tenantId: ctx.tenantId,
          firstName: v.first_name,
          lastName: v.last_name || '',
          email: (v.email ?? '').toLowerCase(),
          phone: v.phone || null,
          title: v.job_title || null,
          companyName: v.company || null,
          companyId,
          source: v.source || 'website',
          leadStatus: v.status,
          score: v.score,
          country: null,
          state: null,
          city: null,
          address: null,
          postalCode: null,
          website: null,
          assignedTo: explicitAssignee || ctx.userId,
          createdBy: ctx.userId,
          tags: [],
          internalNotes: null,
          notes: v.notes || null,
          value: v.value != null ? String(v.value) : null,
          customFields: v.custom_fields,
          contactId,
          leadOid,
          productId: (v as { product_id?: string }).product_id || null,
          requestedProductId: v.requested_product_id || null,
          requestedServiceId: v.requested_service_id || null,
        })
        .returning();

      if (!inserted) throw new Error('Failed to create lead');

      // WF-03: run the auto-assignment engine only when the caller did not pick
      // an assignee. resolveAssignee never throws — a null result means "no rule
      // decided", and the creator (already set above) stands.
      if (!explicitAssignee) {
        const resolved = await resolveAssignee(tx, {
          tenantId: ctx.tenantId,
          entityType: 'lead',
          entityId: inserted.id,
          context: { location: null, skills: inserted.tags ?? null },
        });
        if (resolved && resolved.assignedTo !== inserted.assignedTo) {
          await tx.update(leads)
            .set({ assignedTo: resolved.assignedTo })
            .where(eq(leads.id, inserted.id));
          inserted.assignedTo = resolved.assignedTo;
        }
      }

      // Lead activity (legacy table for the lead detail page)
      await tx.insert(leadActivities).values({
        tenantId: ctx.tenantId,
        leadId: inserted.id,
        performedBy: ctx.userId,
        activityType: 'created',
        description: 'Lead created',
        activityData: { lead_oid: leadOid, contact_id: contactId, is_new_contact: isNewContact },
      });

      // Unified activities row so the lead shows up on the contact's system-events timeline
      await tx.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: contactId,
        entityType: 'lead',
        entityId: inserted.id,
        eventType: 'lead_created',
        action: 'create',
        description: `Lead ${leadOid} created${isNewContact ? ' (new contact)' : ' (linked to existing contact)'}`,
        metadata: { lead_oid: leadOid, lead_status: v.status, lead_source: v.source ?? 'website' },
      });

      return inserted;
    });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create', entityType: 'lead', entityId: newLead.id,
      newData: { email: v.email, name: `${v.first_name} ${v.last_name ?? ''}`.trim() },
    });

    // Notify whoever ended up with the lead — whether the caller named them or
    // the assignment engine routed it — as long as it is not the creator.
    if (newLead.assignedTo && newLead.assignedTo !== ctx.userId) {
      createNotification({
        userId: newLead.assignedTo,
        tenantId: ctx.tenantId,
        type: 'contact_assigned',
        title: `New lead assigned: ${v.first_name} ${v.last_name ?? ''}`.trim(),
        entity_type: 'lead',
        entity_id: newLead.id,
        link: `/tenant/leads/${newLead.id}`,
      }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    fireWebhooks(ctx.tenantId, 'lead.created', { id: newLead.id, email: v.email }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: newLead }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[leads POST]', error);
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
  }
}
