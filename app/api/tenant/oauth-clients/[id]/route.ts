/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateOAuthClientSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { oauthClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { apiError } from '@/lib/api-error';
import { serializeRedirectUris, parseRedirectUris } from '@/lib/auth/oauth-client';

const shape = {
  id: oauthClients.id,
  name: oauthClients.name,
  client_id: oauthClients.clientId,
  redirect_uris: oauthClients.redirectUris,
  is_active: oauthClients.isActive,
  created_at: oauthClients.createdAt,
};

/**
 * PATCH /api/tenant/oauth-clients/[id] — rename, re-register URIs, or deactivate.
 *
 * Deactivating is the kill switch that does not destroy evidence: `authorize` and
 * `token` both filter on `is_active`, so a retired client stops authenticating while
 * its row, its name and its audit trail stay for whoever asks what was connected.
 * There is no concurrency guard here because `oauth_clients` has no `updated_at` to
 * compare against — the same reason #680's sweep skipped this table.
 */
export const PATCH = withApiRoute(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const limited = await rateLimitMutating(request, 'oauthClients', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const body = await readJsonBody(request);
    const validated = validateBody(updateOAuthClientSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const patch: Partial<{ name: string; redirectUris: string; isActive: boolean }> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.redirect_uris !== undefined) patch.redirectUris = serializeRedirectUris(v.redirect_uris);
    if (v.is_active !== undefined) patch.isActive = v.is_active;
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const [row] = await db.update(oauthClients)
      .set(patch)
      .where(and(eq(oauthClients.id, id), eq(oauthClients.tenantId, ctx.tenantId)))
      .returning(shape);

    if (!row) return NextResponse.json({ error: 'OAuth client not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update_oauth_client',
      entityType: 'oauth_client',
      entityId: row.id,
      newData: { fields: Object.keys(patch) },
    });

    return NextResponse.json({
      data: { ...row, redirect_uris: parseRedirectUris(row.redirect_uris) },
    });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients PATCH', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

/**
 * DELETE /api/tenant/oauth-clients/[id]
 *
 * Hard delete, and it is not row-local: `oauth_codes` and `oauth_tokens` both FK to
 * this row `ON DELETE CASCADE` (0002:1351, 0002:1355), so one call revokes every live
 * authorization code and every issued access/refresh token of the client. That is why
 * deactivating exists — keep the row and the trail, stop the credential.
 */
export const DELETE = withApiRoute(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const limited = await rateLimitMutating(request, 'oauthClients', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const [gone] = await db.delete(oauthClients)
      .where(and(eq(oauthClients.id, id), eq(oauthClients.tenantId, ctx.tenantId)))
      .returning({ id: oauthClients.id, clientId: oauthClients.clientId, name: oauthClients.name });

    if (!gone) return NextResponse.json({ error: 'OAuth client not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete_oauth_client',
      entityType: 'oauth_client',
      entityId: gone.id,
      oldData: { name: gone.name, client_id: gone.clientId },
    });

    return NextResponse.json({
      success: true,
      message: 'OAuth client deleted. Its authorization codes and issued tokens were revoked with it.',
    });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients DELETE', requestMethod: 'DELETE' });
    return apiError(error);
  }
});

/**
 * GET /api/tenant/oauth-clients/[id] — the row the settings drawer shows, secret-free.
 */
export const GET = withApiRoute(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const [row] = await db.select(shape)
      .from(oauthClients)
      .where(and(eq(oauthClients.id, id), eq(oauthClients.tenantId, ctx.tenantId)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'OAuth client not found' }, { status: 404 });

    return NextResponse.json({ data: { ...row, redirect_uris: parseRedirectUris(row.redirect_uris) } });
  } catch (error) {
    await logError({ error, context: 'OAuth Clients GET one', requestMethod: 'GET' });
    return apiError(error);
  }
});
