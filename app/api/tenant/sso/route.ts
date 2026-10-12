/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema/infra';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const ssoConfigSchema = z.object({
  providerType: z.enum(['saml', 'oidc']),
  name: z.string().min(1).max(100),
  config: z.object({
    // SAML fields
    entityId: z.string().optional(),
    ssoUrl: z.string().url().optional(),
    certificate: z.string().optional(),
    // OIDC fields
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    issuer: z.string().optional(),
    authorizationEndpoint: z.string().url().optional(),
    tokenEndpoint: z.string().url().optional(),
    userinfoEndpoint: z.string().url().optional(),
    redirectUri: z.string().url().optional(),
    scopes: z.array(z.string()).optional(),
  }),
  isActive: z.boolean().optional().default(true),
});

interface SsoProviderRow {
  id: string;
  tenantId: string;
  providerType: string;
  name: string;
  config: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}

/** The columns every response may carry; `config` is masked by `maskProvider`. */
const PROVIDER_COLUMNS = {
  id: ssoProviders.id,
  tenantId: ssoProviders.tenantId,
  providerType: ssoProviders.providerType,
  name: ssoProviders.name,
  config: ssoProviders.config,
  isActive: ssoProviders.isActive,
  createdAt: ssoProviders.createdAt,
  updatedAt: ssoProviders.updatedAt,
};

/**
 * The OIDC client secret stays in `config` at rest — `lib/auth/sso.ts:193` reads it
 * back to exchange the auth code — so it cannot be dropped from storage here. It can
 * and must be dropped from every response: a client secret plus this app's client id
 * lets a reader mint tokens at the tenant's IdP for any user in that tenant.
 *
 * `certificate` is deliberately not masked: it is the IdP **signing** certificate, a
 * public trust anchor used to verify assertions (`lib/auth/sso.ts:446-448`), and the
 * settings form has to display it.
 */
export function maskProvider(row: SsoProviderRow) {
  const { clientSecret, ...publicConfig } = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerType: row.providerType,
    name: row.name,
    isActive: row.isActive,
    config: publicConfig,
    clientSecretPresent: typeof clientSecret === 'string' && clientSecret.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A blank or omitted `clientSecret` on an update means "leave the stored one", not
 * "clear it". The settings form can no longer prefill the secret — the API stopped
 * returning it — so without this the first admin who edits any other field would
 * silently wipe the tenant's working IdP credential.
 */
export function keepStoredSecret(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const value = incoming['clientSecret'];
  const clearsIt = value === undefined || value === null || value === '';
  const storedSecret = stored['clientSecret'];
  if (clearsIt && typeof storedSecret === 'string' && storedSecret.length > 0) {
    return { ...incoming, clientSecret: storedSecret };
  }
  return incoming;
}

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    // POST and PUT both require admin. This route answers with IdP configuration, so
    // it must not be the one method any member of the tenant can read (#2520).
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const providers = await db
      .select(PROVIDER_COLUMNS)
      .from(ssoProviders)
      .where(eq(ssoProviders.tenantId, ctx.tenantId));

    return NextResponse.json({ data: providers.map(maskProvider) });
 
 
  } catch (err) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const limited = await rateLimitMutating(req, 'ssoProviders', 'post');
    if (limited) return limited;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await readJsonBody(req);
    const validated = validateBody(ssoConfigSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [provider] = await db.insert(ssoProviders).values({
      tenantId: ctx.tenantId,
      providerType: v.providerType,
      name: v.name,
      config: v.config,
      isActive: v.isActive,
    }).returning();

    return NextResponse.json({ data: maskProvider(provider as SsoProviderRow) }, { status: 201 });
 
 
  } catch (err) { return apiError(err); }
});

export const PUT = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const limited = await rateLimitMutating(req, 'ssoProviders', 'put');
    if (limited) return limited;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await readJsonBody(req);
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'Provider id is required' }, { status: 400 });
    }

 
 
 
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, ssoProviders, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updateFields.name !== undefined) updateData['name'] = updateFields.name;
    if (updateFields.isActive !== undefined) updateData['isActive'] = updateFields.isActive;
    if (updateFields.providerType !== undefined) updateData['providerType'] = updateFields.providerType;

    if (updateFields.config !== undefined) {
      const [existing] = await db
        .select({ config: ssoProviders.config })
        .from(ssoProviders)
        .where(and(eq(ssoProviders.id, id), eq(ssoProviders.tenantId, ctx.tenantId)))
        .limit(1);
      updateData['config'] = keepStoredSecret(
        updateFields.config as Record<string, unknown>,
        (existing?.config ?? {}) as Record<string, unknown>,
      );
    }

    const [updated] = await db.update(ssoProviders)
      .set(updateData)
      .where(
        and(
          eq(ssoProviders.id, id),
          eq(ssoProviders.tenantId, ctx.tenantId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'SSO provider not found' }, { status: 404 });
    }

    return NextResponse.json({ data: maskProvider(updated as SsoProviderRow) });
 
 
  } catch (err) { return apiError(err); }
});
