import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [article] = await db.select({
      id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
      content: kbArticles.content, excerpt: kbArticles.excerpt,
      views: kbArticles.views, createdAt: kbArticles.createdAt,
      categoryName: kbCategories.name,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(and(eq(kbArticles.id, id), eq(kbArticles.status, 'published')))
    .limit(1);

    if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(kbArticles).set({ views: (article.views || 0) + 1 }).where(eq(kbArticles.id, id));

    return NextResponse.json({ data: article });
  } catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
}
