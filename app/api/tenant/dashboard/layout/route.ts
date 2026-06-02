import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveDashboardLayout, saveLayout } from '@/lib/dashboard/layout-resolver';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, ctx.tenantId),
    columns: { industry: true },
  });

  const result = await resolveDashboardLayout(
    ctx.tenantId,
    ctx.userId,
    ctx.plan.name,
    tenant?.industry,
  );

  return NextResponse.json({ layout: result.layout, source: result.source });
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

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, ctx.tenantId),
    columns: { industry: true },
  });

  const result = await resolveDashboardLayout(
    ctx.tenantId,
    ctx.userId,
    ctx.plan.name,
    tenant?.industry,
  );

  return NextResponse.json({
    ok: true,
    layout: result.layout,
    source: result.source,
    message: 'Layout reset to default',
  });
}
