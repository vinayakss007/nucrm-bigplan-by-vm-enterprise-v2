import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { tenantHierarchy, hierarchyPermissions } from '@/drizzle/schema/hierarchy';
import { eq, and, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    // Get hierarchy entries where this tenant is the parent
    const children = await db
      .select()
      .from(tenantHierarchy)
      .where(and(
        eq(tenantHierarchy.parentTenantId, ctx.tenantId),
        isNull(tenantHierarchy.deletedAt)
      ));

    // Get hierarchy entries where this tenant is a child
    const parents = await db
      .select()
      .from(tenantHierarchy)
      .where(and(
        eq(tenantHierarchy.childTenantId, ctx.tenantId),
        isNull(tenantHierarchy.deletedAt)
      ));

    return NextResponse.json({
      data: {
        children,
        parents,
        tenantId: ctx.tenantId,
      },
    });
 
 
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const body = await req.json();
    const { childTenantId, relationship, permissions } = body;

    if (!childTenantId) {
      return NextResponse.json({ error: 'childTenantId is required' }, { status: 400 });
    }

    const [row] = await db.insert(tenantHierarchy).values({
      parentTenantId: ctx.tenantId,
      childTenantId,
      relationship: relationship || 'parent',
    }).returning();

    // Add permissions if provided
    if (permissions && Array.isArray(permissions) && row) {
      for (const perm of permissions) {
        await db.insert(hierarchyPermissions).values({
          hierarchyId: row.id,
          permission: perm,
        });
      }
    }

    return NextResponse.json({ data: row }, { status: 201 });
 
 
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const body = await req.json();
    const { id, relationship } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const [row] = await db
      .update(tenantHierarchy)
      .set({ relationship, updatedAt: new Date() })
      .where(and(
        eq(tenantHierarchy.id, id),
        eq(tenantHierarchy.parentTenantId, ctx.tenantId)
      ))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Hierarchy entry not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
 
 
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const gate = await requireModule(ctx.tenantId, 'core-crm');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    // Soft delete
    const [row] = await db
      .update(tenantHierarchy)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() } as any)
      .where(and(
        eq(tenantHierarchy.id, id),
        eq(tenantHierarchy.parentTenantId, ctx.tenantId)
      ))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Hierarchy entry not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id, deleted: true } });
 
 
  } catch (err: unknown) {
    return apiError(err);
  }
}
