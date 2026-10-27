/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { registerOAuthClientSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { oauthClients } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';
import {
  newOAuthClientId, newOAuthClientSecret, serializeRedirectUris, parseRedirectUris,
} from '@/lib/auth/oauth-client';

/**
 * GET /api/tenant/oauth-clients — this workspace's registered clients.
 *
 * `client_secret` is not in the projection: #3328's whole one-time-reveal story
 * depends on the list endpoint being unable to hand a secret back, and a column
 * that is not selected cannot leak through a later `...row` spread.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const rows = await db.select({
      id: oauthClients.id,
      name: oauthClients.name,
      client_id: oauthClients.clientId,
      redirect_uris: oauthClients.redirectUris,
      is_active: oauthClients.isActive,
      created_at: oauthClients.createdAt,
    })
      .from(oauthClients)
      .where(eq(oauthClients.tenantId, ctx.tenantId))
      .orderBy(desc(oauthClients.createdAt));

    return NextResponse.json({
      data: rows.map((r) => ({ ...r, redirect_uris: parseRedirectUris(r.redirect_uris) })),
    });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/oauth-clients — register a confidential client.
 *
 * Both credentials are minted here (`lib/auth/oauth-client.ts`), never accepted from the
 * caller: `client_id` carries a unique constraint, so taking it as input would let an
 * admin bid for an id another workspace might want, and a caller-chosen secret is a
 * secret that passed through a log, a browser extension and a form autofill on the way in.
 *
 * The response is the only place the secret exists after this request: it is stored
 * verbatim because `app/api/auth/oauth/token` compares it with `timingSafeEqual`, and it
 * is not read back with `.returning()` for the same reason the token route avoids that.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'oauthClients', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(registerOAuthClientSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { name, redirect_uris: redirectUris } = validated.data;

    const clientId = newOAuthClientId();
    const clientSecret = newOAuthClientSecret();

    const [created] = await db.insert(oauthClients).values({
      tenantId: ctx.tenantId,
      clientId,
      clientSecret,
      name,
      redirectUris: serializeRedirectUris(redirectUris),
      isActive: true,
      createdBy: ctx.userId,
    }).returning({ id: oauthClients.id, clientId: oauthClients.clientId });

    // 0 rows is RLS refusing the write, not an empty result: 0088's tenant_isolation
    // WITH CHECK rejects a row whose tenant_id is not the session's, and `ctx.tenantId`
    // is that value — so getting here means the context and the caller disagreed.
    if (!created) {
      await logError({
        error: new Error('oauth_clients insert matched no row'),
        context: 'OAuth Clients POST', requestMethod: 'POST',
      });
      return NextResponse.json(
        { error: 'Could not register the client — the workspace context refused the write' },
        { status: 500 },
      );
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create_oauth_client',
      entityType: 'oauth_client',
      entityId: created.id,
      // The secret is deliberately absent: an audit trail of who holds which credential
      // is a second copy of every credential.
      newData: { name, client_id: created.clientId, redirect_uris: redirectUris },
    });

    return NextResponse.json({
      ok: true,
      id: created.id,
      client_id: clientId,
      client_secret: clientSecret,
      name,
      redirect_uris: redirectUris,
      warning: 'Store this secret now. It will never be shown again — rotating is the only way to get a new one.',
    }, { status: 201 });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients POST', requestMethod: 'POST' });
    return apiError(error);
  }
});
