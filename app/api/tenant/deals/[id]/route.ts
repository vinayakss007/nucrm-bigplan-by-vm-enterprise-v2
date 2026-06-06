import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { updateDealSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { deals, contacts, tenants, activities, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { notifyTenantMembers } from '@/lib/notifications';
import { logError } from '@/lib/errors';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.view');
    if (deny) return deny;

    const dealId = (await params).id;

    const [row] = await db
      .select({
        id: deals.id,
        tenantId: deals.tenantId,
        title: deals.title,
        stageId: deals.stageId,
        amount: deals.amount,
        closeDate: deals.closeDate,
        contactId: deals.contactId,
        assignedTo: deals.assignedTo,
        metadata: deals.metadata,
        createdAt: deals.createdAt,
        updatedAt: deals.updatedAt,
        deletedAt: deals.deletedAt,
      })
      .from(deals)
      .where(
        and(
          eq(deals.id, dealId),
          eq(deals.tenantId, ctx.tenantId),
          sql`${deals.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Mapping for legacy compatibility if needed
    const legacyRow = {
      ...row,
      value: row.amount,
      stage: row.stageId, // Original used 'stage' column which is now stageId
    };

    return NextResponse.json({ data: legacyRow });
  } catch (err: any) {
    console.error('[deals [id] GET]', err);
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;

    const dealId = (await params).id;
    const body = await req.json();
    const validated = validateBody(updateDealSchema, body);
    if (validated instanceof NextResponse) return validated;

    // Validation
    if (body.amount !== undefined) {
      const v = Number(body.amount);
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 });
      if (v > 999_999_999) return NextResponse.json({ error: 'amount too large' }, { status: 400 });
      body.amount = v.toString(); // decimal in drizzle is string
    }

    // Map legacy 'value' to 'amount' if present
    if (body.value !== undefined && body.amount === undefined) {
      const v = Number(body.value);
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'value must be a non-negative number' }, { status: 400 });
      body.amount = v.toString();
      delete body.value;
    }

    // Map legacy 'stage' (string like "won") to stageId (UUID)
    if (body.stage !== undefined && body.stageId === undefined) {
      // Try to find stage by name
      const [stageRecord] = await db
        .select({ id: dealStages.id, name: dealStages.name })
        .from(dealStages)
        .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
        .where(and(
          eq(dealStages.name, body.stage),
          eq(pipelines.tenantId, ctx.tenantId)
        ))
        .limit(1);
      
      if (stageRecord) {
        body.stageId = stageRecord.id;
        delete body.stage;
      } else {
        // Stage name not found, check if it's already a UUID
        body.stageId = body.stage;
        delete body.stage;
      }
    }

    const [prev] = await db
      .select({ stageId: deals.stageId, title: deals.title, contactId: deals.contactId, amount: deals.amount })
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.tenantId, ctx.tenantId)))
      .limit(1);

    if (!prev) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updateData: any = {
      ...body,
      updatedAt: new Date(),
    };

    if (body.stageId && prev.stageId !== body.stageId) {
      updateData.stageEnteredAt = new Date();
    }

    const [row] = await db
      .update(deals)
      .set(updateData)
      .where(and(eq(deals.id, dealId), eq(deals.tenantId, ctx.tenantId)))
      .returning();

    if (body.stageId && prev.stageId !== body.stageId) {
      // Logic for stage change
      await notifyTenantMembers({
        tenantId: ctx.tenantId,
        excludeUserId: ctx.userId,
        type: 'deal_stage',
        title: `Deal moved to ${body.stageId}: ${row!.title}`.trim(),
        entity_type: 'deal',
        entity_id: dealId,
        link: `/tenant/deals/${dealId}`
      } as any);

      await db.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityId: dealId,
        entityType: 'deal',
        eventType: 'deal_update',
        description: `Deal stage: ${prev.stageId} → ${body.stageId}`,
        metadata: { stage_from: prev.stageId, stage_to: body.stageId, action: 'stage_change' },
      }).catch(err => console.error('[deals PATCH] activity log failed:', err));

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'deal_stage_change',
        entityType: 'deal',
        entityId: dealId,
        oldData: { stage: prev.stageId },
        newData: { stage: body.stageId }
      });

      // Check if 'won' stage - get stage name to compare
      if (body.stageId) {
        const [stageInfo] = await db
          .select({ name: dealStages.name })
          .from(dealStages)
          .where(eq(dealStages.id, body.stageId))
          .limit(1);
        
        if (stageInfo?.name?.toLowerCase() === 'won') {
          await handleDealWon(ctx, dealId, row);
        }
      }
    }

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[deals [id] PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'deals.delete');
    if (deny) return deny;

    const dealId = (await params).id;

    const [row] = await db
      .update(deals)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(
        and(
          eq(deals.id, dealId),
          eq(deals.tenantId, ctx.tenantId),
          sql`${deals.deletedAt} IS NULL`
        )
      )
      .returning({ id: deals.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'deal',
      entityId: dealId
    });

    fireWebhooks(ctx.tenantId, 'deal.deleted', { id: dealId }).catch((err) => logError(err, "async-catch:[context]"));

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) {
    console.error('[deals [id] DELETE]', err);
    return apiError(err);
  }
}

async function handleDealWon(ctx: any, dealId: string, row: any) {
  // Fire Webhooks
  await fireWebhooks(ctx.tenantId, 'deal.won', {
    id: dealId,
    title: row.title,
    amount: row.amount,
    contact_id: row.contactId,
  }).catch((err) => logError(err, "async-catch:[context]"));

  // Send Email
  if (row.contactId) {
    try {
      const { sendEmail } = await import('@/lib/email/service');
      const [contactData] = await db
        .select({
          email: contacts.email,
          firstName: contacts.firstName,
          tenantName: tenants.name,
        })
        .from(contacts)
        .innerJoin(tenants, eq(tenants.id, contacts.tenantId))
        .where(
          and(
            eq(contacts.id, row.contactId),
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.doNotContact, false)
          )
        )
        .limit(1);

      if (contactData?.email) {
        await sendEmail({
          to: contactData.email,
          subject: `Great news from ${contactData.tenantName}!`,
          html: `<div style="font-family:sans-serif;max-width:600px">
            <p>Hi ${contactData.firstName || 'there'},</p>
            <p>We're excited to move forward — your deal <strong>${row!.title}</strong> has been marked as <strong>Won</strong>!</p>
            <p>Our team will be in touch shortly with next steps.</p>
            <br/>
            <p>Best regards,<br/>${contactData.tenantName} Team</p>
          </div>`,
        }).catch((err) => logError(err, "async-catch:[context]"));
      }
    } catch (e) {
      console.error('[deal-won] Email failed:', e);
    }
  }

  // Record won_at timestamp in metadata or specific field if exists
  // The original schema didn't have won_at in Drizzle yet, but raw SQL update tried to set it.
  // If it's not in Drizzle, we might need to add it or use metadata.
  // Looking at drizzle/schema/crm.ts, deals doesn't have wonAt.
  // Let's check if it's in the legacy SQL. Yes: `UPDATE public.deals SET won_at = now()`
  // I should probably add wonAt to the schema or use metadata.
  // For now, let's use metadata to be safe and compatible.
  await db.update(deals)
    .set({
      metadata: { ...((row.metadata as any) || {}), won_at: new Date().toISOString() }
    })
    .where(eq(deals.id, dealId))
    .catch(err => console.error('[deal-won] Failed to update metadata:', err));

  // Trigger Automations
  try {
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    evaluateAutomations({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      event: 'deal.won',
      data: { ...row, id: dealId },
    }).catch(err => console.error('[deal-won] Automation evaluation failed:', err));
  } catch (e) {
    console.error('[deal-won] Automation import failed:', e);
  }
}

