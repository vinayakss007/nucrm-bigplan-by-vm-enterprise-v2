/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customEntities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { apiError } from '@/lib/api-error';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { z } from 'zod';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const updateEntitySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(50).optional(),
  fields: z.array(z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['text', 'number', 'boolean', 'date', 'email', 'url', 'phone', 'select', 'json']),
    required: z.boolean().optional().default(false),
    label: z.string().max(200).optional(),
    options: z.array(z.string()).optional(),
  })).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const GET = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const id = (await params).id;
    const [row] = await db
      .select()
      .from(customEntities)
      .where(and(eq(customEntities.id, id), eq(customEntities.tenantId, ctx.tenantId), isNull(customEntities.deletedAt)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(request, 'customEntities', 'patch');
    if (limited) return limited;

    const id = (await params).id;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateEntitySchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.icon !== undefined) updateData.icon = v.icon;
    if (v.fields !== undefined) updateData.fields = v.fields;
    if (v.settings !== undefined) updateData.settings = v.settings;
    if (v.isActive !== undefined) updateData.isActive = v.isActive;

    // Optimistic concurrency (#680): if the client sends expectedUpdatedAt,
    // reject the write when the row moved on since it was read. Opt-in — callers
    // that omit it keep the previous last-write-wins behaviour.
    const expectedUpdatedAt = rawBody?.expectedUpdatedAt ? new Date(rawBody.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, customEntities, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db
      .update(customEntities)
      .set(updateData)
      .where(and(eq(customEntities.id, id), eq(customEntities.tenantId, ctx.tenantId), isNull(customEntities.deletedAt)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await rateLimitMutating(request, 'customEntities', 'delete');
    if (limited) return limited;

    const id = (await params).id;
    const [row] = await db
      .update(customEntities)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(customEntities.id, id), eq(customEntities.tenantId, ctx.tenantId), isNull(customEntities.deletedAt)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
});
