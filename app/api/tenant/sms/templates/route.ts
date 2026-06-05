import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { smsTemplates } from '@/drizzle/schema/sms';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { extractTemplateVariables } from '@/lib/sms';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  body: z.string().min(1).max(1600),
});

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(1600).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const data = await db.select()
      .from(smsTemplates)
      .where(and(
        eq(smsTemplates.tenantId, ctx.tenantId),
        isNull(smsTemplates.deletedAt)
      ))
      .orderBy(desc(smsTemplates.createdAt));

    return NextResponse.json({ data });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const validated = validateBody(createTemplateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const variables = extractTemplateVariables(v.body);

    const [template] = await db.insert(smsTemplates).values({
      tenantId: ctx.tenantId,
      name: v.name,
      body: v.body,
      variables,
    }).returning();

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const validated = validateBody(updateTemplateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updates: Record<string, unknown> = {};
    if (v.name) updates['name'] = v.name;
    if (v.body) {
      updates['body'] = v.body;
      updates['variables'] = extractTemplateVariables(v.body);
    }

    const [updated] = await db.update(smsTemplates)
      .set(updates)
      .where(and(
        eq(smsTemplates.id, v.id),
        eq(smsTemplates.tenantId, ctx.tenantId)
      ))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'whatsapp-bot');
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Soft delete
    const [deleted] = await db.update(smsTemplates)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(smsTemplates.id, id),
        eq(smsTemplates.tenantId, ctx.tenantId)
      ))
      .returning({ id: smsTemplates.id });

    if (!deleted) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: deleted.id, deleted: true } });
  } catch (err) {
    return apiError(err);
  }
}
