/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';
import { invitations, tenants } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { logError } from '@/lib/errors-server';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'invite-details', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const token = new URL(request.url).searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

    // #3182: `invitations` carries only `tenant_isolation`, and the workspace is
    // exactly what this read has to find, so the contextless pool read answered 0
    // rows and the invite page 404d "Invitation not found or has expired" for every
    // genuine link. 0133 gives this SELECT an arm on `app.portal_lookup_token`.
    const inv = await withPortalLookupContext({ accessToken: token }, (lookup) =>
      lookup
        .select({
          email: invitations.email,
          roleSlug: invitations.roleSlug,
          expiresAt: invitations.expiresAt,
          tenantName: tenants.name,
          primaryColor: tenants.primaryColor,
        })
        .from(invitations)
        .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
        .where(and(
          eq(invitations.token, token),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date())
        ))
        .then(res => res[0]));

    if (!inv) return NextResponse.json({ error: 'Invitation not found or has expired' }, { status: 404 });

    // Check if already logged in with matching email
    let isLoggedIn = false;
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get('nucrm_session')?.value;
      if (sessionToken) {
        // #2216: only count a live session, not a revoked-but-unexpired JWT.
        // #3182: the `users` re-read that used to follow is gone — it ran on the bare
        // pool, where `users_read_self` admits nothing without app.current_user, so it
        // answered undefined and `isLoggedIn` was permanently false. The session
        // already carries the verified email.
        const p = await getCurrentUserForToken(sessionToken);
        isLoggedIn = !!p?.email && p.email.toLowerCase() === inv.email.toLowerCase();
      }
    } catch (err) { logError({ error: err, context: "catch:[context]" }); }

    return NextResponse.json({
      email: inv.email, 
      role_slug: inv.roleSlug, 
      expires_at: inv.expiresAt,
      tenant_name: inv.tenantName, 
      primary_color: inv.primaryColor, 
      isLoggedIn,
    });
 
 
  } catch (err) {
    return apiError(err);
  }
}
