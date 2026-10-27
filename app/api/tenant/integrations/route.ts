/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createIntegrationSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { splitConfigCredentials } from '@/lib/integrations/config-credentials';
import { getProviderDef } from '@/lib/integrations/registry';
import { integrationConfigResponse } from '@/lib/integrations/config-policy';

interface IntegrationRow {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  name: string;
  config: unknown;
  isActive: boolean | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * #2521: `integrations.config` holds live credentials (webhook signing secrets, OAuth
 * access/refresh tokens), so none of them may reach a response. The key pattern and the
 * strip-and-report behaviour live in `lib/integrations/config-credentials.ts`, shared
 * with `app/api/tenant/plugin-engine/route.ts`, because two copies of a secret-name
 * regex drift and the second copy is the one that leaks.
 */
function maskIntegration(row: IntegrationRow) {
  const { publicConfig, credentialKeys } = splitConfigCredentials(row.config);
  return { ...row, config: publicConfig, credentialKeys };
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // Deliberately NOT `isAdmin`-gated here, even though POST on this resource is: the
    // leak #2535 fixed is the credential material in `config`, and masking closes it
    // for every member. Tightening *read access* is a behaviour change `POST`'s own
    // route already assumes, but `postman/full-test-suite.sh:1131` asserts this GET
    // returns 200 as `a@a.com` — an identity no seed in this repo creates
    // (`seed:dev` makes admin@test.com / manager@test.com / rep1 / rep2) — and the
    // suite needs a live stack, so nothing here could tell me whether the gate holds.
    // Tracking that separately on #2521 rather than shipping an unverifiable change.

    const rows = await db.query.integrations.findMany({
      limit: 200,
      where: eq(integrations.tenantId, ctx.tenantId),
      orderBy: [desc(integrations.createdAt)],
    });

    return NextResponse.json({ data: rows.map(maskIntegration) });
  } catch (err: unknown) {
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'integrations', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(request); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(createIntegrationSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // #3292: `createIntegrationSchema` types the config bag as
    // `z.record(z.string(), z.unknown())`, so the schema above says nothing about
    // what a value may *be*. Consult the provider's declared `configFields`
    // before the insert, so an out-of-policy bag never reaches a row.
    const configRejected = integrationConfigResponse(getProviderDef(v.type), v.config || {});
    if (configRejected) return configRejected;

    const [row] = await db.insert(integrations).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      type: v.type,
      name: v.name,
      config: v.config || {},
      isActive: v.is_active,
    }).returning();

    return NextResponse.json({ data: maskIntegration(row as IntegrationRow) }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
});
