import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { savedViews } from '@/drizzle/schema';
import { eq, and, or, desc, isNull } from 'drizzle-orm';

/**
 * GET /api/tenant/views
 * List saved views for the current user + shared views from others
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entity_type');

    const filters = [
      eq(savedViews.tenantId, ctx.tenantId),
      isNull(savedViews.deletedAt),
      or(
        eq(savedViews.userId, ctx.userId),
        eq(savedViews.isShared, true)
      ),
    ];

    if (entityType) {
      filters.push(eq(savedViews.entityType, entityType));
    }

    const views = await db.select()
      .from(savedViews)
      .where(and(...filters))
      .orderBy(desc(savedViews.createdAt));

    return NextResponse.json({ data: views });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/views
 * Create a saved view
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.view');
    if (deny) return deny;

    const body = await req.json();
    const { name, entity_type, filters, columns, is_shared } = body;

    if (!name || !entity_type) {
      return NextResponse.json({ error: 'name and entity_type are required' }, { status: 400 });
    }

    // Validate filters is a plain object (not null, not array, not string)
    if (filters !== undefined && filters !== null) {
      if (typeof filters !== 'object' || Array.isArray(filters)) {
        return NextResponse.json({ error: 'filters must be a plain object' }, { status: 400 });
      }
    }

    const [view] = await db.insert(savedViews).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name,
      entityType: entity_type,
      filters: filters || {},
      columns: columns || null,
      isShared: is_shared || false,
      isDefault: false,
    }).returning();

    return NextResponse.json({ data: view }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}
