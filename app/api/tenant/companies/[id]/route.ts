/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateCompanySchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { companies, contacts } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { logError } from '@/lib/errors-server';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const id = (await params).id;

    // Subquery for contact count
    const _contactCountQuery = db.select({
      count: sql<number>`count(*)::int`.as('count')
    })
    .from(contacts)
    .where(and(
      eq(contacts.companyId, id),
      isNull(contacts.deletedAt)
    ))
    .as('cc');

    const row = await db.query.companies.findFirst({
      where: and(
        eq(companies.id, id),
        eq(companies.tenantId, ctx.tenantId),
        isNull(companies.deletedAt)
      ),
      extras: {
        contactCount: sql<number>`(SELECT count(*)::int FROM contacts WHERE company_id = companies.id AND deleted_at IS NULL)`.as('contact_count')
      }
    });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    console.error('[company GET]', err);
    return apiError(err); 
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(req: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(req, 'companies', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'companies.edit');
    if (deny) return deny;

    const id = (await params).id;
    const body = await readJsonBody(req);
    const validated = validateBody(updateCompanySchema, body);
    if (validated instanceof NextResponse) return validated;

    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (v.name !== undefined) updateData.name = v.name.trim().slice(0, 200);
    if (v.domain !== undefined) updateData.domain = v.domain;
    if (v.industry !== undefined) updateData.industry = v.industry;
    if (v.size !== undefined) updateData.companySize = v.size;
    if (v.annual_revenue !== undefined) updateData.annualRevenue = v.annual_revenue == null ? null : String(v.annual_revenue);
    // The companies UI persists/reads the memo as `notes`; API/SDK callers may
    // send `description`. Keep both columns in sync so the user-visible Notes
    // field (detail page, edit form, list, CSV export) is never silently
    // dropped when only one key is supplied.
    if (v.description !== undefined) {
      updateData.description = v.description;
      if (v.notes === undefined) updateData.notes = v.description;
    }
    if (v.notes !== undefined) {
      updateData.notes = v.notes;
      if (v.description === undefined) updateData.description = v.notes;
    }
    if (v.website !== undefined) updateData.website = v.website;
    if (v.phone !== undefined) updateData.phone = v.phone;
    if (v.billing_address !== undefined) updateData.address = v.billing_address;
    if (v.city !== undefined) updateData.city = v.city;
    if (v.state !== undefined) updateData.state = v.state;
    if (v.country !== undefined) updateData.country = v.country;
    if (v.postal_code !== undefined) updateData.postalCode = v.postal_code;
    if (v.linkedin_url !== undefined) updateData.linkedinUrl = v.linkedin_url;
    if (v.twitter_url !== undefined) updateData.twitterUrl = v.twitter_url;
    if (v.facebook_url !== undefined) updateData.facebookUrl = v.facebook_url;
    if (v.tags !== undefined) updateData.tags = v.tags;
    if (v.custom_fields !== undefined) updateData.customFields = v.custom_fields;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, companies, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db.update(companies)
      .set(updateData)
      .where(and(
        eq(companies.id, id),
        eq(companies.tenantId, ctx.tenantId),
        isNull(companies.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({ 
      tenantId: ctx.tenantId, 
      userId: ctx.userId, 
      action: 'update', 
      entityType: 'company', 
      entityId: id 
    });

    fireWebhooks(ctx.tenantId, 'company.updated', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    console.error('[company PATCH]', err);
    return apiError(err); 
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(req, 'companies', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'companies.delete');
    if (deny) return deny;

    const id = (await params).id;

    const [row] = await db.update(companies)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(companies.id, id),
        eq(companies.tenantId, ctx.tenantId),
        isNull(companies.deletedAt)
      ))
      .returning({ id: companies.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({ 
      tenantId: ctx.tenantId, 
      userId: ctx.userId, 
      action: 'delete', 
      entityType: 'company', 
      entityId: id 
    });

    fireWebhooks(ctx.tenantId, 'company.deleted', { id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    console.error('[company DELETE]', err);
    return apiError(err); 
  }
}
