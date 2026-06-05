import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customPlugins } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { testPluginConnection } from '@/lib/plugins/engine';
import type { PluginDefinition, PluginAction, PluginAuthConfig } from '@/lib/plugins/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await context.params;

    const [plugin] = await db.select()
      .from(customPlugins)
      .where(and(
        eq(customPlugins.id, id),
        eq(customPlugins.tenantId, ctx.tenantId),
        isNull(customPlugins.deletedAt)
      ))
      .limit(1);

    if (!plugin) {
      return notFound('Plugin');
    }

    const pluginDef: PluginDefinition = {
      id: plugin.id,
      tenantId: plugin.tenantId,
      userId: plugin.userId,
      name: plugin.name,
      description: plugin.description,
      icon: plugin.icon,
      baseUrl: plugin.baseUrl,
      authType: plugin.authType as PluginDefinition['authType'],
      authConfig: plugin.authConfig as PluginAuthConfig,
      customHeaders: (plugin.customHeaders ?? {}) as Record<string, string>,
      actions: (plugin.actions ?? []) as PluginAction[],
      webhookSecret: plugin.webhookSecret,
      status: plugin.status as PluginDefinition['status'],
      lastUsedAt: plugin.lastUsedAt?.toISOString() ?? null,
      lastError: plugin.lastError,
      createdAt: plugin.createdAt.toISOString(),
    };

    const result = await testPluginConnection(pluginDef);

    return NextResponse.json(result);
  } catch (err: unknown) {
    return apiError(err);
  }
}
