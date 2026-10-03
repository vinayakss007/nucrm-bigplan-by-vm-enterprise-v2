/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessions } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { hashToken, verifyToken, clearSessionCookie } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/rls';
import { logger } from '@/lib/logger';

/**
 * Delete the caller's own sessions row so logout revokes server-side, not just
 * the cookie.
 *
 * `sessions` is FORCE ROW LEVEL SECURITY and `sessions_user_own` only matches
 * when app.current_user names the row's user_id. The previous code issued
 * db.delete() on the bare pool, where that GUC is empty: RLS matched zero rows,
 * the statement still reported success, the cookie was cleared and the client
 * got {ok:true} — while the token stayed valid in the database until its
 * natural expiry, so a replayed cookie kept authenticating after logout.
 *
 * Verifying the JWT first is what supplies the scoped context, so only a caller
 * holding a signature-valid token can revoke the session it names.
 */
async function revokeSessionRow(token: string): Promise<void> {
  const payload = await verifyToken(token).catch(() => null);
  const userId = payload?.userId;
  if (!userId) return;
  const tokenHash = await hashToken(token);
  const revoked = await withUserContext(userId, async (tx) =>
    await tx
      .delete(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.userId, userId)))
      .returning({ id: sessions.id })
  ).catch((err) => {
    logger.error('[auth/logout] session revoke failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (revoked !== null && revoked.length === 0) {
    // Loud on purpose: a zero-row revoke is the same silent failure this path
    // used to be, just observed instead of assumed.
    logger.warn('[auth/logout] sessions row still live after revoke attempt', { userId });
  }
}

export async function POST_logout(request: NextRequest) {
  try {
    const token = request.cookies.get('nucrm_session')?.value;
    if (token) {
      await revokeSessionRow(token);
    }
    await clearSessionCookie();
    const logoutResponse = NextResponse.json({ ok:true });
    logoutResponse.headers.set('Set-Cookie', 'nucrm_csrf_token=; Path=/; SameSite=Strict; Max-Age=0');
    return logoutResponse;
  } catch (e) {
    logger.error('[auth/logout] Logout error, clearing cookies anyway', { error: e instanceof Error ? e.message : String(e) });
    await clearSessionCookie();
    const logoutResponse = NextResponse.json({ ok:true });
    logoutResponse.headers.set('Set-Cookie', 'nucrm_csrf_token=; Path=/; SameSite=Strict; Max-Age=0');
    return logoutResponse;
  }
}
