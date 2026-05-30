import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createPriceBookSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { priceBooks } from '@/drizzle/schema';
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

    const conditions: any[] = [eq(priceBooks.tenantId, tenantId), isNull(priceBooks.deletedAt)];
    if (search) conditions.push(like(priceBooks.name, `%${search}%`));

    const results = await db.select().from(priceBooks).where(and(...conditions)).orderBy(desc(priceBooks.createdAt)).limit(limit).offset(offset);
    return NextResponse.json({ data: results });
  } catch (error: any) {
    console.error('[price-books/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch price books' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'price_books_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createPriceBookSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [priceBook] = await db.insert(priceBooks).values({
      tenantId,
      name: v.name,
      description: v.description ?? null,
      currency: v.currency ?? 'USD',
      isActive: v.is_active ?? true,
      validFrom: v.valid_from ?? null,
      validUntil: v.valid_until ?? null,
      createdBy: userId,
    }).returning();

    return NextResponse.json({ data: priceBook }, { status: 201 });
  } catch (error: any) {
    console.error('[price-books/POST]', error);
    return NextResponse.json({ error: 'Failed to create price book' }, { status: 500 });
  }
}
