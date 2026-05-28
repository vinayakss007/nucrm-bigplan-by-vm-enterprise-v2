import { NextRequest, NextResponse } from 'next/server';
import { apiError, badRequest } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customPlugins } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { PluginAuthType, PluginAction, PluginAuthConfig } from '@/lib/plugins/types';

const VALID_AUTH_TYPES: PluginAuthType[] = ['bearer', 'basic', 'api_key_header', 'api_key_query', 'oauth2_client_credentials', 'none'];

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const plugins = await db.select()
      .from(customPlugins)
      .where(and(eq(customPlugins.tenantId, ctx.tenantId), isNull(customPlugins.deletedAt)))
      .orderBy(desc(customPlugins.createdAt));

    const data = plugins.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      userId: p.userId,
      name: p.name,
      description: p.description,
      icon: p.icon,
      baseUrl: p.baseUrl,
      authType: p.authType,
      actions: p.actions as PluginAction[],
      status: p.status,
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      lastError: p.lastError,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json({ data });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json() as Record<string, unknown>;

    // Validate required fields
    const name = body['name'] as string | undefined;
    const baseUrl = body['baseUrl'] as string | undefined;
    const authType = body['authType'] as PluginAuthType | undefined;

    if (!name || !baseUrl) {
      return badRequest('name and baseUrl are required');
    }

    if (authType && !VALID_AUTH_TYPES.includes(authType)) {
      return badRequest(`Invalid authType. Must be one of: ${VALID_AUTH_TYPES.join(', ')}`);
    }

    // Validate URL format
    try {
      new URL(baseUrl);
    } catch {
      return badRequest('baseUrl must be a valid URL');
    }

    const actions = (body['actions'] as PluginAction[] | undefined) ?? [];
    const authConfig = (body['authConfig'] as PluginAuthConfig | undefined) ?? { type: 'none' };
    const customHeaders = (body['customHeaders'] as Record<string, string> | undefined) ?? {};

    const [row] = await db.insert(customPlugins).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name,
      description: (body['description'] as string) ?? null,
      icon: (body['icon'] as string) ?? null,
      baseUrl,
      authType: authType ?? 'none',
      authConfig,
      customHeaders,
      actions,
      webhookSecret: (body['webhookSecret'] as string) ?? null,
      status: 'active',
    }).returning();

    if (!row) {
      return NextResponse.json({ error: 'Failed to create plugin' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        authType: row.authType,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}
