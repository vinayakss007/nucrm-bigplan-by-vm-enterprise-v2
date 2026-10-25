/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthTokens, oauthClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { timingSafeEqual } from 'crypto';
import { logError } from '@/lib/errors-server';
import { withOAuthClientLookupContext, withTokenIssueContext, type RlsTransaction } from '@/lib/db/rls';

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'oauth-revoke', max: 20, windowMinutes: 1 });
    if (limited) return limited;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Request body must be application/x-www-form-urlencoded' },
        { status: 400 }
      );
    }
    const token = formData.get('token') as string;
    const tokenTypeHint = formData.get('token_type_hint') as string;
    const clientId = formData.get('client_id') as string;
    const clientSecret = formData.get('client_secret') as string;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing client credentials' },
        { status: 400 }
      );
    }

    // #3231: this is 0136's `oauth_clients_client_lookup` arm with no context set in
    // front of it — measured as the application role on the force-RLS dev database, 0
    // rows with no GUCs and 1 row once app.auth_lookup + app.oauth_client_id name the
    // presented client id. A correct id and a correct secret therefore answered
    // `401 invalid_client`, the same first-statement death #3225 fixed for /token.
    // The arm admits exactly the row whose id was presented, so it cannot be used to
    // read another client's secret.
    const [client] = await withOAuthClientLookupContext(clientId, async (tx) =>
      await tx
        .select({
          // The two fields this step can use: the id that scopes the delete and the
          // secret being verified. Unlike /token and /authorize this lookup has no
          // `is_active` filter, so the flag is not available to name anyway — that
          // asymmetry is a behaviour question, not a projection one.
          id: oauthClients.id,
          clientSecret: oauthClients.clientSecret,
        })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1));

    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 401 }
      );
    }

    // Timing-safe comparison to prevent timing attacks
    const storedSecret = Buffer.from(client.clientSecret);
    const providedSecret = Buffer.from(clientSecret);
    if (storedSecret.length !== providedSecret.length || !timingSafeEqual(storedSecret, providedSecret)) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 401 }
      );
    }

    let deletedCount = 0;

    if (token) {
      // #3231: the DELETE needed a context to run in. With none, it matched nothing and
      // the row stayed live — measured as a committed `DELETE … WHERE refresh_token = …
      // AND client_id = …` claiming 0 rows while the owner still read the token back (1).
      // The handler took `result.rowCount || 0` and answered `{"ok":true,"revoked":false}`
      // over a grant that was still minting access tokens: #3075's silent zero-row write,
      // in the one endpoint whose whole job is to prevent that outcome.
      //
      // One context covers all three branches. `app.token_credential` carries the
      // presented token and each claim arm matches it against exactly one column —
      // `refresh_token` for 0136's pair, `access_token` for 0137's — so the no-hint
      // branch, which tries both columns with the same value, needs no second one: the
      // column the value does not live in claims `DELETE 0` rather than raising, because
      // a DELETE has no WITH CHECK, only the USING that decides which rows are visible
      // to be deleted. The `client_id` predicate stays in the query: the arms admit the
      // credential's row, and this still refuses to revoke a token another client minted.
      const byRefresh = (tx: RlsTransaction) =>
        tx
          .delete(oauthTokens)
          .where(and(
            eq(oauthTokens.refreshToken, token),
            eq(oauthTokens.clientId, client.id)
          ));
      const byAccess = (tx: RlsTransaction) =>
        tx
          .delete(oauthTokens)
          .where(and(
            eq(oauthTokens.accessToken, token),
            eq(oauthTokens.clientId, client.id)
          ));

      deletedCount = await withTokenIssueContext(async (tx) => {
        const claims = tokenTypeHint === 'refresh_token'
          ? [byRefresh(tx)]
          : tokenTypeHint === 'access_token'
            ? [byAccess(tx)]
            : [byRefresh(tx), byAccess(tx)];
        const results = await Promise.all(claims);
        return results.reduce((won, result) => won + (result.rowCount || 0), 0);
      }, { credential: token });
    }

    return NextResponse.json({ 
      ok: true, 
      revoked: deletedCount > 0 
    });
 
 
 
  } catch (err: unknown) {
    void logError({ error: err, context: 'auth/oauth/revoke POST', requestUrl: request.url, requestMethod: request.method });
    return NextResponse.json(
      { error: 'server_error', error_description: 'Token revocation failed' },
      { status: 500 }
    );
  }
}