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

/**
 * `integrations.config` is a JSONB bag that demonstrably holds live credentials, not
 * just settings:
 *   - webhook signing secrets — `app/api/tenant/webhooks/route.ts:108`
 *   - Google/Outlook `accessToken` + `refreshToken` — `lib/calendar-sync/service.ts:49-50`
 * Neither may leave this API. `config` is still needed for the non-secret settings the
 * connectors show (`url`, `events`, `chat_id`), so secret *keys* are removed and only
 * their names reported back via `credentialKeys`.
 *
 * Matched by name pattern rather than an exact key list, so the usual casing and
 * underscore variants of the same credential (`SigningSecret`, `api_key`,
 * `ACCESS_TOKEN`) are all caught. A connector that invents a wholly unrecognisable
 * key name would still slip through — which is why this pattern sits directly above
 * the two writers of those keys, not in some shared module far away from them.
 */
const SECRET_CONFIG_KEY = /(secret|token|password|passwd|api[_-]?key|credential|access[_-]?key)/i;

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

function maskIntegration(row: IntegrationRow) {
  const credentialKeys: string[] = [];
  const publicConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((row.config ?? {}) as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEY.test(key)) credentialKeys.push(key);
    else publicConfig[key] = value;
  }
  return { ...row, config: publicConfig, credentialKeys };
}

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // Deliberately NOT `isAdmin`-gated here, even though POST on this resource is: the
    // leak this PR fixes is the credential material in `config`, and masking closes it
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
