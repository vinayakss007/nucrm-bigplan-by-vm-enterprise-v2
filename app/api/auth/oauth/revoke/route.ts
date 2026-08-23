/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthTokens, oauthClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { timingSafeEqual } from 'crypto';

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

    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
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

    let deletedCount = 0;

    if (token) {
      if (tokenTypeHint === 'refresh_token') {
        const result = await db
          .delete(oauthTokens)
          .where(and(
            eq(oauthTokens.refreshToken, token),
            eq(oauthTokens.clientId, client.id)
          ));
        deletedCount = result.rowCount || 0;
      } else if (tokenTypeHint === 'access_token') {
        const result = await db
          .delete(oauthTokens)
          .where(and(
            eq(oauthTokens.accessToken, token),
            eq(oauthTokens.clientId, client.id)
          ));
        deletedCount = result.rowCount || 0;
      } else {
        const [byRefresh, byAccess] = await Promise.all([
          db
            .delete(oauthTokens)
            .where(and(
              eq(oauthTokens.refreshToken, token),
              eq(oauthTokens.clientId, client.id)
            )),
          db
            .delete(oauthTokens)
            .where(and(
              eq(oauthTokens.accessToken, token),
              eq(oauthTokens.clientId, client.id)
            ))
        ]);
        deletedCount = (byRefresh.rowCount || 0) + (byAccess.rowCount || 0);
      }
    }

    return NextResponse.json({ 
      ok: true, 
      revoked: deletedCount > 0 
    });
 
 
 
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[oauth/revoke POST]', msg);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Token revocation failed' },
      { status: 500 }
    );
  }
}