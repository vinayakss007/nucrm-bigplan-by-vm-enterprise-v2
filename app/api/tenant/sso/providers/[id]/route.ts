/**
 * PATCH  /api/tenant/sso/providers/[id]  — update an existing provider
 * DELETE /api/tenant/sso/providers/[id]  — soft-delete a provider
 *
 * Both admin-only. PATCH preserves the existing encrypted client_secret
 * when the request omits client_secret, so admins can edit endpoints or
 * domains without re-typing the secret.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  buildEncryptedConfig,
  maskProvider,
  validateInput,
} from '../route';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await context.params;
  const [existing] = await db
    .select({
      id: ssoProviders.id,
      tenantId: ssoProviders.tenantId,
      config: ssoProviders.config,
    })
    .from(ssoProviders)
    .where(and(eq(ssoProviders.id, id), isNull(ssoProviders.deletedAt)))
    .limit(1);
  if (!existing || existing.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: (Parameters<typeof validateInput>[0] & { is_active?: boolean }) | null;
  try { body = await request.json() as Parameters<typeof validateInput>[0] & { is_active?: boolean }; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const validationError = validateInput(body, { secretRequired: false });
  if (validationError) return validationError;
  const v = body!;

  const existingCfg = (existing.config ?? {}) as { client_secret_enc?: string };
  const config = buildEncryptedConfig(v, existingCfg.client_secret_enc);
  if (config instanceof NextResponse) return config;

  const [updated] = await db
    .update(ssoProviders)
    .set({
      name: v.name.trim(),
      config,
      isActive: v.is_active ?? false,
      updatedAt: new Date(),
    })
    .where(eq(ssoProviders.id, id))
    .returning({
      id: ssoProviders.id,
      providerType: ssoProviders.providerType,
      name: ssoProviders.name,
      config: ssoProviders.config,
      isActive: ssoProviders.isActive,
      createdAt: ssoProviders.createdAt,
      updatedAt: ssoProviders.updatedAt,
    });

  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json({ data: maskProvider(updated) });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await context.params;
  const [existing] = await db
    .select({ id: ssoProviders.id, tenantId: ssoProviders.tenantId })
    .from(ssoProviders)
    .where(and(eq(ssoProviders.id, id), isNull(ssoProviders.deletedAt)))
    .limit(1);
  if (!existing || existing.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db
    .update(ssoProviders)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(ssoProviders.id, id));

  return NextResponse.json({ ok: true });
}
