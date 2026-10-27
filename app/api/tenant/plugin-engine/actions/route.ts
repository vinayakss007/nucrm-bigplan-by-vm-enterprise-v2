/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { executeAction } from '@/lib/integrations/registry';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // #3292 ask 3: firing an integration issues a request with that integration's
    // credentials and hands the caller whatever came back. That is a privileged
    // action, not a read, so it needs `settings.manage` — the same permission
    // `app/api/tenant/settings` guards with — and it needs it BEFORE the row
    // lookup, or a 403 still confirms which instance ids exist in the workspace.
    const forbidden = requirePerm(ctx, 'settings.manage');
    if (forbidden) return forbidden;

    const body = await readJsonBody(request);
    if (!body.instance_id || !body.action) {
      return NextResponse.json({ error: 'instance_id and action are required' }, { status: 400 });
    }

    // Fetch the integration instance
    const [instance] = await db.select()
      .from(integrations)
      .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.id, body.instance_id)))
      .limit(1);

    if (!instance) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    if (!instance.isActive) {
      return NextResponse.json({ error: 'Integration is disabled' }, { status: 400 });
    }

    // Build instance object for the engine
    const instanceObj = {
      id: instance.id,
      tenantId: instance.tenantId,
      providerId: instance.type,
      label: instance.name,
      config: instance.config as Record<string, string>,
      enabled: instance.isActive,
      createdAt: instance.createdAt.toISOString(),
    };

    // Execute
    const result = await executeAction(instanceObj, body.action, body.params || {});

    // Update last used
    await db.update(integrations)
      .set({ lastUsedAt: new Date() })
      .where(eq(integrations.id, instance.id));

    return NextResponse.json(result);
 
 
  } catch (err) {
    return apiError(err);
  }
});
