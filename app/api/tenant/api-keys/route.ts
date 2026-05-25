import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createApiKeySchema } from '@/lib/api/schemas';
import { generateApiKey } from '@/lib/auth/api-key';
import { db } from '@/drizzle/db';
import { apiKeys } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/tenant/api-keys
 * List all API keys for current tenant
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      key_prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      is_active: apiKeys.isActive,
      expires_at: apiKeys.expiresAt,
      last_used_at: apiKeys.lastUsedAt,
      created_at: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json({
      data: keys.map(k => ({
        ...k,
        // Never return full key, only prefix
        scopes: Array.isArray(k.scopes) ? k.scopes : [],
      })),
    });
  } catch (error: any) {
    console.error('[API Keys] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/api-keys
 * Create new API key
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
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
  } catch (error: any) {
    console.error('[API Keys] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
