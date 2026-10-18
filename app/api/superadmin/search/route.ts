/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { clampInt } from '@/lib/api/query-params';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users } from '@/drizzle/schema';
import { ilike, or, desc, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      // #1093: standard { data, ... } envelope; legacy `results` kept.
      return NextResponse.json({ data: [], results: [] });
    }

    // #2766 — `Math.min(25, Number('abc'))` is `NaN`, and a `NaN` limit makes drizzle
    // emit no LIMIT clause at all (`pg-core/dialect.js:286`), so this dropped the cap
    // on *both* selects in the `Promise.all` below; `?limit=-1` did the same, and
    // `?limit=` reached `Number('')` = 0, which passes `0 >= 0` and silently returned
    // an empty search. The sibling `tests/unit/superadmin-search.test.ts:113-132`
    // already pins the 10 and 25 answers this keeps.
    const limit = clampInt(searchParams.get('limit'), 10, 1, 25);
    const pattern = `%${escapeLike(q)}%`;

    const [tenantResults, userResults] = await Promise.all([
      db.select({
        id: tenants.id,
        name: tenants.name,
        email: tenants.billingEmail,
        status: tenants.status,
        type: sql<'tenant'>`'tenant'`,
      })
      .from(tenants)
      .where(or(
        ilike(tenants.name, pattern),
        ilike(tenants.slug, pattern),
        ilike(tenants.billingEmail, pattern),
        // "Search by id" has to compare the id as text: ILIKE against a uuid
        // column is not a defined operator (Postgres: `operator does not exist:
        // uuid ~~* unknown`), and because the arm is inside the shared OR it
        // took the whole console search down, not just id lookups.
        sql`${tenants.id}::text ilike ${pattern}`,
      ))
      .orderBy(desc(tenants.createdAt))
      .limit(limit),

      db.select({
        id: users.id,
        name: users.fullName,
        email: users.email,
        type: sql<'user'>`'user'`,
      })
      .from(users)
      .where(or(
        ilike(users.fullName, pattern),
        ilike(users.email, pattern),
        sql`${users.id}::text ilike ${pattern}`,
      ))
      .orderBy(desc(users.createdAt))
      .limit(limit),
    ]);

    const results = [...tenantResults, ...userResults]
      .sort((a, b) => {
        const aName = ((a as Record<string, unknown>).name ?? (a as Record<string, unknown>).full_name ?? '') as string;
        const bName = ((b as Record<string, unknown>).name ?? (b as Record<string, unknown>).full_name ?? '') as string;
        const qLower = q.toLowerCase();
        const aExact = aName.toLowerCase() === qLower ? 0 : aName.toLowerCase().startsWith(qLower) ? 1 : 2;
        const bExact = bName.toLowerCase() === qLower ? 0 : bName.toLowerCase().startsWith(qLower) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        const aDate = (a as Record<string, unknown>).created_at as string | undefined;
        const bDate = (b as Record<string, unknown>).created_at as string | undefined;
        return (bDate ? new Date(bDate).getTime() : 0) - (aDate ? new Date(aDate).getTime() : 0);
      })
      .slice(0, limit);

    return NextResponse.json({ data: results, results });
  } catch (err) {
    return apiError(err, 'Search failed', 500);
  }
});
