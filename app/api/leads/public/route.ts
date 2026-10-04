/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { logError } from '@/lib/errors-server';
import { escapeLike } from '@/lib/api/sanitize-like';
/**
 * Public lead capture endpoint — no auth required.
 * Accepts leads from embedded forms, landing pages, etc.
 * Requires tenant_id or api_key to route the lead to the correct org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { leads, tenants, plans, companies, leadActivities, forms, formSubmissions, contacts } from '@/drizzle/schema';
import { eq, and, sql, ilike, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { isEntityId } from '@/lib/id';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const leadSubmitSchema = z.object({
  first_name: z.string().max(200).optional().default(''),
  last_name: z.string().max(200).optional().default(''),
  email: z.string().email('Invalid email address').max(320),
  phone: z.string().max(50).optional().default(''),
  company: z.string().max(200).optional().default(''),
  message: z.string().max(10000).optional().default(''),
  source: z.string().max(200).optional().default('Website Form'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  form_id: z.string().optional().default(''),
  tags: z.array(z.string().max(100)).max(20).optional().default([]),
});

function escapeHtmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 20 lead submissions per IP per hour
    const limited = await checkRateLimit(request, { action: 'public_lead', max: 20, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(leadSubmitSchema, body);
    if (validated instanceof NextResponse) return validated;
    const {
      first_name,
      last_name,
      email,
      phone,
      company,
      message,
      source,
      tenant_id,
      form_id,
      tags,
    } = validated.data;

    const safeFirst = escapeHtmlEntities(first_name);
    const safeLast = escapeHtmlEntities(last_name);
    const safeCompany = escapeHtmlEntities(company);
    const safeMessage = escapeHtmlEntities(message);
    const safeSource = escapeHtmlEntities(source);

    // Verify tenant exists and is active
    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.id, tenant_id),
        sql`${tenants.status} IN ('active', 'trialing')`
      ),
      columns: { id: true, name: true, ownerId: true }
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Invalid or inactive organization' }, { status: 404 });
    }

    // #2334: `form_id` is caller-supplied on an UNAUTHENTICATED endpoint and was
    // never validated two ways. (a) Shape: a non-uuid reached `eq(forms.id, …)`
    // and Postgres answered `22P02 invalid input syntax for type uuid`, which
    // surfaced as a 500 — the same class closed for /api/forms/submit in #2288.
    // (b) Ownership: nothing proved the form belongs to THIS tenant, is active,
    // or is not soft-deleted, so `forms.submissions_count` could be bumped on
    // any foreign form and a submission row could be stamped with a form id from
    // another workspace (the form FK is global, so Postgres accepts the pair).
    // Ownership is checked BEFORE any write for that reason.
    let formTenantId: string | null = null;
    if (form_id) {
      if (!isEntityId(form_id)) {
        return NextResponse.json({ error: 'Invalid form id' }, { status: 400 });
      }
      const form = await db.query.forms.findFirst({
        where: and(
          eq(forms.id, form_id),
          eq(forms.tenantId, tenant_id),
          eq(forms.isActive, true),
          isNull(forms.deletedAt),
        ),
        columns: { id: true, tenantId: true },
      });
      if (!form) {
        return NextResponse.json({ error: 'Invalid or inactive form' }, { status: 404 });
      }
      formTenantId = form.tenantId;
    }

    // Check contact limit before inserting
    const limitCheck = await db
      .select({ 
        currentContacts: tenants.currentContacts,
        maxContacts: plans.maxContacts
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, tenant_id))
      .then(res => res[0]);

    if (limitCheck && limitCheck.maxContacts != null && limitCheck.maxContacts > 0 && (limitCheck.currentContacts || 0) >= limitCheck.maxContacts) {
      // Still return success to the visitor, just don't insert
      return NextResponse.json({ ok: true, message: 'Thank you! We will be in touch.' });
    }

    // Look up or create company
    let company_id: string | null = null;
    if (safeCompany.trim()) {
      const existingCo = await db.query.companies.findFirst({
        where: and(
          eq(companies.tenantId, tenant_id),
          ilike(companies.name, escapeLike(safeCompany.trim()))
        ),
        columns: { id: true }
      });

      if (existingCo) {
        company_id = existingCo.id;
      } else {
        const [newCo] = await db.insert(companies).values({
          tenantId: tenant_id,
          name: safeCompany.trim(),
        }).returning({ id: companies.id });
        company_id = newCo?.id ?? null;
      }
    }

    // #1061: the duplicate-email check and the insert must be atomic, or two
    // concurrent submissions with the same email both pass the check and
    // create duplicate leads. There is no unique constraint on
    // (tenant_id, lower(email)), so we serialize per (tenant, email) using a
    // transaction-scoped Postgres advisory lock, then re-check inside the tx.
    const normalizedEmail = email.trim().toLowerCase();
    // #1142: this holds a LEAD id (leads.id) throughout — the public capture
    // endpoint creates/updates a lead, not a contact. Named accordingly.
    let leadId!: string;

    await db.transaction(async (tx) => {
      // Serialize concurrent submissions for the same (tenant, email). The lock
      // is held until the transaction commits/rolls back.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenant_id} || ':' || ${normalizedEmail}, 0))`
      );

      const existingLead = await tx.query.leads.findFirst({
        where: and(
          eq(leads.tenantId, tenant_id),
          eq(sql`lower(${leads.email})`, normalizedEmail),
          isNull(leads.deletedAt)
        ),
        columns: { id: true, tags: true, leadStatus: true, formSubmissionsCount: true }
      });

      // #2334: recorded inside the capture transaction — for a NEW lead and for
      // a repeat submission — so a submission that cannot be written does not
      // leave a half-captured lead behind, and the counter bump carries the
      // tenant predicate.
      //
      // `contactId` is deliberately NOT set to `leadId` any more. That column
      // has FK `form_submissions.contact_id -> contacts.id` (validated on the
      // live DB), while `leadId` names a row in `leads` — so every submission
      // this endpoint ever attempted died in 23503 and the visitor got a 500.
      // The lead side already carries the link (`leads.formId`), and
      // `contact_id` is nullable by design (#1053).
      const recordFormSubmission = async () => {
        if (!form_id || !formTenantId) return;
        await tx.insert(formSubmissions).values({
          tenantId: formTenantId,
          formId: form_id,
          data: { first_name: safeFirst, last_name: safeLast, email: normalizedEmail, phone: phone.trim(), company: safeCompany, message: safeMessage, source: safeSource },
        });

        await tx.update(forms)
          .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
          .where(and(eq(forms.id, form_id), eq(forms.tenantId, formTenantId)));
      };

      if (existingLead) {
        // Re-activate and update existing lead
        const newTags = Array.isArray(tags) ? tags : [];
        const currentTags = existingLead.tags || [];
        const combinedTags = Array.from(new Set([...currentTags, ...newTags]));

        const [updated] = await tx.update(leads)
          .set({
            phone: phone.trim() || undefined,
            companyName: safeCompany.trim() || undefined,
            companyId: company_id || undefined,
            leadStatus: ['lost', 'unqualified'].includes(existingLead.leadStatus || '') ? 'new' : undefined,
            tags: combinedTags,
            formSubmissionsCount: (existingLead.formSubmissionsCount || 0) + 1,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(leads.id, existingLead.id))
          .returning({ id: leads.id });

        leadId = updated?.id ?? existingLead.id;
        await recordFormSubmission();
        return;
      }

      const [newLead] = await tx.insert(leads).values({
        tenantId: tenant_id,
        firstName: safeFirst,
        lastName: safeLast,
        email: normalizedEmail,
        phone: phone.trim() || null,
        companyName: safeCompany.trim() || null,
        companyId: company_id,
        source: safeSource,
        leadStatus: 'new',
        notes: safeMessage || null,
        formId: form_id || null,
        tags: Array.isArray(tags) ? tags : [],
        formSubmissionsCount: 1,
        lastActivityAt: new Date(),
      }).returning({ id: leads.id });

      if (!newLead) throw new Error('Failed to create lead');
      leadId = newLead.id;

      await tx.insert(leadActivities).values({
        tenantId: tenant_id,
        leadId: leadId,
        activityType: 'created',
        description: `Lead captured via ${safeSource}${form_id ? ` (form: ${form_id})` : ''}`,
      });

      await recordFormSubmission();
    });

    // Notify workspace owner about new lead
    if (tenant.ownerId && leadId) {
      await createNotification({
        userId: tenant.ownerId,
        tenantId: tenant_id,
        type: 'contact_assigned',
        title: `New lead: ${safeFirst || ''} ${safeLast || email}`.trim(),
        body: `Via ${safeSource}${safeMessage ? ` — "${safeMessage.slice(0, 80)}"` : ''}`,
        link: `/tenant/leads/${leadId}`,
      }).catch((err) => logError({ error: err, context: 'leads/public async side-effect' }));
    }

    // Fire webhooks
    await fireWebhooks(tenant_id, 'contact.created', { // lead captured
      id: leadId, 
      email: email.trim(),
      name: `${safeFirst || ''} ${safeLast || ''}`.trim(),
      source: safeSource,
    }).catch((err) => logError({ error: err, context: 'leads/public async side-effect' }));

    return NextResponse.json({
      ok: true,
      lead_id: leadId,
      message: 'Thank you! We will be in touch.',
    }, { status: 201 });

 
 
  } catch (err) {
    logError({ error: err, context: 'leads/public' }).catch((err) => logError({ error: err, context: 'leads/public async side-effect' }));
    // Internal errors must NOT fake success (#1109): the caller's data was not
    // saved, so report failure. Anti-enumeration masking only applies to
    // validation-style checks (e.g. GET email-existence below), never to
    // internal server errors.
    return NextResponse.json(
      { ok: false, error: 'Something went wrong. Please try again later.' },
      { status: 500 }
    );
  }
}

// GET — check if an email already exists in a workspace (for form validation)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase();
    const tenant_id = searchParams.get('tenant_id');

    if (!email || !tenant_id) {
      return NextResponse.json({ exists: false });
    }

    const contact = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.tenantId, tenant_id),
        eq(sql`lower(${contacts.email})`, email),
        eq(contacts.isArchived, false)
      ),
      columns: { id: true }
    });

    return NextResponse.json({ exists: !!contact });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
