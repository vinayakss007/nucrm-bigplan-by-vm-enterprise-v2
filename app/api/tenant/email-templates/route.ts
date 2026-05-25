/**
 * GET  /api/tenant/email-templates        — list all templates
 * POST /api/tenant/email-templates        — create a template
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createEmailTemplateSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { emailTemplates } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const data = await db.select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      subject: emailTemplates.subject,
      bodyHtml: emailTemplates.bodyHtml,
      category: emailTemplates.category,
      createdAt: emailTemplates.createdAt,
      updatedAt: emailTemplates.updatedAt,
    })
    .from(emailTemplates)
    .where(and(
      eq(emailTemplates.tenantId, ctx.tenantId),
      isNull(emailTemplates.deletedAt)
    ))
    .orderBy(asc(emailTemplates.category), asc(emailTemplates.name));

    return NextResponse.json({ data });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const raw = await request.json();
    const validated = validateBody(createEmailTemplateSchema, raw);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(emailTemplates).values({
      tenantId: ctx.tenantId,
      name: v.name,
      subject: v.subject,
      bodyHtml: v.body,
      category: v.category || 'general',
      createdBy: ctx.userId,
    } as any).returning({
      id: emailTemplates.id,
      name: emailTemplates.name,
      subject: emailTemplates.subject,
      bodyHtml: emailTemplates.bodyHtml,
      category: emailTemplates.category,
      createdAt: emailTemplates.createdAt,
      updatedAt: emailTemplates.updatedAt,
    });

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}
