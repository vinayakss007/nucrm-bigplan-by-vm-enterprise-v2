/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { invitations, tenants, users } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { withUserContext } from '@/lib/db/rls';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';
import { logError } from '@/lib/errors-server';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'invite-details', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const token = new URL(request.url).searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

    // #3182: the same contextless read that made /api/auth/accept-invite 404 for
    // a live invitation. This route is the screen the invite link lands on, so
    // the page never showed the workspace name and colour it exists to render —
    // a silent zero-row read, not an error. The read runs under 0133's credential
    // arm (SELECT-only, keyed on the token the caller already presented), and the
    // session check below under the proven identity's own context.
    const inv = await withPortalLookupContext({ accessToken: token }, (tx) =>
      tx
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
          isNull(invitations.deletedAt),
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
        const p = await getCurrentUserForToken(sessionToken);
        if (p) {
          // #3182: `users_read_self` compares `id` to `app.current_user`, and this
          // request had set no user GUC either — so the read returned nothing and
          // `isLoggedIn` was false for someone already signed in, which is the
          // "continue as this account" path this page exists to offer.
          // `withUserContext` sets the proven identity and no tenant, so the one
          // row the session already owns is the only one this can read.
          const u = await withUserContext(p.id, (tx) =>
            tx.query.users.findFirst({
              where: eq(users.id, p.id),
              columns: { email: true }
            })
          );
          isLoggedIn = u?.email?.toLowerCase() === inv.email.toLowerCase();
        }
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
