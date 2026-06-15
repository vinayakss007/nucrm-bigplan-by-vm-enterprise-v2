import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { createSigningRequest } from '@/lib/esignature';
import { db } from '@/drizzle/db';
import { signingRequests } from '@/drizzle/schema/esignature';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/tenant/esignature
 * List signing requests for the tenant.
 * Module-gated to 'sales-quotes'.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any[] = [eq(signingRequests.tenantId, ctx.tenantId)];
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/esignature
 * Create a new signing request.
 * Module-gated to 'sales-quotes'.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const body = await req.json();
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

    return NextResponse.json({ data: request }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
