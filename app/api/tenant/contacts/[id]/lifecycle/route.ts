import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, contactLifecycleHistory, users } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * POST /api/tenant/contacts/[id]/lifecycle
 * Update contact lifecycle stage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { lifecycle_stage, reason } = body;

    const validStages = [
      'subscriber',
      'lead',
      'marketing_qualified',
      'sales_qualified',
      'opportunity',
      'customer',
      'evangelist',
      'churned',
    ];

    if (!lifecycle_stage || !validStages.includes(lifecycle_stage)) {
      return NextResponse.json({ 
        error: `Invalid stage. Must be one of: ${validStages.join(', ')}` 
      }, { status: 400 });
    }

    // Verify contact exists
    const contact = await db.query.contacts.findFirst({
      where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId))
    });

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const oldStage = contact.lifecycleStage;

    // Update lifecycle stage using helper function (keeping sql.raw for DB function call)
    await db.execute(sql`SELECT public.update_contact_lifecycle(${id}, ${lifecycle_stage}, ${ctx.userId}, ${reason || null})`);

    return NextResponse.json({
      ok: true,
      data: {
        contact_id: id,
        from_stage: oldStage,
        to_stage: lifecycle_stage,
      },
      message: `Lifecycle updated from "${oldStage}" to "${lifecycle_stage}"`,
    });
  } catch (error: any) {
    console.error('[Lifecycle] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/contacts/[id]/lifecycle
 * Get contact lifecycle history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;

    const history = await db.select({
      id: contactLifecycleHistory.id,
      tenantId: contactLifecycleHistory.tenantId,
      contactId: contactLifecycleHistory.contactId,
      oldStage: contactLifecycleHistory.fromStage,
      newStage: contactLifecycleHistory.toStage,
      reason: contactLifecycleHistory.reason,
      changedBy: contactLifecycleHistory.changedBy,
      changedAt: contactLifecycleHistory.changedAt,
      changed_by_name: users.fullName,
      changed_by_email: users.email
    })
    .from(contactLifecycleHistory)
    .leftJoin(users, eq(users.id, contactLifecycleHistory.changedBy))
    .where(and(eq(contactLifecycleHistory.contactId, id), eq(contactLifecycleHistory.tenantId, ctx.tenantId)))
    .orderBy(desc(contactLifecycleHistory.changedAt))
    .limit(50);

    return NextResponse.json({
      data: history,
    });
  } catch (error: any) {
    console.error('[Lifecycle] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
