/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { resolvePortalIdentity } from '@/lib/portal-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { withTenantContext, NO_USER_SENTINEL } from '@/lib/db/rls';

/**
 * Public KB list — DECISION (#2221): this is NOT a global help center.
 * kb_articles rows carry a tenantId and the only consumer is the customer
 * portal, so the previous unscoped query made every tenant's published KB
 * cross-enumerable from one call. The list is now scoped to the caller's
 * server-validated portal identity (httpOnly session cookie or
 * x-portal-token, same mechanism as /api/public/tickets) — anonymous
 * callers get 401 instead of the whole fleet's articles.
 *
 * #2221's predicate was right and still unreadable: `kb_articles` and
 * `kb_categories` both carry `tenant_isolation`, so the join and the filter ran
 * against `app.current_tenant`, which this route never set. The result was a 200
 * with an empty list for a tenant that has published articles (#2446).
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'public-kb-list', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const data = await withTenantContext(identity.tenantId, NO_USER_SENTINEL, (tx) =>
      tx.select({
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
        .limit(50));

    return NextResponse.json({ data });
  } catch { return NextResponse.json({ data: [] }); }
}
