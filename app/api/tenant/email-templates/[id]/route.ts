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
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const { name, subject, body, category } = await request.json();

    const updateData: any = { updatedAt: new Date() };
    if (name     !== undefined) updateData.name = name.trim();
    if (subject  !== undefined) updateData.subject = subject.trim();
    if (body     !== undefined) updateData.bodyHtml = body.trim();
    if (category !== undefined) updateData.category = category;

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
  } catch (err: any) {
    return apiError(err);
  }
}

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
  } catch (err: any) {
    return apiError(err);
  }
}
