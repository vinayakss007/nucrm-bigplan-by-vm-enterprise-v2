/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthClients, oauthCodes } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

/**
 * #3324: `oauth_clients.redirect_uris` is one `text` column, so the comparison this route used to
 * be — `stored.includes(requested)` — was `String.prototype.includes` with the registered value as
 * the haystack: it admitted any URL contained inside a registration and redirected there with the
 * authorization code attached. RFC 6749 §3.1.2 requires an exact match.
 *
 * Entries are split on `,` rather than compared against the column whole because a tenant registers
 * more than one URI by writing them into this one field; whole-string equality would lock such a
 * client out of every entry but its first. A URI that genuinely contains a comma loses its own
 * entry under that reading — accepted before this change too, since no parser existed — and the
 * trim is only for the `, `-joined form.
 */
function isRegisteredRedirectUri(stored: string, requested: string): boolean {
  if (!requested) return false;
  return stored.split(',').some((entry) => entry.trim() === requested);
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await checkRateLimit(request, { action: 'oauth-authorize', max: 20, windowMinutes: 1 });
    if (limited) return limited;

    // Require authentication — unauthenticated users cannot mint authorization codes
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('client_id');
    const redirectUri = searchParams.get('redirect_uri');
    const responseType = searchParams.get('response_type');
    const scope = searchParams.get('scope') || 'read:contacts write:contacts';
    const state = searchParams.get('state');

    if (!clientId || !redirectUri || !responseType) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing required parameters' },
        { status: 400 }
      );
    }

    if (responseType !== 'code') {
      return NextResponse.json(
        { error: 'unsupported_response_type', error_description: 'Only code response type is supported' },
        { status: 400 }
      );
    }

    const [client] = await db
      .select({
        // The only two fields this step can use. `client_secret` in particular:
        // this route authenticates nothing — anyone who can name a client_id
        // reaches this line — so it must not have the secret in scope on its way
        // to issuing a code.
        id: oauthClients.id,
        redirectUris: oauthClients.redirectUris,
      })
      .from(oauthClients)
      .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
      .limit(1);

    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Unknown client' },
        { status: 400 }
      );
    }

    if (!isRegisteredRedirectUri(client.redirectUris, redirectUri)) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Invalid redirect_uri' },
        { status: 400 }
      );
    }

    const code = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(oauthCodes).values({
      clientId: client.id,
      userId: ctx.userId,
      code,
      redirectUri,
      scope,
      expiresAt,
    });

    const params = new URLSearchParams({ code });
    if (state) params.set('state', state);

    return NextResponse.redirect(`${redirectUri}?${params.toString()}`);
 
 
 
  } catch (err: unknown) {
    void logError({ error: err, context: 'auth/oauth/authorize GET', requestUrl: request.url, requestMethod: request.method });
    return NextResponse.json(
      { error: 'server_error', error_description: 'Authorization failed' },
      { status: 500 }
    );
  }
});