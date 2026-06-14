import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { updateWebhookSchema } from '@/lib/api/schemas';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    const rawBody = await req.json();
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
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    await db.delete(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook')));

    return NextResponse.json({ ok: true });
  } catch (err: any) { return apiError(err); }
}
