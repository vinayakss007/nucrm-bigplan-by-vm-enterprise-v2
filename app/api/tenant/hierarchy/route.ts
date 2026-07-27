import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { tenantHierarchy, hierarchyPermissions } from '@/drizzle/schema/hierarchy';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { createHierarchySchema, updateHierarchySchema } from '@/lib/api/schemas';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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
    const gate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (gate) return gate;

    const body = await req.json();
    const parsed = validateBody(createHierarchySchema, body);
    if (parsed instanceof NextResponse) return parsed;

    let row: typeof tenantHierarchy.$inferSelect | undefined;

    await db.transaction(async (tx) => {
      [row] = await tx.insert(tenantHierarchy).values({
        parentTenantId: ctx.tenantId,
        childTenantId: parsed.data.childTenantId,
        relationship: parsed.data.relationship,
      }).returning();

      if (!row) throw new Error('Failed to create hierarchy entry');

      // Add permissions if provided
      if (parsed.data.permissions && parsed.data.permissions.length > 0 && row) {
        const allowedPerms = ['view_data', 'manage_users', 'share_contacts', 'aggregate_reports'] as const;
        for (const perm of parsed.data.permissions) {
          if (allowedPerms.includes(perm as typeof allowedPerms[number])) {
            await tx.insert(hierarchyPermissions).values({
              hierarchyId: row.id,
              permission: perm as typeof allowedPerms[number],
            });
          }
        }
      }
    });

    return NextResponse.json({ data: row }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
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
    const gate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (gate) return gate;

    const body = await req.json();
    const parsed = validateBody(updateHierarchySchema, body);
    if (parsed instanceof NextResponse) return parsed;

    const expectedUpdatedAt = (parsed.data as Record<string, unknown>).expectedUpdatedAt ? new Date((parsed.data as Record<string, unknown>).expectedUpdatedAt as string) : null;
    const guard = await concurrencyGuard(db, tenantHierarchy, parsed.data.id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db
      .update(tenantHierarchy)
      .set({ relationship: parsed.data.relationship, updatedAt: new Date() })
      .where(and(
        eq(tenantHierarchy.id, parsed.data.id),
        eq(tenantHierarchy.parentTenantId, ctx.tenantId)
      ))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Hierarchy entry not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
  const limited = await rateLimitMutating(req, 'hierarchy', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const gate = await requireModule(ctx.tenantId, 'core-crm', ctx.isSuperAdmin);
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    // Soft delete
    const [row] = await db
      .update(tenantHierarchy)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() })
      .where(and(
        eq(tenantHierarchy.id, id),
        eq(tenantHierarchy.parentTenantId, ctx.tenantId)
      ))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Hierarchy entry not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
