import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createProductSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { products } from '@/drizzle/schema';
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

    const conditions: any[] = [eq(products.tenantId, tenantId), isNull(products.deletedAt)];
    if (search) conditions.push(like(products.name, `%${search}%`));

    const results = await db.select().from(products).where(and(...conditions)).orderBy(desc(products.createdAt)).limit(limit).offset(offset);
    return NextResponse.json({ data: results });
  } catch (error: any) {
    console.error('[products/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'products_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createProductSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [product] = await db.insert(products).values({
      tenantId,
      name: v.name,
      description: v.description ?? null,
      sku: v.sku ?? null,
      basePrice: v.price ? String(v.price) : '0',
      createdBy: userId,
    }).returning();

    return NextResponse.json({ data: product }, { status: 201 });
  } catch (error: any) {
    console.error('[products/POST]', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
