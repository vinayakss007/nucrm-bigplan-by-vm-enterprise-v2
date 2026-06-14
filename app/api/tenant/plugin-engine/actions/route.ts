import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { executeAction } from '@/lib/integrations/registry';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
