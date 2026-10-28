/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { oauthClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';
import { newOAuthClientSecret } from '@/lib/auth/oauth-client';

/**
 * POST /api/tenant/oauth-clients/[id]/rotate
 *
 * This is what makes `client_secret` living in a plain text column survivable: the
 * value an admin cannot read back is one they can replace in one call. `client_id`
 * stays put — it is the public half, and the integrations pointing at it would break
 * for no security gain.
 *
 * Tokens already issued to this client are NOT revoked: the secret authenticates the
 * exchange, not the bearer of a minted token. Cutting those off is DELETE (their FK
 * cascades) or PATCH `is_active: false` on the row.
 */
export const POST = withApiRoute(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const limited = await rateLimitMutating(request, 'oauthClients', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const clientSecret = newOAuthClientSecret();
    const [rotated] = await db.update(oauthClients)
      .set({ clientSecret })
      .where(and(eq(oauthClients.id, id), eq(oauthClients.tenantId, ctx.tenantId)))
      .returning({ id: oauthClients.id, clientId: oauthClients.clientId, name: oauthClients.name });

    if (!rotated) return NextResponse.json({ error: 'OAuth client not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'rotate_oauth_client_secret',
      entityType: 'oauth_client',
      entityId: rotated.id,
      // Names the event without copying either the old or the new secret.
      newData: { client_id: rotated.clientId },
    });

    return NextResponse.json({
      ok: true,
      id: rotated.id,
      client_id: rotated.clientId,
      client_secret: clientSecret,
      warning: 'Store this secret now. It will never be shown again, and the previous one stopped working the moment this was issued.',
    });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients ROTATE', requestMethod: 'POST' });
    return apiError(error);
  }
});
