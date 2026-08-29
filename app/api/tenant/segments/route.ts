/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { segments } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Normalize the entity_type coming from the UI (which uses plural forms like
 * "contacts") to the singular canonical value stored on the segments table
 * ("contact"). Accepts either form defensively.
 */
const ENTITY_TYPES: Record<string, string> = {
  contact: 'contact', contacts: 'contact',
  company: 'company', companies: 'company',
  lead: 'lead', leads: 'lead',
  deal: 'deal', deals: 'deal',
};

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entity_type');

    const where = [eq(segments.tenantId, ctx.tenantId)];
    if (entityType) {
      where.push(eq(segments.entityType, ENTITY_TYPES[entityType] ?? entityType));
    }

    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        entityType: segments.entityType,
        description: segments.description,
        config: segments.config,
        createdAt: segments.createdAt,
      })
      .from(segments)
      .where(and(...where))
      .orderBy(segments.name);

    // Shape for the UI: expose entity_type/filters/filter_count/created_at.
    const data = rows.map((r) => {
      const filters = (r.config as Record<string, unknown>) ?? {};
      return {
        id: r.id,
        name: r.name,
        entity_type: r.entityType,
        description: r.description,
        filters,
        filter_count: Object.keys(filters).length,
        created_at: r.createdAt,
      };
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[segments GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const limited = await rateLimitMutating(req, 'segments', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await readJsonBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Segment name is required' }, { status: 400 });
    }

    const rawEntity = typeof body.entity_type === 'string' ? body.entity_type : 'contacts';
    const entityType = ENTITY_TYPES[rawEntity];
    if (!entityType) {
      return NextResponse.json(
        { error: `Invalid entity_type '${rawEntity}'. Must be one of: contact, company, lead, deal.` },
        { status: 400 },
      );
    }

    const filters = (body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters))
      ? (body.filters as Record<string, unknown>)
      : {};
    const description = typeof body.description === 'string' ? body.description : null;

    const [row] = await db
      .insert(segments)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        entityType,
        config: filters,
        createdBy: ctx.userId,
      })
      .returning({
        id: segments.id,
        name: segments.name,
        entityType: segments.entityType,
        description: segments.description,
        config: segments.config,
        createdAt: segments.createdAt,
      });

    if (!row) {
      return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 });
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'segment',
      entityId: row.id,
      newData: { name: row.name, entityType: row.entityType },
    });

    const cfg = (row.config as Record<string, unknown>) ?? {};
    return NextResponse.json(
      {
        data: {
          id: row.id,
          name: row.name,
          entity_type: row.entityType,
          description: row.description,
          filters: cfg,
          filter_count: Object.keys(cfg).length,
          created_at: row.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[segments POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
