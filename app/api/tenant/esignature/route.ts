/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { createSigningRequest } from '@/lib/esignature';
import { db } from '@/drizzle/db';
import { signingRequests } from '@/drizzle/schema/esignature';
import { eq, and, desc, type SQL } from 'drizzle-orm';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';

/**
 * GET /api/tenant/esignature
 * List signing requests for the tenant.
 * Module-gated to 'sales-quotes'.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 100 });

 
 
    const filters: SQL[] = [eq(signingRequests.tenantId, ctx.tenantId)];
    if (status) {
      filters.push(eq(signingRequests.status, status));
    }

    const data = await db.select()
      .from(signingRequests)
      .where(and(...filters))
      .orderBy(desc(signingRequests.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ data, total: data.length });
 
 
  } catch (err) {
    return apiError(err);
  }
});

/**
 * POST /api/tenant/esignature
 * Create a new signing request.
 * Module-gated to 'sales-quotes'.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const body = await readJsonBody(req);
    const { documentId, signers, provider } = body;

    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required' },
        { status: 400 }
      );
    }

    if (!signers || !Array.isArray(signers) || signers.length === 0) {
      return NextResponse.json(
        { error: 'At least one signer is required' },
        { status: 400 }
      );
    }

    const validProviders = ['docusign', 'hellosign', 'internal'];
    const selectedProvider = provider || 'internal';
    if (!validProviders.includes(selectedProvider)) {
      return NextResponse.json(
        { error: `Provider must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      );
    }

    const request = await createSigningRequest({
      documentId,
      signers,
      provider: selectedProvider,
      tenantId: ctx.tenantId,
      metadata: body.metadata || {},
    });

    // #1613: for the built-in provider, return each signer's public signing
    // link so the caller can deliver it (email/copy). External providers host
    // their own signer UI, so no link is returned.
    const appUrl = process.env['NEXT_PUBLIC_APP_URL']?.replace(/\/$/, '') ?? '';
    const signerLinks = request.provider === 'internal'
      ? request.signers
          .filter((s) => s.token)
          .map((s) => ({ email: s.email, name: s.name, url: `${appUrl}/p/sign/${s.token}` }))
      : [];

    return NextResponse.json({ data: request, signerLinks }, { status: 201 });
 
 
  } catch (err) {
    return apiError(err);
  }
});
