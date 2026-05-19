import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';
import { eq, and, desc, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const isActive = searchParams.get('is_active');

    const filters = [
      eq(integrations.tenantId, ctx.tenantId),
      eq(integrations.type, 'webhook')
    ];
    if (isActive !== null) {
      filters.push(eq(integrations.isActive, isActive === 'true'));
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(integrations)
      .where(and(...filters));

    const data = await db
      .select({
        id: integrations.id,
        name: integrations.name,
        is_active: integrations.isActive,
        last_used_at: integrations.lastUsedAt,
        created_at: integrations.createdAt,
        url: sql<string>`${integrations.config}->>'url'`,
        events: sql<any[]>`${integrations.config}->'events'`,
        delivered_count: sql<number>`(SELECT count(*)::int FROM ${webhookQueue} WHERE webhook_id = ${integrations.id} AND status = 'delivered')`,
        failed_count: sql<number>`(SELECT count(*)::int FROM ${webhookQueue} WHERE webhook_id = ${integrations.id} AND status = 'failed')`
      })
      .from(integrations)
      .where(and(...filters))
      .orderBy(desc(integrations.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { name, url, events = [] } = await req.json();
    if (!name?.trim() || !url?.trim()) return NextResponse.json({ error: 'name and url required' }, { status: 400 });
    try { new URL(url); } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }
    
    const signingSecret = randomBytes(24).toString('hex');
    const [row] = await db.insert(integrations).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type: 'webhook',
      name: name.trim(),
      config: { url, events, secret: signingSecret },
      isActive: true,
    }).returning({
      id: integrations.id,
      name: integrations.name,
      is_active: integrations.isActive,
      created_at: integrations.createdAt
    });

    return NextResponse.json({ 
      data: { ...row, signing_secret: signingSecret, note: 'Save this secret — shown once.' } 
    }, { status: 201 });
  } catch (err: any) { return apiError(err); }
}
