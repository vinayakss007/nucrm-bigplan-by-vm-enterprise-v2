/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { resolveTemplate, listActiveTemplates } from '@/lib/templates/resolve';
import { applyTemplate } from '@/lib/templates/apply-template';

// GET /api/tenant/industry-templates — #2633: DB is the source of truth
// (product_templates, seeded by 0128), so superadmin edits/new templates show up.
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const templates = await listActiveTemplates();
    const data = templates.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      modules: t.modules,
      custom_fields: t.custom_fields ?? [],
      pipelines: t.pipelines ?? [],
      automations: t.automations ?? [],
    }));

    return NextResponse.json({ data });
  } catch (err) {
    await logError({ error: err, context: 'IndustryTemplates GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { templateId } = await readJsonBody(req);
    const template = await resolveTemplate(String(templateId ?? ''));
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Idempotent: re-applying reuses pipelines/stages/automations by name and
    // reports what was created vs already present (#2633 measured 4 pipelines /
    // 20 stages from a double-apply before this existed).
    const report = await db.transaction((tx) => applyTemplate({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      blueprint: template,
      tx,
    }));

    return NextResponse.json({
      ok: true,
      message: `Applied ${template.name} template`,
      report,
    });
  } catch (err) {
    await logError({ error: err, context: 'IndustryTemplates POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
