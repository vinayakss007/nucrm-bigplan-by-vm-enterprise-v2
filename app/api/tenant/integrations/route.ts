import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createIntegrationSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const data = await db.query.integrations.findMany({
        limit: 200,
      where: eq(integrations.tenantId, ctx.tenantId),
      orderBy: [desc(integrations.createdAt)],
    });

    return NextResponse.json({ data });
  } catch (err: unknown) {
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    const body = await request.json();
    const validated = validateBody(createIntegrationSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(integrations).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type: v.type,
      name: v.name,
      config: v.config || {},
      isActive: v.is_active,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}
