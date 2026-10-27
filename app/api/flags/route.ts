/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllFlags } from '@/lib/flags';
import { tenantMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { withUserContext } from '@/lib/db/rls';

export async function GET(request: NextRequest) {
  // #1154: throttle this unauthenticated endpoint to prevent mass enumeration.
  const limited = await checkRateLimit(request, { action: 'flags', max: 30, windowMinutes: 1 });
  if (limited) return limited;

  // Verify authentication before trusting X-Tenant-ID header
  const sessionCookie = request.cookies.get('nucrm_session')?.value;
  const authHeader = request.headers.get('authorization');

  let userId: string | undefined;

  if (sessionCookie) {
    // #3288: this branch read `sessions` on the bare pool to turn a token hash back into a
    // user id. sessions_user_own (0088, FOR ALL) keys on app.current_user — the value this
    // read exists to establish — so on a connection with every app.* GUC cleared it matched
    // zero rows, `userId` stayed undefined, and the #1150 anonymous branch below answered
    // {flags:{}} to a signed-in browser. Nothing errored; the flags simply were not there.
    //
    // The Bearer branch of this same handler already went through getCurrentUserForToken for
    // both reasons at once (#2216: verifyToken alone accepts a revoked JWT; the helper opens
    // withAuthResolutionContext, which is the only context that can read the session row).
    // The cookie is the same credential in a different envelope, so it is redeemed the same
    // way — one path, revoked-session checks included.
    const { getCurrentUserForToken } = await import('@/lib/auth/session');
    const user = await getCurrentUserForToken(sessionCookie);
    if (user) {
      userId = user.id;
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
    // #3186: the #2446 shape on a caller this route already verified — the
    // membership probe read `tenant_members` on the bare pool, where neither
    // `app.current_tenant` (tenant_isolation) nor `app.current_user`
    // (0127's `tenant_members_self_read`) is set, so the policy deparse to zero
    // rows and every X-Tenant-ID request answered 403 "Not a member of this
    // tenant" no matter what the table says. The GUC this read is scoped by is
    // the caller's own id, which is exactly what `withUserContext` sets.
    const membership = await withUserContext(userId, (tx) =>
      tx.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.userId, userId),
          eq(tenantMembers.status, 'active'),
        ))
        .limit(1));
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
