import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customEntities, customEntityData } from '@/drizzle/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const entityId = (await params).id;
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const conditions = [
      eq(customEntityData.tenantId, ctx.tenantId),
      eq(customEntityData.entityId, entityId),
      isNull(customEntityData.deletedAt),
    ];

    if (search) {
      const safeSearch = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      conditions.push(sql`cast(${customEntityData.data} as text) ILIKE ${'%' + safeSearch + '%'} ESCAPE '\\'`);
    }

    const rows = await db
      .select()
      .from(customEntityData)
      .where(and(...conditions))
      .orderBy(desc(customEntityData.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ data: rows });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const entityId = (await params).id;

    const [entity] = await db
      .select()
      .from(customEntities)
      .where(and(eq(customEntities.id, entityId), eq(customEntities.tenantId, ctx.tenantId), isNull(customEntities.deletedAt)))
      .limit(1);

    if (!entity) return NextResponse.json({ error: 'Entity type not found' }, { status: 404 });

    const rawBody = await readJsonBody(request);
    const dataSchema = (entity.fields as Array<{ name: string; type: string; required?: boolean; label?: string }>) || [];

    if (!rawBody || typeof rawBody !== 'object' || Object.keys(rawBody).length === 0) {
      return NextResponse.json({ error: 'Request body must contain data fields' }, { status: 400 });
    }

    const errors: string[] = [];
    for (const field of dataSchema) {
      const value = rawBody[field.name];
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field "${field.label || field.name}" is required`);
        continue;
      }
      if (value !== undefined && value !== null && value !== '') {
        switch (field.type) {
          case 'number':
            if (isNaN(Number(value))) errors.push(`Field "${field.label || field.name}" must be a number`);
            break;
          case 'boolean':
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
              errors.push(`Field "${field.label || field.name}" must be a boolean`);
            }
            break;
          case 'email':
            if (typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              errors.push(`Field "${field.label || field.name}" must be a valid email`);
            }
            break;
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const [row] = await db.insert(customEntityData).values({
      tenantId: ctx.tenantId,
      entityId,
      data: rawBody,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}
