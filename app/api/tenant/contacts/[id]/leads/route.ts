/**
 * GET /api/tenant/contacts/[id]/leads
 *
 * Returns every lead linked to a contact, enriched with assignee name,
 * current owner, total open offer value, and last activity.
 *
 * One contact can have many leads (one per sales conversation, product, or
 * cycle). The contact detail page renders this list under a "Leads" tab so
 * the rep sees every conversation that has ever happened with this person.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leads, leadOffers, users } from '@/drizzle/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const rows = await db
      .select({
        id: leads.id,
        leadOid: leads.leadOid,
        productId: leads.productId,
        firstName: leads.firstName,
        lastName: leads.lastName,
        leadStatus: leads.leadStatus,
        lifecycleStage: leads.lifecycleStage,
        score: leads.score,
        value: leads.value,
        budget: leads.budget,
        budgetCurrency: leads.budgetCurrency,
        authorityLevel: leads.authorityLevel,
        timeline: leads.timeline,
        timelineTargetDate: leads.timelineTargetDate,
        needDescription: leads.needDescription,
        source: leads.source,
        assignedTo: leads.assignedTo,
        assignedName: users.fullName,
        assignedAvatar: users.avatarUrl,
        isConverted: leads.isConverted,
        convertedAt: leads.convertedAt,
        lastActivityAt: leads.lastActivityAt,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedTo))
      .where(and(
        eq(leads.tenantId, ctx.tenantId),
        eq(leads.contactId, id),
        isNull(leads.deletedAt),
      ))
      .orderBy(desc(leads.createdAt));

    if (rows.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Aggregate offer totals per lead in one query
    const leadIds = rows.map(r => r.id);
    const offerTotals = leadIds.length > 0
      ? await db
          .select({
            leadId: leadOffers.leadId,
            currency: leadOffers.currency,
            openTotal: sql<string>`coalesce(sum(case when ${leadOffers.status} in ('proposed','accepted') then ${leadOffers.quantity} * ${leadOffers.unitPrice} else 0 end), 0)::text`,
            offerCount: sql<number>`count(*)::int`,
          })
          .from(leadOffers)
          .where(and(
            eq(leadOffers.tenantId, ctx.tenantId),
            isNull(leadOffers.deletedAt),
            sql`${leadOffers.leadId} = ANY(${leadIds})`,
          ))
          .groupBy(leadOffers.leadId, leadOffers.currency)
      : [];

    const offerByLead = new Map<string, { total: number; currency: string; count: number }>();
    for (const row of offerTotals) {
      // If a lead has offers in multiple currencies, sum the largest currency
      const prev = offerByLead.get(row.leadId);
      const total = parseFloat(row.openTotal || '0');
      if (!prev || total > prev.total) {
        offerByLead.set(row.leadId, { total, currency: row.currency, count: row.offerCount });
      }
    }

    const data = rows.map(lead => {
      const offer = offerByLead.get(lead.id);
      return {
        id: lead.id,
        lead_oid: lead.leadOid,
        product_id: lead.productId,
        first_name: lead.firstName,
        last_name: lead.lastName,
        lead_status: lead.leadStatus,
        lifecycle_stage: lead.lifecycleStage,
        score: lead.score,
        value: lead.value,
        budget: lead.budget,
        budget_currency: lead.budgetCurrency,
        authority_level: lead.authorityLevel,
        timeline: lead.timeline,
        timeline_target_date: lead.timelineTargetDate,
        need_description: lead.needDescription,
        source: lead.source,
        assigned_to: lead.assignedTo,
        assigned_name: lead.assignedName,
        assigned_avatar: lead.assignedAvatar,
        is_converted: lead.isConverted,
        converted_at: lead.convertedAt,
        last_activity_at: lead.lastActivityAt,
        created_at: lead.createdAt,
        updated_at: lead.updatedAt,
        offer_total: offer?.total ?? 0,
        offer_currency: offer?.currency ?? 'USD',
        offer_count: offer?.count ?? 0,
      };
    });

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('[contacts/leads] error:', error);
    return apiError(err, "Internal server error", 500);
  }
}
