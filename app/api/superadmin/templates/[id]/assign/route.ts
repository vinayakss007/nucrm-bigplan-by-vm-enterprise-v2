import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { productTemplates, tenantTemplates } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { installTemplateModules } from '@/lib/modules/auto-install';

const assignSchema = z.object({
  tenant_id: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const validated = validateBody(assignSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Verify template exists
    const [template] = await db
      .select()
      .from(productTemplates)
      .where(and(eq(productTemplates.id, id), sql`${productTemplates.deletedAt} IS NULL`));

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Create assignment record
    const [assignment] = await db
      .insert(tenantTemplates)
      .values({
        tenantId: v.tenant_id,
        templateId: id,
        appliedBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning();

    if (!assignment) {
      return NextResponse.json({ error: 'Template already assigned to this tenant' }, { status: 409 });
    }

    // Increment tenant_count
    await db
      .update(productTemplates)
      .set({ tenantCount: sql`${productTemplates.tenantCount} + 1` })
      .where(eq(productTemplates.id, id));

    // Install template modules for the tenant if modules are defined
    const templateModules = template.modules as string[] | null;
    if (templateModules && templateModules.length > 0 && template.slug) {
      await installTemplateModules(v.tenant_id, template.slug);
    }

    return NextResponse.json({ data: assignment }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[superadmin/templates/[id]/assign POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
