/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createKbCategorySchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { kbCategories } from '@/drizzle/schema';
import { eq, and, asc, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await db.select()
      .from(kbCategories)
      .where(and(eq(kbCategories.tenantId, ctx.tenantId), isNull(kbCategories.deletedAt)))
      .orderBy(asc(kbCategories.order));
    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'kbCategories', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await readJsonBody(request);
    const validated = validateBody(createKbCategorySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const slug = v.slug || v.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const [row] = await db.insert(kbCategories).values({
      tenantId: ctx.tenantId, createdBy: ctx.userId,
      name: v.name, slug, description: v.description, icon: body.icon || null, order: v.order || 0,
    }).returning();
    return NextResponse.json({ data: row }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
