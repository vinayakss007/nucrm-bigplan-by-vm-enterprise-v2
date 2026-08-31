/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthClients, oauthCodes, oauthTokens } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit } from '@/lib/rate-limit';
import { timingSafeEqual } from 'crypto';
import { logError } from '@/lib/errors-server';

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
      .select()
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

      const [authCode] = await db
        .select()
        .from(oauthCodes)
        .where(and(eq(oauthCodes.code, code), gt(oauthCodes.expiresAt, new Date())))
        .limit(1);

      if (!authCode || authCode.usedAt) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired code' },
          { status: 400 }
        );
      }

      const [token] = await db.transaction(async (tx) => {
        await tx
          .update(oauthCodes)
          .set({ usedAt: new Date() })
          .where(eq(oauthCodes.id, authCode.id));

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
          .returning();
      });

      if (!token) {
        return NextResponse.json(
          { error: 'server_error', error_description: 'Failed to create token' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        access_token: token!.accessToken,
        refresh_token: token!.refreshToken,
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

      const [existingToken] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.refreshToken, refreshToken))
        .limit(1);

      if (!existingToken || existingToken.expiresAt < new Date()) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid or expired refresh token' },
          { status: 400 }
        );
      }

      const [newToken] = await db.transaction(async (tx) => {
        await tx.delete(oauthTokens).where(eq(oauthTokens.id, existingToken.id));

        return tx
          .insert(oauthTokens)
          .values({
            clientId: client.id,
            userId: existingToken.userId,
            accessToken: uuidv4(),
            refreshToken: uuidv4(),
            scope: existingToken.scope,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          })
          .returning();
      });

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
        scope: existingToken.scope,
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