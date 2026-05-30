import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createServiceCategorySchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { serviceCategories } from '@/drizzle/schema';
import { eq, and, desc, like, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

    const conditions: any[] = [eq(serviceCategories.tenantId, tenantId), isNull(serviceCategories.deletedAt)];
    if (search) conditions.push(like(serviceCategories.name, `%${search}%`));

    const results = await db.select().from(serviceCategories).where(and(...conditions)).orderBy(desc(serviceCategories.createdAt)).limit(limit).offset(offset);
    return NextResponse.json({ data: results });
  } catch (error: any) {
    console.error('[service-categories/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch service categories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'service_categories_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createServiceCategorySchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [category] = await db.insert(serviceCategories).values({
      tenantId,
      name: v.name,
      description: v.description ?? null,
      color: v.color ?? '#6366f1',
      icon: v.icon ?? null,
      sortOrder: v.sort_order ?? 0,
      createdBy: userId,
    }).returning();

    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error: any) {
    console.error('[service-categories/POST]', error);
    return NextResponse.json({ error: 'Failed to create service category' }, { status: 500 });
  }
}
