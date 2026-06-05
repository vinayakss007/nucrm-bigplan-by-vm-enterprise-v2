import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveDashboardLayout, saveLayout } from '@/lib/dashboard/layout-resolver';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

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
  const row = (result as any).rows?.[0] ?? { industry: null, plan_name: 'free' };

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
  const { layout } = body;

  if (!Array.isArray(layout)) {
    return NextResponse.json({ error: 'Invalid layout' }, { status: 400 });
  }

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
  const row = (result as any).rows?.[0] ?? { industry: null, plan_name: 'free' };

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
