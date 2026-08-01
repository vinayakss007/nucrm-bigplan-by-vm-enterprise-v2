import { fireWebhooks } from '@/lib/webhooks';
import { apiError } from '@/lib/api-error';
import { validateBody, validateQuery, readJsonBody } from '@/lib/api/validate';
import { createContactSchema, contactQuerySchema } from '@/lib/api/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { checkLimit } from '@/lib/usage/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, users, tenants, activities } from '@/drizzle/schema';
import { eq, and, or, desc, sql, ilike, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/errors-server';
import { invalidateWidgetCache } from '@/lib/dashboard/widget-cache';
import { cache } from '@/lib/cache';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canViewAll(ctx: any) {
  return ctx.isAdmin || ctx.permissions?.['all'] || ctx.permissions?.['contacts.view_all'];
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const query = validateQuery(contactQuerySchema, {
      offset: searchParams.get('offset') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      lead_status: searchParams.get('lead_status') ?? undefined,
      company_id: searchParams.get('company_id') ?? undefined,
    });
    if (query instanceof NextResponse) return query;
    const { offset, limit, q, company_id } = query.data;
    const leadStatus = searchParams.get('lead_status');

    const filters = [
      eq(contacts.tenantId, ctx.tenantId),
      eq(contacts.isArchived, false),
      isNull(contacts.deletedAt),
    ];

    if (!canViewAll(ctx)) {
      filters.push(or(eq(contacts.assignedTo, ctx.userId), eq(contacts.createdBy, ctx.userId))!);
    }

    if (leadStatus) filters.push(eq(contacts.leadStatus, leadStatus));
    if (company_id) filters.push(eq(contacts.companyId, company_id));

    if (q) {
      const escapedQ = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
      filters.push(or(
        ilike(contacts.firstName, `%${escapedQ}%`),
        ilike(contacts.lastName, `%${escapedQ}%`),
        ilike(contacts.email, `%${escapedQ}%`),
        ilike(contacts.phone, `%${escapedQ}%`),
        ilike(companies.name, `%${escapedQ}%`)
      )!);
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(...filters));

    const data = await db.select({
      id: contacts.id,
      tenantId: contacts.tenantId,
      companyId: contacts.companyId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      jobTitle: contacts.jobTitle,
      leadStatus: contacts.leadStatus,
      leadSource: contacts.leadSource,
      score: contacts.score,
      city: contacts.city,
      country: contacts.country,
      tags: contacts.tags,
      customFields: contacts.customFields,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      companyName: companies.name,
      assignedName: users.fullName,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .leftJoin(users, eq(users.id, contacts.assignedTo))
    .where(and(...filters))
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset);

    const response = { data, total: countResult?.count ?? 0, offset, limit };
    const cacheKey = `tenant:${ctx.tenantId}:contacts:${searchParams.toString()}`;
    cache.set(cacheKey, response, 30);
    return NextResponse.json(response);
  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[contacts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, { action:'contacts_create', max:100, windowMinutes:60 });
    if (limited) return limited;

    const deny = requirePerm(ctx, 'contacts.create');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const validated = validateBody(createContactSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Check for duplicate email
    if (v.email) {
      const [existing] = await db.select()
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.email, v.email.toLowerCase()),
            eq(contacts.isArchived, false),
            isNull(contacts.deletedAt)
          )
        )
        .limit(1);

      if (existing) {
        return NextResponse.json({
          error: `A contact with email ${v.email} already exists: ${existing.firstName} ${existing.lastName}`,
          duplicate_id: existing.id,
          is_duplicate: true,
        }, { status: 409 });
      }
    }

    // Plan limit check (records a violation + alerts owner; only blocks when USAGE_LIMITS=on)
    const overLimit = await checkLimit(ctx, 'contacts');
    if (overLimit) return overLimit;

    const contact = await db.transaction(async (tx) => {
      const [c] = await tx.insert(contacts)
        .values({
          tenantId: ctx.tenantId,
          createdBy: ctx.userId,
          assignedTo: v.assigned_to || ctx.userId,
          firstName: v.first_name,
          lastName: v.last_name ?? '',
          email: v.email?.toLowerCase() ?? null,
          phone: v.phone ?? null,
          jobTitle: v.job_title ?? v.title ?? null,
          companyId: v.company_id || null,
          leadStatus: v.lead_status ?? 'new',
          leadSource: v.lead_source ?? null,
          notes: v.notes?.slice(0, 5000) ?? null,
          tags: v.tags,
          score: v.score,
          city: v.city ?? null,
          country: v.country ?? null,
          website: v.website ?? null,
          linkedinUrl: v.linkedin_url ?? null,
          twitterUrl: v.twitter_url ?? null,
          customFields: v.custom_fields,
        })
        .returning();

      if (!c) throw new Error('Failed to create contact');

      // Activity log
      await tx.insert(activities)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          contactId: c.id,
          entityType: 'contact',
          entityId: c.id,
          eventType: 'contact_created',
          action: 'create',
          description: `Created contact ${c.firstName} ${c.lastName}`.trim(),
        })
        .catch(err => console.error('[contacts POST] activity log failed:', err));

      // Increment contact counter
      await tx.update(tenants)
        .set({ currentContacts: sql`${tenants.currentContacts} + 1` })
        .where(eq(tenants.id, ctx.tenantId))
        .catch((err) => logError({ error: err, context: "async-catch:[context]" }));

      return c;
    });

    if (!contact) throw new Error('Failed to create contact');

    // Audit log
    await logAudit({ 
      tenantId: ctx.tenantId, 
      userId: ctx.userId, 
      action:'create', 
      entityType:'contact', 
      entityId: contact.id, 
      newData: { email: v.email, name: `${v.first_name} ${v.last_name}` } 
    });

    await fireWebhooks(ctx.tenantId, 'contact.created', { 
      id: contact.id, 
      email: v.email, 
      name: `${v.first_name} ${v.last_name}` 
    });

    // Invalidate dashboard widget caches
    invalidateWidgetCache(ctx.tenantId, 'stats-contacts', 'contacts-recent', 'activity');

    // WORKFLOW-C: trigger automation rules (non-blocking)
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    evaluateAutomations({
      tenantId: ctx.tenantId, 
      userId: ctx.userId,
      event: 'contact.created', 
      data: { ...contact },
    }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: contact }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[contacts POST]', err);
    return apiError(err, "Internal server error", 500);
  }
}
