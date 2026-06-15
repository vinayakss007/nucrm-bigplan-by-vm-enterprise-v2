import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema/infra';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const providers = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.tenantId, ctx.tenantId));

    return NextResponse.json({ data: providers });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
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

    return NextResponse.json({ data: provider }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'Provider id is required' }, { status: 400 });
    }

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (updateFields.name !== undefined) updateData['name'] = updateFields.name;
    if (updateFields.config !== undefined) updateData['config'] = updateFields.config;
    if (updateFields.isActive !== undefined) updateData['isActive'] = updateFields.isActive;
    if (updateFields.providerType !== undefined) updateData['providerType'] = updateFields.providerType;

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

    return NextResponse.json({ data: updated });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
