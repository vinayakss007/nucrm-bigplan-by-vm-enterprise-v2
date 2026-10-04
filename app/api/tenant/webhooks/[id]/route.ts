/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { integrations } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateWebhookSchema } from '@/lib/api/schemas';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { checkSaveTimeUrlSafety } from '@/lib/security/ssrf';

/**
 * #2276: the signing secret is shown exactly once (at creation, POST).
 * Read/update responses only ever expose a `****<last4>` mask, matching the
 * backup-config contract (#2221). PATCH never accepts a secret change, so the
 * stored secret is preserved untouched.
 */
function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

export const PATCH = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) => {
  try {
  const limited = await rateLimitMutating(req, 'webhooks', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    const rawBody = await readJsonBody(req);
    const validated = validateBody(updateWebhookSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const body = validated.data;
    const { name, url, events, is_active } = body;

    // #2276: validate a CHANGED target URL at save time with the shared SSRF
    // host checks before anything is written. Delivery-time `safeFetch` still
    // re-validates (incl. DNS rebinding) on every actual request.
    if (url !== undefined) {
      const urlRejection = checkSaveTimeUrlSafety(url);
      if (urlRejection) {
        return NextResponse.json(
          { error: 'Validation failed', details: [{ field: 'url', message: urlRejection }] },
          { status: 400 }
        );
      }
    }
    
    // Get existing webhook to merge config
    const existing = await db.query.integrations.findFirst({
      where: and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook'))
    });
    
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Optimistic concurrency guard
    const expectedUpdatedAt = rawBody?.expectedUpdatedAt ?? rawBody?._updated_at;
    if (expectedUpdatedAt) {
      const guard = await concurrencyGuard(db, integrations, id, ctx.tenantId, expectedUpdatedAt);
      if (guard) return guard;
    }
    
    const currentConfig = (existing.config ?? {}) as Record<string, unknown>;
    const newConfig = {
      ...currentConfig,
      url: url || currentConfig['url'],
      events: events || currentConfig['events'],
    };
    
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (is_active !== undefined) updateData.isActive = is_active;
    if (url !== undefined || events !== undefined) updateData.config = newConfig;
    
    const [row] = await db
      .update(integrations)
      .set(updateData)
      .where(and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook')))
      .returning();
    
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // #2276: never re-echo the plaintext signing secret on read/update —
    // mask it (`****<last4>`) exactly like the backup-config route (#2221).
    const returnedConfig = (row.config ?? {}) as Record<string, unknown>;
    const maskedConfig = typeof returnedConfig['secret'] === 'string' && returnedConfig['secret'] !== ''
      ? { ...returnedConfig, secret: maskSecret(returnedConfig['secret'] as string) }
      : returnedConfig;

    return NextResponse.json({ 
      data: { 
        ...row, 
        config: maskedConfig,
        url: (returnedConfig['url'] as string | undefined),
        events: (returnedConfig['events'] as string[] | undefined) 
      } 
    });
 
 
  } catch (err) { 
    return apiError(err); 
  }
});

export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) => {
  try {
  const limited = await rateLimitMutating(req, 'webhooks', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    await db.update(integrations)
      .set({ deletedAt: new Date() })
      .where(and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook'), isNull(integrations.deletedAt)));

    return NextResponse.json({ ok: true });
 
 
  } catch (err) { return apiError(err); }
});
