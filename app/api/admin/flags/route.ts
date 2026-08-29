/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { getAllFlags, isEnabled, setOverride, deleteOverride, DEFINED_FLAGS } from '@/lib/flags';
import { readJsonBody } from '@/lib/api/validate';

// #1615: withApiRoute pins ONE connection for the whole handler body so the
// auth check's setTenantContext() and every db query below share it and RLS
// stays enforced. No-op under PgBouncer.
export const GET = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const flags = await getAllFlags();
  return NextResponse.json({ flags });
});

export const POST = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const body = await readJsonBody(request);
  const { key, enabled, tenantIds, userIds, percentage } = body;

  const def = DEFINED_FLAGS.find(f => f.key === key);
  if (!def) {
    return NextResponse.json({ error: `Unknown flag: ${key}` }, { status: 400 });
  }

  await setOverride(key, { enabled, tenantIds, userIds, percentage });
  return NextResponse.json({
    key,
    enabled: await isEnabled(key),
    override: { enabled, tenantIds, userIds, percentage },
  });
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  await deleteOverride(key);
  return NextResponse.json({ key, enabled: await isEnabled(key) });
});
