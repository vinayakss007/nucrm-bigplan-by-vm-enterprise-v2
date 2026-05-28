import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound, badRequest } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customPlugins } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { PluginAuthType, PluginAction, PluginAuthConfig } from '@/lib/plugins/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
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

    return NextResponse.json({
      data: {
        id: plugin.id,
        tenantId: plugin.tenantId,
        userId: plugin.userId,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        baseUrl: plugin.baseUrl,
        authType: plugin.authType,
        authConfig: plugin.authConfig,
        customHeaders: plugin.customHeaders,
        actions: plugin.actions as PluginAction[],
        webhookSecret: plugin.webhookSecret,
        status: plugin.status,
        lastUsedAt: plugin.lastUsedAt?.toISOString() ?? null,
        lastError: plugin.lastError,
        createdAt: plugin.createdAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;

    // Build update object
    const updates: Record<string, unknown> = {};

    if (body['name'] !== undefined) updates['name'] = body['name'];
    if (body['description'] !== undefined) updates['description'] = body['description'];
    if (body['icon'] !== undefined) updates['icon'] = body['icon'];
    if (body['baseUrl'] !== undefined) {
      try {
        new URL(body['baseUrl'] as string);
      } catch {
        return badRequest('baseUrl must be a valid URL');
      }
      updates['baseUrl'] = body['baseUrl'];
    }
    if (body['authType'] !== undefined) updates['authType'] = body['authType'] as PluginAuthType;
    if (body['authConfig'] !== undefined) updates['authConfig'] = body['authConfig'] as PluginAuthConfig;
    if (body['customHeaders'] !== undefined) updates['customHeaders'] = body['customHeaders'];
    if (body['actions'] !== undefined) updates['actions'] = body['actions'] as PluginAction[];
    if (body['webhookSecret'] !== undefined) updates['webhookSecret'] = body['webhookSecret'];
    if (body['status'] !== undefined) updates['status'] = body['status'];

    updates['updatedAt'] = new Date();

    const [updated] = await db.update(customPlugins)
      .set(updates)
      .where(and(
        eq(customPlugins.id, id),
        eq(customPlugins.tenantId, ctx.tenantId),
        isNull(customPlugins.deletedAt)
      ))
      .returning();

    if (!updated) {
      return notFound('Plugin');
    }

    return NextResponse.json({ success: true, data: { id: updated.id, name: updated.name, status: updated.status } });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await context.params;

    // Soft delete
    const [deleted] = await db.update(customPlugins)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(customPlugins.id, id),
        eq(customPlugins.tenantId, ctx.tenantId),
        isNull(customPlugins.deletedAt)
      ))
      .returning();

    if (!deleted) {
      return notFound('Plugin');
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}
