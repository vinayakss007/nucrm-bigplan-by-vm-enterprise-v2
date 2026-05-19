import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { oauthTokens, oauthClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
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

    if (!client || client.clientSecret !== clientSecret) {
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
  } catch (err: any) {
    console.error('[oauth/revoke POST]', err);
    return NextResponse.json(
      { error: 'server_error', error_description: err.message },
      { status: 500 }
    );
  }
}