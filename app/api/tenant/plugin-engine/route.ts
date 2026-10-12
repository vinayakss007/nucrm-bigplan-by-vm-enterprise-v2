/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { getAllProviders, getProviderDef } from '@/lib/integrations/registry';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { splitConfigCredentials } from '@/lib/integrations/config-credentials';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'installed' | 'available' | 'providers'

    if (type === 'providers') {
      return NextResponse.json({ data: getAllProviders() });
    }

    const data = await db.select()
      .from(integrations)
      .where(and(eq(integrations.tenantId, tid), isNull(integrations.deletedAt)))
      .orderBy(integrations.createdAt);

    // Enrich with provider definition
    const enriched = data.map(inst => {
      // #2521: this query has no `type` filter, so it also returns the tenant's
      // `webhook` rows (`config.secret`) and its `google`/`outlook` rows
      // (`config.accessToken`/`refreshToken`) — see the writer citations in
      // lib/integrations/config-credentials.ts. `GET /api/tenant/webhooks` proves it
      // knows that bag holds a credential: it filters `type='webhook'`
      // (`app/api/tenant/webhooks/route.ts:32`) and projects only `config->>'url'` and
      // `config->'events'` out of it (`:53-55`). The same discipline has to apply here,
      // because `requireAuth` above is not an admin gate.
      const { publicConfig, credentialKeys } = splitConfigCredentials(inst.config);
      return {
        id: inst.id,
        tenantId: inst.tenantId,
        providerId: inst.type,
        label: inst.name,
        config: publicConfig,
        credentialKeys,
        enabled: inst.isActive,
        lastUsedAt: inst.lastUsedAt?.toISOString(),
        createdAt: inst.createdAt.toISOString(),
        provider: getProviderDef(inst.type) || {
          id: inst.type,
          name: inst.type.charAt(0).toUpperCase() + inst.type.slice(1),
          description: 'Custom integration',
          category: 'custom' as const,
          icon: 'Plug',
          configFields: [],
          capabilities: [],
          builtIn: false,
        },
      };
    });

    return NextResponse.json({ data: enriched });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // #2561: in-handler CSRF, the placement `app/api/tenant/integrations/route.ts:74`
    // (#1835) uses. The proxy does check this surface (`proxy.ts:530-532`), but a
    // `Bearer ak_*` request on an allowed path is passed through before that block
    // (`proxy.ts:466`) and `requireAuth` then falls back to the ambient session cookie
    // (`lib/auth/middleware.ts:262`) — on that path nothing has validated CSRF. The
    // exemption keys on the *verified* credential, not on the client-settable
    // `x-auth-method` header `requireCsrf` alone would trust, so an API-key client that
    // sends no CSRF cookie keeps working.
    if (ctx.authMethod !== 'api_key') {
      const csrf = requireCsrf(request);
      if (csrf) return csrf;
    }

    const body = await readJsonBody(request);
    if (!body.provider_id || !body.name) {
      return NextResponse.json({ error: 'provider_id and name are required' }, { status: 400 });
    }

    // Test the connection before saving
    const provider = getProviderDef(body.provider_id);
    const config = body.config || {};

    if (body.test_only) {
      return NextResponse.json({ success: true, message: 'Connection validated', provider });
    }

    const [row] = await db.insert(integrations).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type: body.provider_id,
      name: body.name,
      config,
      isActive: body.enabled !== false,
    }).returning();

    if (!row) {
      return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
    }

    // The caller just typed these credentials, so echoing them back is not a new
    // disclosure to *it* — but the response is logged, cached and kept by the browser
    // like any other, and `GET` above no longer answers them. One shape for both.
    const { publicConfig, credentialKeys } = splitConfigCredentials(row.config);
    return NextResponse.json({
      data: {
        id: row.id,
        providerId: row.type,
        label: row.name,
        config: publicConfig,
        credentialKeys,
        enabled: row.isActive,
        createdAt: row.createdAt.toISOString(),
      }
    }, { status: 201 });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'plugins', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (ctx.authMethod !== 'api_key') {
      const csrf = requireCsrf(request); // #2561: see the POST handler for why
      if (csrf) return csrf;
    }

    const body = await readJsonBody(request);
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

 
 
    const updates: Partial<typeof integrations.$inferInsert> = {};
    if (body['name']) updates['name'] = body['name'];
    if (body['config']) updates['config'] = body['config'];
    if (body['enabled'] !== undefined) updates['isActive'] = body['isActive'];

    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, integrations, body.id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [updated] = await db.update(integrations)
      .set(updates)
      .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.id, body.id)))
      .returning({ id: integrations.id, updatedAt: integrations.updatedAt });

    return NextResponse.json({ success: true, data: { id: updated?.id, updatedAt: updated?.updatedAt } });
 
 
  } catch (err) {
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (request: NextRequest) => {
  try {
  const limited = await rateLimitMutating(request, 'plugins', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (ctx.authMethod !== 'api_key') {
      const csrf = requireCsrf(request); // #2561: see the POST handler for why
      if (csrf) return csrf;
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await db.update(integrations)
      .set({ deletedAt: new Date() })
      .where(and(eq(integrations.tenantId, ctx.tenantId), eq(integrations.id, id)));

    return NextResponse.json({ success: true });
 
 
  } catch (err) {
    return apiError(err);
  }
});
