import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { productTemplates } from '@/drizzle/schema';
import { eq, desc, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const templates = await db
      .select()
      .from(productTemplates)
      .where(sql`${productTemplates.deletedAt} IS NULL`)
      .orderBy(desc(productTemplates.createdAt));

    return NextResponse.json({ data: templates });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[superadmin/templates GET]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  modules: z.array(z.string()).default([]),
  custom_fields: z.array(z.record(z.string(), z.unknown())).default([]),
  pipelines: z.array(z.record(z.string(), z.unknown())).default([]),
  automations: z.array(z.record(z.string(), z.unknown())).default([]),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(createTemplateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const slug = v.slug || v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const [template] = await db
      .insert(productTemplates)
      .values({
        name: v.name,
        slug,
        description: v.description ?? null,
        icon: v.icon ?? null,
        modules: v.modules,
        customFields: v.custom_fields,
        pipelines: v.pipelines,
        automations: v.automations,
        status: v.status,
        createdBy: ctx.userId,
      })
      .returning();

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[superadmin/templates POST]', err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'A template with that slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
