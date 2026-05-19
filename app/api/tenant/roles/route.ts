import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { roles } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const data = await db.select({
      id: roles.id,
      name: roles.name,
      slug: roles.slug,
      description: roles.description,
      permissions: roles.permissions,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .where(and(eq(roles.tenantId, ctx.tenantId), isNull(roles.deletedAt)))
    .orderBy(roles.name);

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[roles GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await request.json();
    const { name, description, permissions } = body;

    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const [newRole] = await db.insert(roles)
      .values({
        tenantId: ctx.tenantId,
        name: name.trim(),
        slug,
        description: description || null,
        permissions: permissions || {},
      })
      .returning();

    return NextResponse.json({ data: newRole }, { status: 201 });
  } catch (err: any) {
    console.error('[roles POST]', err);
    return apiError(err);
  }
}
