import { logError } from '@/lib/errors';
/**
 * Public lead capture endpoint — no auth required.
 * Accepts leads from embedded forms, landing pages, etc.
 * Requires tenant_id or api_key to route the lead to the correct org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { leads, tenants, plans, companies, leadActivities, forms, formSubmissions, contacts } from '@/drizzle/schema';
import { eq, and, sql, ilike, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 20 lead submissions per IP per hour
    const limited = await checkRateLimit(request, { action: 'public_lead', max: 20, windowMinutes: 60 });
    if (limited) return limited;

    const body = await request.json();
    const {
      first_name,
      last_name,
      email,
      phone,
      company,
      message,
      source = 'Website Form',
      tenant_id,   // required — the org this lead belongs to
      form_id,     // optional — which form captured this lead
      tags = [],   // optional — tags to apply
    } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

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
    if (company?.trim()) {
      const existingCo = await db.query.companies.findFirst({
        where: and(
          eq(companies.tenantId, tenant_id),
          ilike(companies.name, company.trim())
        ),
        columns: { id: true }
      });

      if (existingCo) {
        company_id = existingCo.id;
      } else {
        const [newCo] = await db.insert(companies).values({
          tenantId: tenant_id,
          name: company.trim(),
        }).returning({ id: companies.id });
        company_id = newCo?.id ?? null;
      }
    }

    // Check for duplicate email — upsert into leads table
    const existingLead = await db.query.leads.findFirst({
      where: and(
        eq(leads.tenantId, tenant_id),
        eq(sql`lower(${leads.email})`, email.trim().toLowerCase()),
        isNull(leads.deletedAt)
      ),
      columns: { id: true, tags: true, leadStatus: true, formSubmissionsCount: true }
    });

    let contactId: string;

    if (existingLead) {
      // Re-activate and update existing lead
      const newTags = Array.isArray(tags) ? tags : [];
      const currentTags = existingLead.tags || [];
      const combinedTags = Array.from(new Set([...currentTags, ...newTags]));

      const [updated] = await db.update(leads)
        .set({
          phone: phone?.trim() || undefined,
          companyName: company?.trim() || undefined,
          companyId: company_id || undefined,
          leadStatus: ['lost', 'unqualified'].includes(existingLead.leadStatus || '') ? 'new' : undefined,
          tags: combinedTags,
          formSubmissionsCount: (existingLead.formSubmissionsCount || 0) + 1,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, existingLead.id))
        .returning({ id: leads.id });
      
      contactId = updated?.id ?? existingLead.id;
    } else {
      // Create new lead record
      const [newLead] = await db.insert(leads).values({
        tenantId: tenant_id,
        firstName: first_name?.trim() || '',
        lastName: last_name?.trim() || '',
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        companyName: company?.trim() || null,
        companyId: company_id,
        source: source,
        leadStatus: 'new',
        notes: message?.trim() || null,
        formId: form_id || null,
        tags: Array.isArray(tags) ? tags : [],
        formSubmissionsCount: 1,
        lastActivityAt: new Date(),
      }).returning({ id: leads.id });
      
      if (!newLead) throw new Error('Failed to create lead');
      contactId = newLead.id;

      // Log lead activity
      await db.insert(leadActivities).values({
        tenantId: tenant_id,
        leadId: contactId,
        activityType: 'created',
        description: `Lead captured via ${source}${form_id ? ` (form: ${form_id})` : ''}`,
      }).catch((err) => logError(err, "async-catch:[context]"));
    }

    // Insert into formSubmissions if form_id provided
    if (form_id && contactId) {
      await db.insert(formSubmissions).values({
        tenantId: tenant_id,
        formId: form_id,
        contactId: contactId,
        data: { body },
      }).catch((err) => logError(err, "async-catch:[context]"));

      // Increment form submissions count
      await db.update(forms)
        .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
        .where(eq(forms.id, form_id))
        .catch((err) => logError(err, "async-catch:[context]"));
    }

    // Notify workspace owner about new lead
    if (tenant.ownerId && contactId) {
      await createNotification({
        userId: tenant.ownerId,
        tenantId: tenant_id,
        type: 'contact_assigned',
        title: `New lead: ${first_name || ''} ${last_name || email}`.trim(),
        body: `Via ${source}${message ? ` — "${message.slice(0, 80)}"` : ''}`,
        link: `/tenant/leads/${contactId}`,
      }).catch((err) => logError(err, "async-catch:[context]"));
    }

    // Fire webhooks
    await fireWebhooks(tenant_id, 'contact.created', { // lead captured
      id: contactId, 
      email: email.trim(),
      name: `${first_name || ''} ${last_name || ''}`.trim(),
      source,
    }).catch((err) => logError(err, "async-catch:[context]"));

    return NextResponse.json({
      ok: true,
      lead_id: contactId,
      message: 'Thank you! We will be in touch.',
    }, { status: 201 });

  } catch (err: any) {
    logError({ error: err, context: 'leads/public' }).catch((err) => logError(err, "async-catch:[context]"));
    // Return generic success to visitor even on error
    return NextResponse.json({ ok: true, message: 'Thank you! We will be in touch.' });
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
