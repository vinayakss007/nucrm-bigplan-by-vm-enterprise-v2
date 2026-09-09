/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customFieldDefs, pipelines, dealStages, automations } from '@/drizzle/schema';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

// GET /api/tenant/industry-templates - list all available industry templates
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const data = Object.values(INDUSTRY_TEMPLATES).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      modules: t.modules,
      custom_fields: t.custom_fields,
      pipelines: t.pipelines,
      automations: t.automations,
    }));

    return NextResponse.json({ data });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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
    const template = INDUSTRY_TEMPLATES[templateId];
    
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      // 1. Insert Custom Fields
      for (const field of template.custom_fields) {
        await tx.insert(customFieldDefs).values({
          tenantId: ctx.tenantId,
          entityType: field.entity,
          fieldKey: field.key,
          fieldLabel: field.label,
          fieldType: field.type
        }).onConflictDoNothing();
      }

      // 2. Insert Pipelines & Stages
      for (const pipe of template.pipelines) {
        const pipelineRows = await tx.insert(pipelines).values({
          tenantId: ctx.tenantId,
          name: pipe.name,
        }).returning({ id: pipelines.id });
        const firstRow = pipelineRows[0];
        if (!firstRow) continue;
        const pipelineId: string = firstRow.id;

        const stageValues = pipe.stages.map((stageName, i) => ({
          tenantId: ctx.tenantId,
          pipelineId: pipelineId,
          name: stageName,
          order: i,
        }));

        if (stageValues.length > 0) {
          await tx.insert(dealStages).values(stageValues);
        }
      }

      // 3. Insert Automations
      for (const auto of template.automations) {
        await tx.insert(automations).values({
          tenantId: ctx.tenantId,
          name: auto.name,
          triggerType: auto.trigger,
          actions: [{ type: auto.action, config: auto.config }],
          isActive: true
        }).onConflictDoNothing();
      }
    });

    return NextResponse.json({ ok: true, message: `Applied ${template.name} template` });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'IndustryTemplates POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
