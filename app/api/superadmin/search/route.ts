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
      .limit(limit)
      .catch(() => []),

      db.select({
        id: users.id,
        name: users.fullName,
        email: users.email,
        status: users.status,
        type: sql<'user'>`'user'`,
      })
      .from(users)
      .where(or(
        ilike(users.fullName, `%${q}%`),
        ilike(users.email, `%${q}%`),
        ilike(users.id, `%${q}%`),
      ))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .catch(() => []),
    ]);

    const results = [...tenantResults, ...userResults]
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);

    return NextResponse.json({ results });
  } catch (err) {
    return apiError(err, 'Search failed', 500);
  }
}
