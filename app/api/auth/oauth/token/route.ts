import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthClients, oauthCodes, oauthTokens } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
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

    if (!client || client.clientSecret !== clientSecret) {
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

      await db
        .update(oauthCodes)
        .set({ usedAt: new Date() })
        .where(eq(oauthCodes.id, authCode.id));

      const [token] = await db
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

      await db.delete(oauthTokens).where(eq(oauthTokens.id, existingToken.id));

      const [newToken] = await db
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[oauth/token POST]', msg);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Token exchange failed' },
      { status: 500 }
    );
  }
}