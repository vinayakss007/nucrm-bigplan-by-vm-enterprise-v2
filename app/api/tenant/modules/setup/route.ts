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
import { resolveTemplate } from '@/lib/templates/resolve';
import { applyTemplate } from '@/lib/templates/apply-template';

// POST /api/tenant/modules/setup — #2633: same DB-backed template engine as
// /api/tenant/industry-templates. Stages land in dealStages (the canonical
// table deals.stageId references — see #1337), which applyTemplate guarantees.
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { template_id } = await readJsonBody(req);
    const template = await resolveTemplate(String(template_id ?? ''));
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const report = await db.transaction((tx) => applyTemplate({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      blueprint: template,
      tx,
    }));

    return NextResponse.json({
      ok: true,
      message: `Successfully applied ${template.name} setup.`,
      report,
    });
  } catch (err) {
    await logError({ error: err, context: 'IndustrySetup POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
