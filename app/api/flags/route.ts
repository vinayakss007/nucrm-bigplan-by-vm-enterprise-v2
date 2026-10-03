/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllFlags } from '@/lib/flags';
import { db } from '@/drizzle/db';
import { sessions, tenantMembers } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  // #1154: throttle this unauthenticated endpoint to prevent mass enumeration.
  const limited = await checkRateLimit(request, { action: 'flags', max: 30, windowMinutes: 1 });
  if (limited) return limited;

  // Verify authentication before trusting X-Tenant-ID header
  const sessionCookie = request.cookies.get('nucrm_session')?.value;
  const authHeader = request.headers.get('authorization');

  let userId: string | undefined;

  if (sessionCookie) {
    const { verifyToken, hashToken } = await import('@/lib/auth/session');
    const payload = await verifyToken(sessionCookie);
    if (payload) {
      const tokenHash = await hashToken(sessionCookie);
      const results = await db.select({ userId: sessions.userId })
        .from(sessions)
        .where(and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
        ))
        .limit(1);
      if (results[0]) {
        userId = results[0].userId;
      }
    }
  } else if (authHeader?.startsWith('Bearer ')) {
    // #2216: verifyToken alone accepts JWTs whose session was revoked
    // (logout/admin-kill) for the full 30-day token lifetime — go through
    // getCurrentUserForToken so the sessions row check applies here too.
    const { getCurrentUserForToken } = await import('@/lib/auth/session');
    const user = await getCurrentUserForToken(authHeader.slice(7));
    if (user) {
      userId = user.id;
    }
  }
  // #1150: only authenticated callers receive the flag set. Returning flags to
  // anonymous callers leaked the internal feature roadmap and the
  // maintenance-mode kill-switch state, aiding reconnaissance. Unauthenticated
  // callers get an empty map.
  if (!userId) {
    return NextResponse.json({ flags: {} });
  }

  // #2221: X-Tenant-ID is attacker-controlled. The gateway validates
  // tenant_members for the same header (lib/api/gateway.ts) before honoring
  // it; without the same check here any authenticated user could enumerate
  // other tenants' flag overrides / kill-switch state.
  const tenantId = request.headers.get('x-tenant-id') || undefined;
  if (tenantId) {
    const membership = await db.select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.status, 'active'),
      ))
      .limit(1);
    if (!membership[0]) {
      return NextResponse.json({ error: 'Not a member of this tenant' }, { status: 403 });
    }
  }

  const flags = await getAllFlags({ tenantId, userId });
  const map: Record<string, boolean> = {};
  for (const f of flags) {
    map[f.key] = f.enabled;
  }
  return NextResponse.json({ flags: map });
}
