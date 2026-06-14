import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const [article] = await db.select({
      id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
      content: kbArticles.content, excerpt: kbArticles.excerpt,
      status: kbArticles.status, views: kbArticles.views,
      helpful: kbArticles.helpful, notHelpful: kbArticles.notHelpful,
      tags: kbArticles.tags, createdAt: kbArticles.createdAt,
      publishedAt: kbArticles.publishedAt,
      categoryName: kbCategories.name, categoryId: kbArticles.categoryId,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, id)))
    .limit(1);

    if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Increment view count
    await db.update(kbArticles).set({ views: (article.views || 0) + 1 }).where(eq(kbArticles.id, id));

    return NextResponse.json({ data: article });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (body['title']) updates['title'] = body['title'];
    if (body['content']) updates['content'] = body['content'];
    if (body['excerpt'] !== undefined) updates['excerpt'] = body['excerpt'];
    if (body['status']) updates['status'] = body['status'];
    if (body['category_id'] !== undefined) updates['categoryId'] = body['category_id'];
    if (body['tags']) updates['tags'] = body['tags'];
    if (body['slug']) updates['slug'] = body['slug'];
    if (body['status'] === 'published') updates['publishedAt'] = new Date();
    updates['updatedAt'] = new Date();

    await db.update(kbArticles).set(updates).where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, id)));
    return NextResponse.json({ success: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    await db.update(kbArticles).set({ deletedAt: new Date() })
      .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, id)));
    return NextResponse.json({ success: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();

    if (body.action === 'helpful') {
      await db.update(kbArticles)
        .set({ helpful: sql`${kbArticles.helpful} + 1` })
        .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, id)));
    } else if (body.action === 'not_helpful') {
      await db.update(kbArticles)
        .set({ notHelpful: sql`${kbArticles.notHelpful} + 1` })
        .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, id)));
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const [updated] = await db.select({ helpful: kbArticles.helpful, notHelpful: kbArticles.notHelpful })
      .from(kbArticles)
      .where(eq(kbArticles.id, id))
      .limit(1);

    return NextResponse.json({ success: true, data: updated });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
