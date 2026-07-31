import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateWebhookSchema } from '@/lib/api/schemas';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
  const limited = await rateLimitMutating(req, 'webhooks', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    const rawBody = await readJsonBody(req);
    const validated = validateBody(updateWebhookSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const body = validated.data;
    const { name, url, events, is_active } = body;
    
    // Get existing webhook to merge config
    const existing = await db.query.integrations.findFirst({
      where: and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook'))
    });
    
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    const currentConfig = (existing.config ?? {}) as Record<string, unknown>;
    const newConfig = {
      ...currentConfig,
      url: url || currentConfig['url'],
      events: events || currentConfig['events'],
    };
    
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (is_active !== undefined) updateData.isActive = is_active;
    if (url !== undefined || events !== undefined) updateData.config = newConfig;
    
    const [row] = await db
      .update(integrations)
      .set(updateData)
      .where(and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook')))
      .returning();
    
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    return NextResponse.json({ 
      data: { 
        ...row, 
        url: ((row.config as Record<string, unknown>)?.url as string | undefined),
        events: ((row.config as Record<string, unknown>)?.events as string[] | undefined) 
      } 
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
  const limited = await rateLimitMutating(req, 'webhooks', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    await db.update(integrations)
      .set({ deletedAt: new Date() })
      .where(and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook'), isNull(integrations.deletedAt)));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
