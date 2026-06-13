import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createKbArticleSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('category_id');
    const status = searchParams.get('status') || 'published';
    const search = searchParams.get('q')?.trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const filters = [eq(kbArticles.tenantId, ctx.tenantId), isNull(kbArticles.deletedAt)];
    if (categoryId) filters.push(eq(kbArticles.categoryId, categoryId));
    if (status !== 'all') filters.push(eq(kbArticles.status, status));
    if (search) filters.push(sql`to_tsvector('english', ${kbArticles.title} || ' ' || ${kbArticles.content}) @@ plainto_tsquery('english', ${search})`);

    const [data, totalResult] = await Promise.all([
      db.select({
        id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
        excerpt: kbArticles.excerpt, status: kbArticles.status, views: kbArticles.views,
        helpful: kbArticles.helpful, notHelpful: kbArticles.notHelpful,
        createdAt: kbArticles.createdAt, publishedAt: kbArticles.publishedAt,
        categoryName: kbCategories.name, categoryId: kbArticles.categoryId,
      })
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .where(and(...filters))
      .orderBy(desc(kbArticles.createdAt))
      .limit(limit).offset(offset),

      db.select({ count: sql<number>`COUNT(*)::int` })
        .from(kbArticles).where(and(...filters)),
    ]);

    return NextResponse.json({ data, total: totalResult[0]?.count ?? 0 });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    const validated = validateBody(createKbArticleSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const slug = body.slug || v.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 100);

    const [row] = await db.insert(kbArticles).values({
      tenantId: ctx.tenantId, createdBy: ctx.userId,
      categoryId: v.category_id || null,
      title: v.title, slug, content: v.content,
      excerpt: body.excerpt, status: v.status || 'draft',
      tags: v.tags || [],
      publishedAt: v.status === 'published' ? new Date() : null,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}
