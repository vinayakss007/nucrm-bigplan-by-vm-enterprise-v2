/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveDashboardLayout, saveLayout } from '@/lib/dashboard/layout-resolver';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DashboardLayout } from '@/types/dashboard';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

 
 
 
const dashboardLayoutSchema: z.ZodType<{ layout: DashboardLayout }> = z.object({
  layout: z.array(z.object({
    widget: z.string(),
    position: z.number(),
    size: z.enum(['1x1', '2x1', '1x2', '2x2']),
    config: z.record(z.string(), z.unknown()).optional(),
  })),
});

export const GET = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const result = await db.execute(
    sql`SELECT t.industry, COALESCE(p.name, 'free') AS plan_name
        FROM tenants t
        LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = ${ctx.tenantId}
        LIMIT 1`
  );
  const row = (result.rows?.[0] ?? {}) as { industry?: string | null; plan_name?: string };

  const layoutResult = await resolveDashboardLayout(
    ctx.tenantId,
    ctx.userId,
    row.plan_name ?? 'free',
    row.industry ?? null,
    ctx.roleSlug ?? null,
  );

  return NextResponse.json({ layout: layoutResult.layout, source: layoutResult.source });
});

export const PUT = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const limited = await rateLimitMutating(request, 'dashboardLayout', 'put');
  if (limited) return limited;

  const body = await readJsonBody(request);
  const parsed = validateBody(dashboardLayoutSchema, body);
  if (parsed instanceof NextResponse) return parsed;
  const { layout } = parsed.data;

  await saveLayout(ctx.tenantId, ctx.userId, layout);
  return NextResponse.json({ ok: true });
});

export const POST = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const limited = await rateLimitMutating(request, 'dashboardLayout', 'post');
  if (limited) return limited;

  const result = await db.execute(
    sql`SELECT t.industry, COALESCE(p.name, 'free') AS plan_name
        FROM tenants t
        LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = ${ctx.tenantId}
        LIMIT 1`
  );
  const row = (result.rows?.[0] ?? {}) as { industry?: string | null; plan_name?: string };

  const layoutResult = await resolveDashboardLayout(
    ctx.tenantId,
    ctx.userId,
    row.plan_name ?? 'free',
    row.industry ?? null,
    ctx.roleSlug ?? null,
  );

  return NextResponse.json({
    ok: true,
    layout: layoutResult.layout,
    source: layoutResult.source,
    message: 'Layout reset to default',
  });
});
