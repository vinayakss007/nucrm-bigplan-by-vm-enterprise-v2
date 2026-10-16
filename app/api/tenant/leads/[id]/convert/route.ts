/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
/**
 * POST /api/tenant/leads/[id]/convert
 *
 * Converts a lead → contact, optionally creates a linked deal.
 * Marks the lead as converted and stores the resulting contact_id.
 * Delegates to the shared convertLeadCore (also used by bulk conversion).
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { convertLeadSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { convertLeadCore } from '@/lib/leads/convert';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldWrite, attachStrippedFields } from '@/lib/rbac/enforce';

export const POST = withApiRoute(async (request: NextRequest, 
  { params }: { params: Promise<{ id: string }> | { id: string } }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'leads.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    let rawBody;
    try { rawBody = await readJsonBody(request); } catch (err) { void logError({ error: err, context: 'tenant/leads/[id]/convert JSON parse', level: 'warning' }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const validated = validateBody(convertLeadSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // #2618 — convert optionally writes deals.amount / deals.stage_id /
    // assigned_to straight from body keys. Unlike the assign routes the
    // conversion itself stays meaningful without them, so STRIP the
    // restricted keys (core defaults then take over) instead of 403.
    const dealGate = await enforceFieldWrite(ctx, 'deals', {
      ...(v.deal_value !== undefined ? { amount: v.deal_value } : {}),
      ...(v.deal_stage !== undefined ? { stage_id: v.deal_stage } : {}),
    });
    const assignGate = v.assigned_to !== undefined
      ? await enforceFieldWrite(ctx, 'leads', { assigned_to: v.assigned_to })
      : { stripped: [] as string[] };
    const gateStripped = [...dealGate.stripped, ...assignGate.stripped];

    const result = await convertLeadCore({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      leadId: id,
      createDeal: v.create_deal,
      dealTitle: v.deal_title ?? undefined,
      dealValue: dealGate.stripped.includes('amount') ? undefined : v.deal_value,
      dealStage: dealGate.stripped.includes('stage_id') ? undefined : (v.deal_stage ?? undefined),
      pipelineId: v.pipeline_id ?? undefined,
      assignedTo: assignGate.stripped.includes('assigned_to') ? undefined : (v.assigned_to ?? undefined),
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }
      return NextResponse.json({
        error: 'Lead already converted',
        contact_id: result.contactId,
      }, { status: 409 });
    }

    // #2620 signal: the caller learns which keys the gate dropped.
    return attachStrippedFields(NextResponse.json({
      ok: true,
      contact_id: result.contactId,
      deal_id: result.dealId,
      is_new_contact: result.isNewContact,
      message: result.isNewContact ? 'Lead converted to new contact.' : 'Lead merged into existing contact.',
    }, { status: 201 }), gateStripped);

  
  
  } catch (error) {
    await logError({ error, context: 'tenant/leads/[id]/convert POST', requestMethod: 'POST' });
    return apiError(error);
  }
});
