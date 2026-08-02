import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { productTemplates } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const [template] = await db
      .select()
      .from(productTemplates)
      .where(and(eq(productTemplates.id, id), sql`${productTemplates.deletedAt} IS NULL`));

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ data: template });
  } catch (err: unknown) {
    console.error('[superadmin/templates/[id] GET]', err);
    return apiError(err);
  }
}

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  modules: z.array(z.string()).optional(),
  custom_fields: z.array(z.record(z.string(), z.unknown())).optional(),
  pipelines: z.array(z.record(z.string(), z.unknown())).optional(),
  automations: z.array(z.record(z.string(), z.unknown())).optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  is_builtin: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(req);
    const validated = validateBody(updateTemplateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updates: Record<string, unknown> = {};
    if (v.name !== undefined) updates['name'] = v.name;
    if (v.slug !== undefined) updates['slug'] = v.slug;
    if (v.description !== undefined) updates['description'] = v.description;
    if (v.icon !== undefined) updates['icon'] = v.icon;
    if (v.modules !== undefined) updates['modules'] = v.modules;
    if (v.custom_fields !== undefined) updates['customFields'] = v.custom_fields;
    if (v.pipelines !== undefined) updates['pipelines'] = v.pipelines;
    if (v.automations !== undefined) updates['automations'] = v.automations;
    if (v.status !== undefined) updates['status'] = v.status;
    if (v.is_builtin !== undefined) updates['isBuiltin'] = v.is_builtin;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    updates['updatedAt'] = new Date();

    const [existing] = await db
      .select({ updatedAt: productTemplates.updatedAt })
      .from(productTemplates)
      .where(and(eq(productTemplates.id, id), sql`${productTemplates.deletedAt} IS NULL`))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const [updated] = await db
      .update(productTemplates)
      .set(updates)
      .where(and(eq(productTemplates.id, id), sql`${productTemplates.deletedAt} IS NULL`, eq(productTemplates.updatedAt, existing.updatedAt!)))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Template was modified by another user — please refresh' }, { status: 409 });

    return NextResponse.json({ data: updated });
  } catch (err: unknown) {
    console.error('[superadmin/templates/[id] PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    const [archived] = await db
      .update(productTemplates)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(and(eq(productTemplates.id, id), sql`${productTemplates.deletedAt} IS NULL`))
      .returning();

    if (!archived) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[superadmin/templates/[id] DELETE]', err);
    return apiError(err);
  }
}
