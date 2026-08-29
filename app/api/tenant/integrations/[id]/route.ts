/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

export const PATCH = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'integrations', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const body = await readJsonBody(request);
    const { is_active } = body;
    const { id } = await params;

    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, integrations, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db.update(integrations)
      .set({ 
        isActive: is_active,
        updatedAt: new Date()
      })
      .where(and(
        eq(integrations.id, id), 
        eq(integrations.tenantId, ctx.tenantId)
      ))
      .returning({ 
        id: integrations.id, 
        is_active: integrations.isActive 
      });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: unknown) { 
    return apiError(err instanceof Error ? err : new Error(String(err))); 
  }
});

export const DELETE = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'integrations', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { id } = await params;
    const result = await db.update(integrations)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(integrations.id, id), 
        eq(integrations.tenantId, ctx.tenantId)
      ));

    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) { 
    return apiError(err instanceof Error ? err : new Error(String(err))); 
  }
});
