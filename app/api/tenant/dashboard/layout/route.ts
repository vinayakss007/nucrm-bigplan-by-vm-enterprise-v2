import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveDashboardLayout, saveLayout } from '@/lib/dashboard/layout-resolver';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dashboardLayoutSchema: z.ZodType<{ layout: any }> = z.object({
  layout: z.array(z.record(z.string(), z.unknown())),
});

export async function GET(request: NextRequest) {
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
  );

  return NextResponse.json({ layout: layoutResult.layout, source: layoutResult.source });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const body = await request.json();
  const parsed = validateBody(dashboardLayoutSchema, body);
  if (parsed instanceof NextResponse) return parsed;
  const { layout } = parsed.data;

  await saveLayout(ctx.tenantId, ctx.userId, layout);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
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
  );

  return NextResponse.json({
    ok: true,
    layout: layoutResult.layout,
    source: layoutResult.source,
    message: 'Layout reset to default',
  });
}
