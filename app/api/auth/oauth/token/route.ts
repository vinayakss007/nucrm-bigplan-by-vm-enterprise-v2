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
import { withAuthLookupContext, setTokenIssueContext } from '@/lib/db/rls';

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

    const [client] = await db
      .select({
        // 2 of `oauth_clients`' 9 columns (measured via getTableColumns): the id
        // the tokens hang off, plus the secret this route exists to verify.
        // tenant_id, redirect_uris and created_by have no reader here.
        id: oauthClients.id,
        clientSecret: oauthClients.clientSecret,
      })
      .from(oauthClients)
      .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
      .limit(1);

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

      const [authCode] = await withAuthLookupContext(async (tx) =>
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
          .limit(1)
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
      const redemption = await db.transaction(async (tx) => {
        await setTokenIssueContext(tx);
        const [claimed] = await tx
          .update(oauthCodes)
          .set({ usedAt: new Date() })
          .where(and(
            eq(oauthCodes.id, authCode.id),
            isNull(oauthCodes.usedAt),
            gt(oauthCodes.expiresAt, new Date()),
          ))
          .returning({ id: oauthCodes.id });

        if (!claimed) return null;

        return tx
          .insert(oauthTokens)
          .values({
            clientId: client.id,
            userId: authCode.userId,
            accessToken: uuidv4(),
            refreshToken: uuidv4(),
            scope: authCode.scope,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          })
          // The response is built from these two fields alone — this is the
          // OAuth token endpoint, so RETURNING * would hand the caller columns
          // it never asked for.
          .returning({
            accessToken: oauthTokens.accessToken,
            refreshToken: oauthTokens.refreshToken,
          });
      });

      if (redemption === null) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired code' },
          { status: 400 }
        );
      }

      const token = redemption[0];
      if (!token) {
        return NextResponse.json(
          { error: 'server_error', error_description: 'Failed to create token' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
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
      const rotated = await db.transaction(async (tx) => {
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

        return tx
          .insert(oauthTokens)
          .values({
            clientId: client.id,
            userId: consumed.userId,
            accessToken: uuidv4(),
            refreshToken: uuidv4(),
            scope: consumed.scope,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          })
          // The response is built from these fields alone — this is the OAuth
          // token endpoint, so RETURNING * would hand the caller columns it
          // never asked for.
          .returning({
            accessToken: oauthTokens.accessToken,
            refreshToken: oauthTokens.refreshToken,
            scope: oauthTokens.scope,
          });
      });

      if (rotated === null) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired refresh token' },
          { status: 400 }
        );
      }

      const newToken = rotated[0];
      if (!newToken) {
        return NextResponse.json(
          { error: 'server_error', error_description: 'Failed to create token' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        access_token: newToken.accessToken,
        refresh_token: newToken.refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: newToken.scope,
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