/**
 * GET    /api/tenant/email-templates/[id]  — get one template
 * PATCH  /api/tenant/email-templates/[id]  — update a template
 * DELETE /api/tenant/email-templates/[id]  — soft-delete a template
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { emailTemplates } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { updateEmailTemplateSchema } from '@/lib/api/schemas';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const row = await db.query.emailTemplates.findFirst({
      where: and(
        eq(emailTemplates.id, id),
        eq(emailTemplates.tenantId, ctx.tenantId),
        isNull(emailTemplates.deletedAt)
      ),
      columns: {
        id: true,
        name: true,
        subject: true,
        bodyHtml: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const rawBody = await request.json();
    const validated = validateBody(updateEmailTemplateSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { updatedAt: new Date() };
    if (v.name     !== undefined) updateData.name = v.name.trim();
    if (v.subject  !== undefined) updateData.subject = v.subject.trim();
    if (v.body     !== undefined) updateData.bodyHtml = v.body.trim();
    if (v.category !== undefined) updateData.category = v.category;

    if (Object.keys(updateData).length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const [row] = await db.update(emailTemplates)
      .set(updateData)
      .where(and(
        eq(emailTemplates.id, id),
        eq(emailTemplates.tenantId, ctx.tenantId),
        isNull(emailTemplates.deletedAt)
      ))
      .returning({
        id: emailTemplates.id,
        name: emailTemplates.name,
        subject: emailTemplates.subject,
        bodyHtml: emailTemplates.bodyHtml,
        category: emailTemplates.category,
        updatedAt: emailTemplates.updatedAt,
      });

    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const [row] = await db.update(emailTemplates)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(emailTemplates.id, id),
        eq(emailTemplates.tenantId, ctx.tenantId),
        isNull(emailTemplates.deletedAt)
      ))
      .returning({ id: emailTemplates.id });

    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
