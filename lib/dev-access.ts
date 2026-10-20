/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Access gates for the development dashboard's endpoints (#2881).
 *
 * `app/api/dev/dashboard/route.ts` held its super-admin check as a module-private
 * function. When its two dead exports (`GET_QUERIES`, `GET_ERRORS` — names Next.js
 * never routes) become the real handlers the page has been calling, that check has
 * to be reachable from four route files, so it lives here. Route modules are leaves
 * of the graph: importing a sibling `route.ts` to borrow its helper is not a thing
 * the App Router asks you to do.
 *
 * Two gates, and they are not the same gate:
 *
 *   - `requireSuperAdmin` — who may read. `dashboard`'s GET uses it alone, on
 *     purpose: #1138 kept the deployment's configuration surface dev-only *inside*
 *     that response rather than shutting the whole endpoint outside development,
 *     so production super admins still get their stats. Moving the function here
 *     changes nothing about that.
 *   - `requireDevAccess` — who may read, and only while `NODE_ENV === 'development'`.
 *     The `logs` / `queries` / `errors` dumps are raw request, SQL and stack-trace
 *     buffers held in this process's memory (#2881). They were gated on the
 *     environment alone, which is a wall around an open door: any super-admin page
 *     in production would have streamed them. Requiring both is what the page's own
 *     banner ("Automatically disabled in production") already promises.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { and, eq, sql } from 'drizzle-orm';
// Statically, not `await import()` as `app/api/dev/dashboard/route.ts` had it: the
// page polls four endpoints at once, and a dynamic import inside the `try` below
// resolves to the real module for whichever call loses the race in Vitest — a gate
// that fails to load its own dependency reads everyone as a non-admin.
import { getCurrentUserForToken } from '@/lib/auth/session';

/**
 * Verify the session cookie names a live, non-deleted super-admin user.
 * `null` for anything else — absent cookie, revoked or logged-out token
 * (#2216), non-super-admin, or a failure while checking.
 */
export async function requireSuperAdmin(
  req: NextRequest,
): Promise<{ userId: string; isSuperAdmin: boolean } | null> {
  // Dev dashboard available in all environments — secured by super admin auth below
  try {
    const tokenCookie = req.cookies.get('nucrm_session')?.value;
    if (!tokenCookie) {
      return null;
    }

    // #2216: verifyToken alone keeps accepting revoked/logged-out JWTs until
    // they expire; getCurrentUserForToken also requires a live sessions row.
    const tokenUser = await getCurrentUserForToken(tokenCookie);
    if (!tokenUser) {
      return null;
    }

    const [user] = await db
      .select({ id: users.id, isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(and(eq(users.id, tokenUser.id), sql`deleted_at IS NULL`))
      .limit(1);

    if (!user || !user.isSuperAdmin) {
      return null;
    }

    return { userId: tokenUser.id, isSuperAdmin: true };
  } catch {
    // A gate that cannot check must refuse, not assume.
    return null;
  }
}

/**
 * The gate the dev-only data dumps answer to: development environment first, then
 * super admin. Returns a refusal to hand back, or the caller — same `instanceof
 * NextResponse` shape as `requireAuth`, so these reads look like every other route.
 */
export async function requireDevAccess(
  req: NextRequest,
): Promise<NextResponse | { userId: string }> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Development only' }, { status: 403 });
  }

  const admin = await requireSuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  return { userId: admin.userId };
}
