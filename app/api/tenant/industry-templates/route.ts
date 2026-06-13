import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customFieldDefs, pipelines, dealStages, automations } from '@/drizzle/schema';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { templateId } = await req.json();
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

        for (const [i, stageName] of pipe.stages.entries()) {
          await tx.insert(dealStages).values({
            pipelineId: pipelineId,
            name: stageName,
            order: i,
          });
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

  } catch (err: any) {
    console.error('[IndustryTemplates] error:', err);
    return apiError(err);
  }
}
