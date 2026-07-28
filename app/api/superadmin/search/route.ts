import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users } from '@/drizzle/schema';
import { ilike, or, desc, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const limit = Math.min(Number(searchParams.get('limit') ?? '10'), 25);

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
        ilike(tenants.name, `%${q}%`),
        ilike(tenants.slug, `%${q}%`),
        ilike(tenants.billingEmail, `%${q}%`),
        ilike(tenants.id, `%${q}%`),
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
        ilike(users.fullName, `%${q}%`),
        ilike(users.email, `%${q}%`),
        ilike(users.id, `%${q}%`),
      ))
      .orderBy(desc(users.createdAt))
      .limit(limit),
    ]);

    // Sort by relevance: exact name match first, then by creation date (newest first).
    // Previously sorted by Math.random() which gave non-deterministic, useless results.
    const qLower = q.toLowerCase();
    const results = [...tenantResults, ...userResults]
      .sort((a, b) => {
        const aName = ('name' in a ? a.name : 'fullName' in a ? a.fullName : '') || '';
        const bName = ('name' in b ? b.name : 'fullName' in b ? b.fullName : '') || '';
        const aExact = aName.toLowerCase() === qLower ? 1 : 0;
        const bExact = bName.toLowerCase() === qLower ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aStarts = aName.toLowerCase().startsWith(qLower) ? 1 : 0;
        const bStarts = bName.toLowerCase().startsWith(qLower) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        // Fall back to newest first
        const aDate = 'createdAt' in a ? new Date(a.createdAt as string).getTime() : 0;
        const bDate = 'createdAt' in b ? new Date(b.createdAt as string).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, limit);

    return NextResponse.json({ results });
  } catch (err) {
    return apiError(err, 'Search failed', 500);
  }
}
