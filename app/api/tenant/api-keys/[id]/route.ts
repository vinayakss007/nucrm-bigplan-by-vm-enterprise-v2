import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { revokeApiKey, rotateApiKey, getApiKeyUsage } from '@/lib/auth/api-key';
import { db } from '@/drizzle/db';
import { apiKeys } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/tenant/api-keys/[id]
 * Get API key details and usage stats
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const key = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), eq(apiKeys.tenantId, ctx.tenantId)),
      columns: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        isActive: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      }
    });

    if (!key) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Get usage stats (last 7 days)
    const usage = await getApiKeyUsage(id, 7);

    return NextResponse.json({
      data: {
        ...key,
        key_prefix: key.prefix,
        is_active: key.isActive,
        expires_at: key.expiresAt,
        last_used_at: key.lastUsedAt,
        created_at: key.createdAt,
        scopes: Array.isArray(key.scopes) ? key.scopes : [],
        usage,
      },
    });
  } catch (error: any) {
    console.error('[API Keys] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/api-keys/[id]
 * Revoke (delete) API key
 */
export async function DELETE(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const revoked = await revokeApiKey(id, ctx.tenantId);
    if (!revoked) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: 'API key revoked' });
  } catch (error: any) {
    console.error('[API Keys] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/api-keys/[id]/rotate
 * Rotate API key (revoke old, create new)
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    // Get existing key info
    const existingKey = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, id), eq(apiKeys.tenantId, ctx.tenantId)),
      columns: { name: true, scopes: true }
    });

    if (!existingKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Rotate key
    const result = await rotateApiKey(
      id,
      ctx.tenantId,
      ctx.userId,
      existingKey.name,
      Array.isArray(existingKey.scopes) ? (existingKey.scopes as string[]) : []
    );

    if (!result) {
      return NextResponse.json({ error: 'Failed to rotate key' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      key: result.key,
      prefix: result.prefix,
      warning: 'Store this key securely. It will not be shown again. The old key is now invalid.',
    });
  } catch (error: any) {
    console.error('[API Keys] ROTATE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
