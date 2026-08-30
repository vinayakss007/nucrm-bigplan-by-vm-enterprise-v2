/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { createGoogleCalendarProvider } from '@/lib/calendar-sync/google';
import { saveIntegrationConfig } from '@/lib/calendar-sync/service';
import { verifyOAuthState } from '@/lib/calendar-sync/state';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/tenant/calendar?error=${error}`, request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=missing_code', request.url));
    }

    // #1175: verify the HMAC signature before comparing — rejects forged/unsigned state
    if (!verifyOAuthState(state)) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=bad_state', request.url));
    }

    // Verify state matches the signed one stored in the session cookie
    const storedState = request.cookies.get('oauth_state')?.value;
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=bad_state', request.url));
    }

    // Extract tenantId and userId from the session (not from the state parameter)
    // The session cookie contains the authenticated user's context
    const sessionCookie = request.cookies.get('nucrm_session')?.value;
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=not_authenticated', request.url));
    }

    // For now, we'll use the state to look up the pending OAuth request
    // In a production system, you'd verify the state against a stored record
    const { verifyToken } = await import('@/lib/auth/session');
    const payload = await verifyToken(sessionCookie);
    if (!payload) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=invalid_session', request.url));
    }

    const userId = payload.userId;

    // Resolve the user's active tenant membership (JWT only carries userId)
    const { db } = await import('@/drizzle/db');
    const { tenantMembers } = await import('@/drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const [membership] = await db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, userId))
      .limit(1);
    if (!membership) {
      return NextResponse.redirect(new URL('/tenant/calendar?error=no_tenant', request.url));
    }
    const tenantId = membership.tenantId;

    const provider = createGoogleCalendarProvider();
    const tokens = await provider.exchangeCode(code, `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/calendar-sync/google/callback`);

    await saveIntegrationConfig(tenantId, userId, 'google', tokens);

    // Clear the OAuth state cookie
    const response = NextResponse.redirect(new URL('/tenant/calendar?connected=google', request.url));
    response.cookies.set('oauth_state', '', { maxAge: 0, path: '/' });

    return response;
  } catch (err) {
    void logError({ error: err, context: 'tenant/calendar-sync/google/callback' });
    return NextResponse.redirect(new URL('/tenant/calendar?error=callback_failed', request.url));
  }
}
