import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customEntities } from '@/drizzle/schema';
import { eq, and, isNull, ilike, desc } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';

const createEntitySchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  icon: z.string().max(50).optional(),
  fields: z.array(z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['text', 'number', 'boolean', 'date', 'email', 'url', 'phone', 'select', 'json']),
    required: z.boolean().optional().default(false),
    label: z.string().max(200).optional(),
    options: z.array(z.string()).optional(),
  })).optional().default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().optional().default(true),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const conditions = [
      eq(customEntities.tenantId, ctx.tenantId),
      isNull(customEntities.deletedAt),
    ];

    if (search) {
      conditions.push(ilike(customEntities.name, `%${search}%`));
    }

    const rows = await db
      .select()
      .from(customEntities)
      .where(and(...conditions))
      .orderBy(desc(customEntities.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ data: rows });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(createEntitySchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(customEntities).values({
      tenantId: ctx.tenantId,
      slug: v.slug,
      name: v.name,
      description: v.description,
      icon: v.icon,
      fields: v.fields,
      settings: v.settings,
      isActive: v.isActive,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}
