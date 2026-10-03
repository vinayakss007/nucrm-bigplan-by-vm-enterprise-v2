/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { resolvePortalIdentity } from '@/lib/portal-auth';

/**
 * Public KB list — DECISION (#2221): this is NOT a global help center.
 * kb_articles rows carry a tenantId and the only consumer is the customer
 * portal, so the previous unscoped query made every tenant's published KB
 * cross-enumerable from one call. The list is now scoped to the caller's
 * server-validated portal identity (httpOnly session cookie or
 * x-portal-token, same mechanism as /api/public/tickets) — anonymous
 * callers get 401 instead of the whole fleet's articles.
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const data = await db.select({
      id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
      excerpt: kbArticles.excerpt, views: kbArticles.views,
      createdAt: kbArticles.createdAt,
      categoryName: kbCategories.name,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(and(
      eq(kbArticles.tenantId, identity.tenantId),
      eq(kbArticles.status, 'published'),
      isNull(kbArticles.deletedAt),
    ))
    .orderBy(desc(kbArticles.createdAt))
    .limit(50);

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}
