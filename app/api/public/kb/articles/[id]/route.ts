/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { kbArticles, kbCategories } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { resolvePortalIdentity } from '@/lib/portal-auth';

/**
 * Public KB article detail — DECISION (#2284, follow-up to #2221 / PR #2283):
 * the list route was scoped to the caller's server-validated portal identity,
 * but this detail route still resolved any article by UUID with only a
 * status='published' filter, so a guessed article id leaked another tenant's
 * KB content (and draft/archived rows never reached here, but the tenant gap
 * did). Same mechanism as /api/public/tickets and the list route:
 * resolvePortalIdentity (httpOnly cookie or x-portal-token), anonymous -> 401,
 * and the WHERE clause mirrors the list predicate exactly
 * (tenant_id + status='published' + deleted_at IS NULL). Anything that does
 * not match — other tenant, draft, archived, soft-deleted, missing — gets an
 * identical 404 so this is not an existence oracle. Legitimately-public rows
 * keep the exact same { data: article } response shape.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await resolvePortalIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id } = await params;
    const [article] = await db.select({
      id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug,
      content: kbArticles.content, excerpt: kbArticles.excerpt,
      views: kbArticles.views, createdAt: kbArticles.createdAt,
      categoryName: kbCategories.name,
    })
    .from(kbArticles)
    .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
    .where(and(
      eq(kbArticles.id, id),
      eq(kbArticles.tenantId, identity.tenantId),
      eq(kbArticles.status, 'published'),
      isNull(kbArticles.deletedAt),
    ))
    .limit(1);

    if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // id already proven to be a published, live, same-tenant row above.
    await db.update(kbArticles).set({ views: (article.views || 0) + 1 }).where(eq(kbArticles.id, id));

    return NextResponse.json({ data: article });
  } catch { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
}
