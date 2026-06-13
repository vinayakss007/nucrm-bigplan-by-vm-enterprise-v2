import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';

export async function GET(_request: NextRequest) {
  try {
    const data = await db.select({
      id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
      excerpt: kbArticles.excerpt, views: kbArticles.views,
      createdAt: kbArticles.createdAt,
      categoryName: kbCategories.name,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(and(eq(kbArticles.status, 'published'), isNull(kbArticles.deletedAt)))
    .orderBy(desc(kbArticles.createdAt))
    .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}
