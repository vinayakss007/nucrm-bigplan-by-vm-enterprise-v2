/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthClients, oauthCodes, oauthTokens } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit } from '@/lib/rate-limit';
import { timingSafeEqual } from 'crypto';
import { logError } from '@/lib/errors-server';
import { withAuthLookupContext, setTokenIssueContext, withOAuthClientLookupContext } from '@/lib/db/rls';

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'oauth-token', max: 20, windowMinutes: 1 });
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
    const grantType = formData.get('grant_type');
    const code = formData.get('code') as string;
    const clientId = formData.get('client_id') as string;
    const clientSecret = formData.get('client_secret') as string;
    const refreshToken = formData.get('refresh_token') as string;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing client credentials' },
        { status: 400 }
      );
    }

    // #3225: this read is what authenticated a *client*, and until 0136 there was no
    // policy that could admit its row. `oauth_clients` carried only 0088's
    // tenant_isolation, and a token exchange has no tenant — it is authorised by the
    // client secret, so nothing here ever sets app.current_tenant. Measured on the
    // local force-RLS dev database as the application role: 0 rows with no context,
    // 0 rows with app.auth_lookup alone, 1 row once the client's own tenant is named.
    // The endpoint therefore answered `401 invalid_client` for a correct id and a
    // correct secret — every grant it serves died on this statement.
    //
    // The context names the client id, not a credential: 0136's
    // oauth_clients_client_lookup arm compares client_id against app.oauth_client_id,
    // so this admits exactly the row whose id was just presented and no other client's
    // secret.
    const [client] = await withOAuthClientLookupContext(clientId, async (tx) =>
      await tx
        .select({
          // 2 of `oauth_clients`' 9 columns (measured via getTableColumns): the id
          // the tokens hang off, plus the secret this route exists to verify.
          // tenant_id, redirect_uris and created_by have no reader here.
          id: oauthClients.id,
          clientSecret: oauthClients.clientSecret,
        })
        .from(oauthClients)
        .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
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

    if (grantType === 'authorization_code') {
      if (!code) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Missing code' },
          { status: 400 }
        );
      }

      // #3218: the code is named in the lookup context, not just in the WHERE.
      // 0134's oauth_codes SELECT arm was gated on the boolean app.auth_lookup
      // alone, so this read saw every live code in the table and the WHERE below
      // was the only thing between that and enumerating other clients' codes.
      const [authCode] = await withAuthLookupContext(
        async (tx) =>
          await tx
            .select({
              // 5 of `oauth_codes`' 9 columns (measured via getTableColumns): id is the
              // UPDATE's target and usedAt the replay gate; userId + scope are the only
              // values that reach the inserted token; redirectUri is only compared. `code`
              // and clientId stay WHERE predicates.
              id: oauthCodes.id,
              userId: oauthCodes.userId,
              redirectUri: oauthCodes.redirectUri,
              scope: oauthCodes.scope,
              usedAt: oauthCodes.usedAt,
            })
            .from(oauthCodes)
            // authorize writes client_id onto the code it mints, so the binding is
            // already recorded — this just stops another authenticated client from
            // redeeming it (RFC 6749 §4.1.3). Without it a secret for client B turns a
            // code issued to client A into a token carrying A's user and scope.
            .where(and(
              eq(oauthCodes.code, code),
              eq(oauthCodes.clientId, client.id),
              gt(oauthCodes.expiresAt, new Date()),
            ))
            .limit(1),
        code,
      );

      if (!authCode || authCode.usedAt) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired code' },
          { status: 400 }
        );
      }

      // Same section: a redirect_uri sent with the authorization request must be
      // repeated here. Omitting it on both sides stays legal.
      const codeRedirectUri = formData.get('redirect_uri') as string | null;
      if (codeRedirectUri && codeRedirectUri !== authCode.redirectUri) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request' },
          { status: 400 }
        );
      }

      // #3075: the SELECT above is only a fast path — two concurrent redemptions
      // can both pass it. The claim is this conditional UPDATE: under READ
      // COMMITTED the second writer blocks on the row lock, then re-evaluates
      // `used_at IS NULL` against the committed row and claims zero rows.
      //
      // #3225: the mint is why `app.token_issue` has to be set for this whole
      // transaction. 0136's `oauth_tokens_token_issue` arm is the only INSERT grant
      // this path has — measured on the force-RLS dev database, the insert raised
      // `42501 new row violates row-level security policy` there, the claim rolled
      // back with it, and the caller got `500 server_error` on a valid code.
      //
      // It is inserted without `.returning()`, and the response is built from the two
      // uuids above rather than read back. RETURNING output is filtered by the table's
      // SELECT policies (0135's header carries that measurement), so reading the fresh
      // row would need a fourth arm naming a token this request minted itself — a
      // GUC for the privilege, and the route already holds the values it generated.
      const issuedAccessToken = uuidv4();
      const issuedRefreshToken = uuidv4();
      const redeemed = await db.transaction(async (tx) => {
        await setTokenIssueContext(tx, { credential: code });
        const [claimed] = await tx
          .update(oauthCodes)
          .set({ usedAt: new Date() })
          .where(and(
            eq(oauthCodes.id, authCode.id),
            isNull(oauthCodes.usedAt),
            gt(oauthCodes.expiresAt, new Date()),
          ))
          .returning({ id: oauthCodes.id });

        if (!claimed) return false;

        await tx.insert(oauthTokens).values({
          clientId: client.id,
          userId: authCode.userId,
          accessToken: issuedAccessToken,
          refreshToken: issuedRefreshToken,
          scope: authCode.scope,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        });

        return true;
      });

      if (!redeemed) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired code' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        access_token: issuedAccessToken,
        refresh_token: issuedRefreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: authCode.scope,
      });
    }

    if (grantType === 'refresh_token') {
      if (!refreshToken) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Missing refresh token' },
          { status: 400 }
        );
      }

      // #3075: claim and rotate in one transaction — the conditional DELETE is
      // the lock. The old SELECT-then-DELETE let two concurrent refreshes with
      // the same token both pass the lookup and each mint a replacement,
      // doubling the live refresh-token set. Under READ COMMITTED the second
      // DELETE blocks on the row lock, then re-evaluates its predicates
      // against the committed row and claims zero rows.
      //
      // #3225: it needed a context to run in. This transaction set no GUC at all, so
      // the DELETE had no policy that could admit the presented row: measured on the
      // force-RLS dev database it matched 0 rows and the row was still live when read
      // back as the owner — which the handler reported as `invalid_grant` while the
      // refresh token stayed valid indefinitely, the exact opposite of rotation and
      // #3075's replay defence unenforced here. `app.token_credential` is the
      // presented token, so 0136's claim arms admit that one row and no other; the
      // read arm alongside them is what the DELETE's own USING and its RETURNING both
      // have to pass.
      //
      // Not `setUserContext(consumed.userId)` — that works (measured: `oauth_tokens_user_own`
      // is an ALL policy, and its USING doubles as the WITH CHECK) but it opens every
      // `*_own` policy in the schema for a request that authenticated a client, not a
      // person. See 0136's header.
      const issuedAccessToken = uuidv4();
      const issuedRefreshToken = uuidv4();
      const rotated = await db.transaction(async (tx) => {
        await setTokenIssueContext(tx, { credential: refreshToken });
        const [consumed] = await tx
          .delete(oauthTokens)
          .where(and(
            eq(oauthTokens.refreshToken, refreshToken),
            // Rotation stays inside the client that minted the token: a refresh
            // token leaked to a second client must not keep working under that
            // client's own secret.
            eq(oauthTokens.clientId, client.id),
            gt(oauthTokens.expiresAt, new Date()),
          ))
          // userId + scope are the only columns carried onto the replacement;
          // refreshToken and clientId are WHERE predicates only.
          .returning({
            userId: oauthTokens.userId,
            scope: oauthTokens.scope,
          });

        if (!consumed) return null;

        // Inserted without `.returning()` — see the authorization_code branch above.
        // The scope is the one the consumed row carried, which the DELETE read back.
        await tx.insert(oauthTokens).values({
          clientId: client.id,
          userId: consumed.userId,
          accessToken: issuedAccessToken,
          refreshToken: issuedRefreshToken,
          scope: consumed.scope,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        });

        return { scope: consumed.scope };
      });

      if (rotated === null) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired refresh token' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        access_token: issuedAccessToken,
        refresh_token: issuedRefreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: rotated.scope,
      });
    }

    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Unsupported grant type' },
      { status: 400 }
    );
 
 
 
  } catch (err: unknown) {
    void logError({ error: err, context: 'auth/oauth/token POST', requestUrl: request.url, requestMethod: request.method });
    return NextResponse.json(
      { error: 'server_error', error_description: 'Token exchange failed' },
      { status: 500 }
    );
  }
}