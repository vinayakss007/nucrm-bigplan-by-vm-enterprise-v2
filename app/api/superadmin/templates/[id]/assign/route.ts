/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { safeApiError } from '@/lib/api-error';
import { z } from 'zod';
import { uuidIdSchema } from '@/lib/validation/uuid';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { productTemplates, tenantTemplates } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { installTemplateModules } from '@/lib/modules/auto-install';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { resolveTemplate } from '@/lib/templates/resolve';
import { applyTemplate } from '@/lib/templates/apply-template';
import { setTenantContext } from '@/lib/db/rls';

const assignSchema = z.object({
  tenant_id: uuidIdSchema,
});

// POST /api/superadmin/templates/[id]/assign — #2633: assigning a template now
// REALLY materializes it in the tenant (fields/pipelines/stages/automations),
// idempotently. Before this, the route only wrote the tenant_templates ledger,
// so the superadmin "assign" button was decoration. Re-assigning the same
// template returns 200 with a fresh report instead of 409.
export const POST = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(req);
    const validated = validateBody(assignSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const template = await resolveTemplate(id);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const { assignment, created, report } = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: tenantTemplates.id })
        .from(tenantTemplates)
        .where(and(
          eq(tenantTemplates.tenantId, v.tenant_id),
          eq(tenantTemplates.templateId, template.id),
          isNull(tenantTemplates.deletedAt),
        ))
        .limit(1);

      // Tenant-table writes (pipelines/deal_stages/…) read app.current_tenant,
      // which for this request is the superadmin's own tenant. Pin the target
      // tenant for the rest of this transaction; is_super_admin stays set, so
      // registry-side writes (tenant_templates ledger, tenant_count) still pass.
      await setTenantContext(v.tenant_id, ctx.userId, tx);

      const rep = await applyTemplate({
        tenantId: v.tenant_id,
        actorUserId: ctx.userId,
        blueprint: template,
        tx,
      });

      if (existing) return { assignment: existing, created: false, report: rep };

      const [row] = await tx
        .insert(tenantTemplates)
        .values({
          tenantId: v.tenant_id,
          templateId: template.id,
          appliedBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: tenantTemplates.id });

      // Only bump tenant_count when the ledger row is genuinely new —
      // re-assignment must not inflate it.
      if (row) {
        await tx
          .update(productTemplates)
          .set({ tenantCount: sql`${productTemplates.tenantCount} + 1` })
          .where(eq(productTemplates.id, template.id));
      }

      return { assignment: row ?? existing, created: !!row, report: rep };
    });

    // Module registry rows: best-effort, mirrors pre-#2633 behaviour but now
    // resolves modules from the DB template (slug first, id fallback).
    await installTemplateModules(v.tenant_id, template.slug ?? template.id).catch(() => ({ installed: 0, failed: [] }));

    return NextResponse.json(
      { data: assignment ? { ...assignment, template_id: template.id, tenant_id: v.tenant_id } : null, created, report },
      { status: created ? 201 : 200 },
    );
  } catch (err: unknown) {
    await logError({ error: err, context: 'superadmin/templates/[id]/assign POST', requestMethod: 'POST' });
    return safeApiError(err); // #2527
  }
});
