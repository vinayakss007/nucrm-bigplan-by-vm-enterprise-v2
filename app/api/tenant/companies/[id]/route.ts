import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateCompanySchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { companies, contacts } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const id = (await params).id;

    // Subquery for contact count
    const contactCountQuery = db.select({
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
  } catch (err: any) { 
    console.error('[company GET]', err);
    return apiError(err); 
  }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'companies.edit');
    if (deny) return deny;

    const id = (await params).id;
    const body = await req.json();
    const validated = validateBody(updateCompanySchema, body);
    if (validated instanceof NextResponse) return validated;

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData.name = body.name.trim().slice(0, 200);
    if (body.industry !== undefined) updateData.industry = body.industry;
    if (body.company_size !== undefined) updateData.companySize = body.company_size;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.custom_fields !== undefined) updateData.customFields = body.custom_fields;

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
  } catch (err: any) { 
    console.error('[company PATCH]', err);
    return apiError(err); 
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'companies.delete');
    if (deny) return deny;

    const id = (await params).id;

    const [row] = await db.update(companies)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId 
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
  } catch (err: any) { 
    console.error('[company DELETE]', err);
    return apiError(err); 
  }
}
