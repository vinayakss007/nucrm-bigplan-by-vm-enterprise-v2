/**
 * GET  /api/tenant/whatsapp/templates - List templates from Meta
 * POST /api/tenant/whatsapp/templates - Sync templates from Meta
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations, whatsappTemplates } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [integration] = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.tenantId, ctx.tenantId),
        eq(integrations.type, 'whatsapp'),
        eq(integrations.isActive, true)
      ))
      .orderBy(desc(integrations.createdAt))
      .limit(1);

    if (!integration) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 });
    }

    const config = integration.config as any;
    const accessToken = config?.access_token;
    const businessAccountId = config?.business_account_id;

    if (!accessToken || !businessAccountId) {
      return NextResponse.json({ error: 'WhatsApp credentials incomplete' }, { status: 400 });
    }

    // Fetch templates from Meta
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${businessAccountId}/message_templates?limit=100`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch templates from Meta' }, { status: 500 });
    }

    const data = await response.json();
    const templates = data.data || [];

    return NextResponse.json({ data: templates });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [integration] = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.tenantId, ctx.tenantId),
        eq(integrations.type, 'whatsapp'),
        eq(integrations.isActive, true)
      ))
      .orderBy(desc(integrations.createdAt))
      .limit(1);

    if (!integration) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 });
    }

    const config = integration.config as any;
    const accessToken = config?.access_token;
    const businessAccountId = config?.business_account_id;

    if (!accessToken || !businessAccountId) {
      return NextResponse.json({ error: 'WhatsApp credentials incomplete' }, { status: 400 });
    }

    // Fetch and sync templates
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${businessAccountId}/message_templates?limit=100`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to sync templates' }, { status: 500 });
    }

    const data = await response.json();
    const templates = data.data || [];

    // Store templates in DB
    for (const t of templates) {
      await db.insert(whatsappTemplates)
        .values({
          tenantId: ctx.tenantId,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components || [],
          metaData: t,
        })
        .onConflictDoUpdate({
          target: [whatsappTemplates.tenantId, whatsappTemplates.name, whatsappTemplates.language],
          set: {
            category: t.category,
            status: t.status,
            components: t.components || [],
            metaData: t,
            updatedAt: new Date(),
          }
        });
    }

    return NextResponse.json({
      ok: true,
      synced: templates.length,
      data: templates,
    });
  } catch (err: any) {
    return apiError(err);
  }
}
