/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { concurrencyGuard } from '@/lib/api/concurrency';
import { ssoProviders } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  buildEncryptedConfig,
  maskProvider,
  validateInput,
} from '../route';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { apiError } from '@/lib/api-error';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const PATCH = withApiRoute(async (request: NextRequest,
  context: { params: Promise<{ id: string }> },) => {
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
  try { body = await readJsonBody(request) as Parameters<typeof validateInput>[0] & { is_active?: boolean }; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const limited = await rateLimitMutating(request, 'ssoProviders', 'patch');
  if (limited) return limited;
  const validationError = validateInput(body, { secretRequired: false });
  if (validationError) return validationError;
  const v = body!;

  const existingCfg = (existing.config ?? {}) as { client_secret_enc?: string };
  const config = buildEncryptedConfig(v, existingCfg.client_secret_enc);
  if (config instanceof NextResponse) return config;

  // Optimistic concurrency: reject if another update happened since client read
  const expectedUpdatedAt = ((body as unknown) as Record<string, unknown> | null)?.expectedUpdatedAt as string | undefined;
  const guard = await concurrencyGuard(db, ssoProviders, id, ctx.tenantId, expectedUpdatedAt);
  if (guard) return guard;

  // #3194: the read above vetoes `existing.tenantId !== ctx.tenantId` in JS, but
  // that check lived only in the code path, not in the SQL. Postgres re-evaluates
  // this UPDATE's WHERE under the row lock, so the tenant the read proved must
  // appear here too — the same one-line predicate every sibling write on a
  // tenant-owned table already carries (#2383/#3159/#3177/#3189). RLS under FORCE
  // is the second, independent defence; the clause is the first one a reviewer can
  // read straight off the statement. The `!updated → 500` branch below stays as-is.
  const [updated] = await db
    .update(ssoProviders)
    .set({
      name: v.name.trim(),
      config,
      isActive: v.is_active ?? false,
      updatedAt: new Date(),
    })
    .where(and(eq(ssoProviders.id, id), eq(ssoProviders.tenantId, ctx.tenantId)))
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
});

export const DELETE = withApiRoute(async (request: NextRequest,
  context: { params: Promise<{ id: string }> },) => {
  try {
    const limited = await rateLimitMutating(request, 'ssoProviders', 'delete');
    if (limited) return limited;
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

    // #3194: a soft delete is a write. The old statement named only the row id and
    // never read the result back, so a row that vanished between the read above and
    // this UPDATE still answered `{ ok: true }`. Claim the tenant in the WHERE — the
    // clause the read vetted against — and read the row back: zero rows means this
    // statement removed nothing, which is a 404, not a silent success.
    const [deleted] = await db
      .update(ssoProviders)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ssoProviders.id, id), eq(ssoProviders.tenantId, ctx.tenantId)))
      .returning({ id: ssoProviders.id });

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
});
