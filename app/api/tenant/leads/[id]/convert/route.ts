import { apiError } from '@/lib/api-error';
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

export async function POST(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'leads.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    let rawBody;
    try { rawBody = await readJsonBody(request); } catch (err) { console.error('[leads/convert] JSON parse failed', err); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const validated = validateBody(convertLeadSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const result = await convertLeadCore({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      leadId: id,
      createDeal: v.create_deal,
      dealTitle: v.deal_title ?? undefined,
      dealValue: v.deal_value,
      dealStage: v.deal_stage ?? undefined,
      pipelineId: v.pipeline_id ?? undefined,
      assignedTo: v.assigned_to ?? undefined,
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

    return NextResponse.json({
      ok: true,
      contact_id: result.contactId,
      deal_id: result.dealId,
      is_new_contact: result.isNewContact,
      message: result.isNewContact ? 'Lead converted to new contact.' : 'Lead merged into existing contact.',
    }, { status: 201 });

  
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[lead convert] error:', error);
    return apiError(error);
  }
}
