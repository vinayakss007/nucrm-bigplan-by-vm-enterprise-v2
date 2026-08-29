/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { db } from '@/drizzle/db';
import { products } from '@/drizzle/schema';
import { eq, and, desc, sql, isNull, ilike, type SQL } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { withApiRoute } from '@/lib/api/with-api-route';

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  base_price: z.coerce.number().min(0).optional().default(0),
});

const _updateProductSchema = createProductSchema.partial();

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const q = searchParams.get('q')?.trim() ?? '';

    const filters: SQL<unknown>[] = [
      eq(products.tenantId, ctx.tenantId),
      isNull(products.deletedAt),
    ];

    if (q) {
      const w = `%${escapeLike(q)}%`;
      filters.push(sql`(${ilike(products.name, w)} OR ${ilike(products.sku, w)} OR ${ilike(products.description, w)})`);
    }

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(and(...filters));

    const total = countResult?.count ?? 0;
    const data = await db.select()
      .from(products)
      .where(and(...filters))
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      data: data.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sku: p.sku,
        base_price: p.basePrice,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    });
  } catch (error: unknown) {
    await logError({ error, context: 'tenant/products GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'products', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(request);
    const validated = validateBody(createProductSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [inserted] = await db.insert(products).values({
      tenantId: ctx.tenantId,
      name: v.name,
      description: v.description ?? null,
      sku: v.sku ?? null,
      basePrice: String(v.base_price),
    }).returning();

    if (!inserted) {
      return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
    }

    logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create', entityType: 'product', entityId: inserted.id,
      newData: { name: v.name, sku: v.sku },
    }).catch(e => logError({ error: e, context: "async-catch:product.create:logAudit" }));

    fireWebhooks(ctx.tenantId, 'product.created', { id: inserted.id }).catch(e => logError({ error: e, context: "async-catch:[context]" }));

    return NextResponse.json({ data: {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description,
      sku: inserted.sku,
      base_price: inserted.basePrice,
      created_at: inserted.createdAt,
    } }, { status: 201 });
  } catch (error: unknown) {
    await logError({ error, context: 'tenant/products POST', requestMethod: 'POST' });
    return apiError(error);
  }
});
