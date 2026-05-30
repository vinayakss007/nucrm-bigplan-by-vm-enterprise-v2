import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createSegmentSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and, desc, like, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const entityType = searchParams.get('entity_type');

    const conditions: any[] = [eq(segments.tenantId, tenantId), isNull(segments.deletedAt)];
    if (search) conditions.push(like(segments.name, `%${search}%`));
    if (entityType) conditions.push(eq(segments.entityType, entityType));

    const results = await db.select().from(segments).where(and(...conditions)).orderBy(desc(segments.createdAt));
    return NextResponse.json({ data: results });
  } catch (error: any) {
    console.error('[segments/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createSegmentSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [segment] = await db.insert(segments).values({
      tenantId,
      name: v.name,
      description: v.description ?? null,
      entityType: v.entity_type,
      config: v.config ?? {},
      createdBy: userId,
    }).returning();

    return NextResponse.json({ data: segment }, { status: 201 });
  } catch (error: any) {
    console.error('[segments/POST]', error);
    return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 });
  }
}
