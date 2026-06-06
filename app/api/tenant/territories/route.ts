import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { territories, territoryAssignments } from '@/drizzle/schema/territories';
import { eq, and, isNull } from 'drizzle-orm';
import { getTerritoryTree } from '@/lib/territories';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const createTerritorySchema = z.object({
  name: z.string().min(1, 'name is required'),
  type: z.enum(['country', 'state', 'city', 'region', 'custom']).or(z.string().min(1)),
  parentId: z.string().uuid().optional().nullable(),
  geoConfig: z.record(z.string(), z.unknown()).optional().default({}),
});

const updateTerritorySchema = z.object({
  id: z.string().uuid('id is required'),
  name: z.string().optional(),
  type: z.enum(['country', 'state', 'city', 'region', 'custom']).or(z.string()).optional(),
  parentId: z.string().uuid().optional().nullable(),
  geoConfig: z.record(z.string(), z.unknown()).optional(),
  assignedTo: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const tree = await getTerritoryTree(ctx.tenantId);
    return NextResponse.json({ data: tree });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const raw = await req.json();
    const parsed = validateBody(createTerritorySchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { name, type, parentId, geoConfig } = parsed.data;

    const [row] = await db.insert(territories).values({
      tenantId: ctx.tenantId,
      name,
      type: type as any,
      parentId: parentId || null,
      geoConfig: geoConfig || {},
    } as any).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const raw = await req.json();
    const parsed = validateBody(updateTerritorySchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { id, name, type, parentId, geoConfig, assignedTo } = parsed.data;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates['name'] = name;
    if (type !== undefined) updates['type'] = type;
    if (parentId !== undefined) updates['parentId'] = parentId;
    if (geoConfig !== undefined) updates['geoConfig'] = geoConfig;
    if (assignedTo !== undefined) updates['assignedTo'] = assignedTo;

    const [row] = await db
      .update(territories)
      .set(updates as any)
      .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    // Soft delete
    const [row] = await db
      .update(territories)
      .set({ deletedAt: new Date() })
      .where(and(eq(territories.id, id), eq(territories.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id, deleted: true } });
  } catch (err: any) {
    return apiError(err);
  }
}
