/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customEntities, customEntityData } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id, rowId } = await params;
    const [row] = await db
      .select()
      .from(customEntityData)
      .where(and(eq(customEntityData.id, rowId), eq(customEntityData.entityId, id), eq(customEntityData.tenantId, ctx.tenantId), isNull(customEntityData.deletedAt)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id, rowId } = await params;

    const [entity] = await db
      .select()
      .from(customEntities)
      .where(and(eq(customEntities.id, id), eq(customEntities.tenantId, ctx.tenantId), isNull(customEntities.deletedAt)))
      .limit(1);

    if (!entity) return NextResponse.json({ error: 'Entity type not found' }, { status: 404 });

    const rawBody = await readJsonBody(request);
    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const dataSchema = (entity.fields as Array<{ name: string; type: string; required?: boolean; label?: string }>) || [];
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

    const [row] = await db
      .update(customEntityData)
      .set({ data: rawBody, updatedAt: new Date() })
      .where(and(eq(customEntityData.id, rowId), eq(customEntityData.entityId, id), eq(customEntityData.tenantId, ctx.tenantId), isNull(customEntityData.deletedAt)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id, rowId } = await params;
    const [row] = await db
      .update(customEntityData)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(customEntityData.id, rowId), eq(customEntityData.entityId, id), eq(customEntityData.tenantId, ctx.tenantId), isNull(customEntityData.deletedAt)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}
