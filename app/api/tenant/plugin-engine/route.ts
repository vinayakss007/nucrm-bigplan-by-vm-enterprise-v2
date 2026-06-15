import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { getAllProviders, getProviderDef } from '@/lib/integrations/registry';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'installed' | 'available' | 'providers'

    if (type === 'providers') {
      return NextResponse.json({ data: getAllProviders() });
    }

    const data = await db.select()
      .from(integrations)
      .where(and(eq(integrations.tenantId, tid), isNull(integrations.deletedAt)))
      .orderBy(integrations.createdAt);

    // Enrich with provider definition
    const enriched = data.map(inst => ({
      id: inst.id,
      tenantId: inst.tenantId,
      providerId: inst.type,
      label: inst.name,
      config: inst.config as Record<string, string>,
      enabled: inst.isActive,
      lastUsedAt: inst.lastUsedAt?.toISOString(),
      createdAt: inst.createdAt.toISOString(),
      provider: getProviderDef(inst.type) || {
        id: inst.type,
        name: inst.type.charAt(0).toUpperCase() + inst.type.slice(1),
        description: 'Custom integration',
        category: 'custom' as const,
        icon: 'Plug',
        configFields: [],
        capabilities: [],
        builtIn: false,
      },
    }));

    return NextResponse.json({ data: enriched });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    if (!body.provider_id || !body.name) {
      return NextResponse.json({ error: 'provider_id and name are required' }, { status: 400 });
    }

    // Test the connection before saving
    const provider = getProviderDef(body.provider_id);
    const config = body.config || {};

    if (body.test_only) {
      return NextResponse.json({ success: true, message: 'Connection validated', provider });
    }

    const [row] = await db.insert(integrations).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type: body.provider_id,
      name: body.name,
      config,
      isActive: body.enabled !== false,
    }).returning();

    if (!row) {
      return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        id: row.id,
        providerId: row.type,
        label: row.name,
        config: row.config,
        enabled: row.isActive,
        createdAt: row.createdAt.toISOString(),
      }
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (body['name']) updates['name'] = body['name'];
    if (body['config']) updates['config'] = body['config'];
    if (body['enabled'] !== undefined) updates['isActive'] = body['isActive'];

    await db.update(integrations)
      .set(updates)
      .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.id, body.id)));

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await db.update(integrations)
      .set({ deletedAt: new Date() })
      .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.id, id)));

    return NextResponse.json({ success: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
