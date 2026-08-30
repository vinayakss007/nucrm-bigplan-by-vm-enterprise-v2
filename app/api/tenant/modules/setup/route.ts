/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customFieldDefs, pipelines, dealStages } from '@/drizzle/schema';
import { automations } from '@/drizzle/schema';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { template_id } = await readJsonBody(req);
    const template = INDUSTRY_TEMPLATES[template_id];
    
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      // 1. Create Custom Fields
      for (const field of template.custom_fields) {
        await tx.insert(customFieldDefs).values({
          tenantId: ctx.tenantId,
          entityType: field.entity,
          fieldKey: field.key,
          fieldLabel: field.label,
          fieldType: field.type,
        }).onConflictDoNothing();
      }

      // 2. Create Pipelines & Stages
      for (const pipe of template.pipelines) {
        const [p] = await tx.insert(pipelines).values({
          tenantId: ctx.tenantId,
          name: pipe.name,
        }).returning({ id: pipelines.id });
        
        if (p) {
          const stageValues = pipe.stages.map((stageName: string, i: number) => ({
            tenantId: ctx.tenantId,
            pipelineId: p.id,
            name: stageName,
            order: i,
          }));
          
          if (stageValues.length > 0) {
            // #1337: write to dealStages (the canonical table that deals.stageId
            // references). Previously wrote to the duplicate pipelineStages table,
            // so template-created stages were invisible to deals and the kanban.
            await tx.insert(dealStages).values(stageValues);
          }
        }
      }

      // 3. Create Automations
      for (const auto of template.automations) {
        await tx.insert(automations).values({
          tenantId: ctx.tenantId,
          name: auto.name,
          triggerType: auto.trigger,
          actions: [{ type: auto.action, config: auto.config }],
          createdBy: ctx.userId,
          isActive: true,
        });
      }
    });

    return NextResponse.json({ ok: true, message: `Successfully applied ${template.name} setup.` });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'IndustrySetup POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
