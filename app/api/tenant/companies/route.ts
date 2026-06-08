import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, validateQuery } from '@/lib/api/validate';
import { createCompanySchema, companyQuerySchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { companies, contacts } from '@/drizzle/schema';
import { eq, and, sql, ilike, isNull } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'companies.view');
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const query = validateQuery(companyQuerySchema, {
      offset: searchParams.get('offset') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      industry: searchParams.get('industry') ?? undefined,
    });
    if (query instanceof NextResponse) return query;
    const { offset, limit, q, industry } = query.data;

    const filters = [
      eq(companies.tenantId, ctx.tenantId),
      isNull(companies.deletedAt)
    ];

    if (q) {
      filters.push(ilike(companies.name, `%${q}%`));
    }
    if (industry) {
      filters.push(eq(companies.industry, industry));
    }

    // Subquery for contact counts per company
    const contactCounts = db.select({
      companyId: contacts.companyId,
      count: sql<number>`count(*)::int`.as('contact_count')
    })
    .from(contacts)
    .where(eq(contacts.tenantId, ctx.tenantId))
    .groupBy(contacts.companyId)
    .as('cnt');
    
    const [data, totalResult] = await Promise.all([
      db.select({
        id: companies.id,
        name: companies.name,
        industry: companies.industry,
        companySize: companies.companySize,
        website: companies.website,
        phone: companies.phone,
        address: companies.address,
        notes: companies.notes,
        customFields: companies.customFields,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
        contactCount: sql<number>`COALESCE(${contactCounts.count}, 0)`
      })
      .from(companies)
      .leftJoin(contactCounts, eq(contactCounts.companyId, companies.id))
      .where(and(...filters))
      .orderBy(companies.name)
      .limit(limit)
      .offset(offset),

      db.select({ count: sql<number>`COUNT(*)::int` })
        .from(companies)
        .where(and(...filters)),
    ]);

    return NextResponse.json({ data, total: totalResult[0]?.count ?? 0, limit, offset });
  } catch (err: any) {
    console.error('[companies GET]', err);
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'companies.create');
    if (deny) return deny;

    const limited = await checkRateLimit(request, { action: 'companies_create', max: 100, windowMinutes: 60 });
    if (limited) return limited;

    const body = await request.json();
    const validated = validateBody(createCompanySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(companies)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        name: v.name,
        industry: v.industry || null,
        companySize: v.size || null,
        website: v.website || null,
        phone: v.phone || null,
        address: v.billing_address || null,
        notes: v.description || null,
        customFields: v.custom_fields,
      })
      .returning();

    if (row) {
      fireWebhooks(ctx.tenantId, 'company.created', { id: row.id, name: v.name }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    console.error('[companies POST]', err);
    return apiError(err);
  }
}
