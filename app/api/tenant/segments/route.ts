import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entity_type');

    const where = [eq(segments.tenantId, ctx.tenantId)];
    if (entityType) {
      where.push(eq(segments.entityType, entityType));
    }

    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        entityType: segments.entityType,
        description: segments.description,
      })
      .from(segments)
      .where(and(...where))
      .orderBy(segments.name);

    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[segments GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
