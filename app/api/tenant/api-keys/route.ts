/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createApiKeySchema } from '@/lib/api/schemas';
import { generateApiKey } from '@/lib/auth/api-key';
import { db } from '@/drizzle/db';
import { apiKeys, tenantMembers } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

/**
 * GET /api/tenant/api-keys
 * List all API keys for current tenant
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // #3291: the listing joins the owner's membership so an admin can see the
    // exposure instead of discovering it in a post-incident review. One round trip,
    // and `orphaned` keys off the same predicate the auth path uses
    // (lib/auth/api-key-membership.ts: status = 'active', not soft-deleted), so the
    // report and the enforcement cannot drift apart. RLS does the scoping for the
    // joined row — a key whose owner left the workspace simply has no match.
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      key_prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      is_active: apiKeys.isActive,
      expires_at: apiKeys.expiresAt,
      last_used_at: apiKeys.lastUsedAt,
      created_at: apiKeys.createdAt,
      memberStatus: tenantMembers.status,
      memberDeletedAt: tenantMembers.deletedAt,
    })
    .from(apiKeys)
    .leftJoin(tenantMembers, and(
      eq(tenantMembers.tenantId, apiKeys.tenantId),
      eq(tenantMembers.userId, apiKeys.userId),
    ))
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({
      data: keys.map(({ memberStatus, memberDeletedAt, ...k }) => ({
        ...k,
        // Never return full key, only prefix
        scopes: Array.isArray(k.scopes) ? k.scopes : [],
        orphaned: memberStatus !== 'active' || memberDeletedAt !== null,
      })),
    });
 
 
  } catch (error) {
    await logError({ error, context: 'API Keys GET', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/api-keys
 * Create new API key
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'apiKeys', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(createApiKeySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const expires_in_days = body.expires_in_days;

    // Calculate expiry date
    let expiresAt = null;
    if (expires_in_days && typeof expires_in_days === 'number') {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    // Generate key (expiry passed directly to INSERT, no separate UPDATE needed)
    const { key, prefix } = await generateApiKey(
      ctx.tenantId,
      ctx.userId,
      v.name,
      v.scopes,
      expiresAt ? expiresAt.toISOString() : null
    );

    return NextResponse.json({
      ok: true,
      key,
      prefix,
      warning: 'Store this key securely. It will not be shown again.',
    }, { status: 201 });
 
 
  } catch (error) {
    await logError({ error, context: 'API Keys POST', requestMethod: 'POST' });
    return apiError(error);
  }
});
