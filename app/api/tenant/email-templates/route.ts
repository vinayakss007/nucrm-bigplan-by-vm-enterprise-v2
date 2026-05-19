/**
 * GET  /api/tenant/email-templates        — list all templates
 * POST /api/tenant/email-templates        — create a template
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
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

    const { name, subject, body, category = 'general' } = await request.json();
    if (!name?.trim())    return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!subject?.trim()) return NextResponse.json({ error: 'subject is required' }, { status: 400 });
    if (!body?.trim())    return NextResponse.json({ error: 'body is required' }, { status: 400 });

    const [row] = await db.insert(emailTemplates).values({
      tenantId: ctx.tenantId,
      name: name.trim(),
      subject: subject.trim(),
      bodyHtml: body.trim(),
      category: category,
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
