/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { leads, users, leadActivities, contacts, tenantMembers, products, services, teams } from '@/drizzle/schema';
import { eq, and, sql, desc, or, ilike } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import LeadDetailClient from '@/components/tenant/lead-detail-client';
import type { Lead, Activity, RelatedContact } from '@/components/tenant/lead-detail-client';
import { withTenantScope } from '@/lib/api/with-api-route';

interface PageProps {
  params: Promise<{ id: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripNulls = (obj: Record<string, any>): Record<string, any> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? undefined]));

export default async function LeadDetailPage({ params }: PageProps) {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const { id } = await params;
  
  // Get lead details
  const [lead] = await db.select({
    id: leads.id,
    tenant_id: leads.tenantId,
    first_name: leads.firstName,
    last_name: leads.lastName,
    full_name: leads.fullName,
    email: leads.email,
    phone: leads.phone,
    company_name: leads.companyName,
    title: leads.title,
    lead_source: leads.source,
    lead_status: leads.leadStatus,
    lifecycle_stage: leads.lifecycleStage,
    score: leads.score,
    budget: leads.budget,
    authority_level: leads.authorityLevel,
    timeline: leads.timeline,
    linkedin_url: leads.linkedinUrl,
    notes: leads.notes,
    internal_notes: leads.internalNotes,
    assigned_to: leads.assignedTo,
    created_by: leads.createdBy,
    created_at: leads.createdAt,
    // What the lead is a request for, and its owning team (WF-02/WF-04)
    requested_product_id: leads.requestedProductId,
    requested_service_id: leads.requestedServiceId,
    team_id: leads.teamId,
    requested_product_name: products.name,
    requested_service_name: services.name,
    team_name: teams.name,
    // Joined fields
    assigned_name: users.fullName,
    assigned_avatar: users.avatarUrl,
    assigned_email: users.email,
  })
  .from(leads)
  .leftJoin(users, eq(users.id, leads.assignedTo))
  .leftJoin(products, eq(products.id, leads.requestedProductId))
  .leftJoin(services, eq(services.id, leads.requestedServiceId))
  .leftJoin(teams, eq(teams.id, leads.teamId))
  .where(and(
    eq(leads.id, id),
    eq(leads.tenantId, ctx.tenantId),
    sql`${leads.deletedAt} IS NULL`
  ))
  .limit(1);
  
  if (!lead) {
    notFound();
  }

  // Get created_by_name (separate join for multiple user references)
  const [creator] = await db.select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, lead.created_by as string))
    .limit(1);
  
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (lead as any).created_by_name = creator?.fullName;
  
  // Get activities
  const activities = await db.select({
    id: leadActivities.id,
    lead_id: leadActivities.leadId,
    tenant_id: leadActivities.tenantId,
    performed_by: leadActivities.performedBy,
    activity_type: leadActivities.activityType,
    description: leadActivities.description,
    activity_data: leadActivities.activityData,
    performed_at: leadActivities.performedAt,
    performed_by_name: users.fullName,
    performed_by_avatar: users.avatarUrl,
  })
  .from(leadActivities)
  .leftJoin(users, eq(users.id, leadActivities.performedBy))
  .where(and(
    eq(leadActivities.leadId, id),
    eq(leadActivities.tenantId, ctx.tenantId)
  ))
  .orderBy(desc(leadActivities.performedAt))
  .limit(100);
  
  // Get related contacts
  const relatedContacts = await db.select({
    id: contacts.id,
    first_name: contacts.firstName,
    last_name: contacts.lastName,
    email: contacts.email,
    phone: contacts.phone,
    company_id: contacts.companyId,
  })
  .from(contacts)
  .where(and(
    eq(contacts.tenantId, ctx.tenantId),
    sql`${contacts.deletedAt} IS NULL`,
    or(
      lead.email ? ilike(contacts.email, lead.email as string) : sql`false`,
      lead.phone ? eq(contacts.phone, lead.phone as string) : sql`false`
    )
  ))
  .limit(5);
  
  // Get team members for assignment
  const teamMembers = await db.select({
    user_id: tenantMembers.userId,
    full_name: users.fullName,
    avatar_url: users.avatarUrl,
    email: users.email,
  })
  .from(tenantMembers)
  .innerJoin(users, eq(users.id, tenantMembers.userId))
  .where(and(
    eq(tenantMembers.tenantId, ctx.tenantId),
    eq(tenantMembers.status, 'active')
  ))
  .orderBy(users.fullName);
  
  return (
    <LeadDetailClient
      lead={stripNulls(lead) as unknown as Lead}
      activities={activities.map(a => stripNulls(a) as unknown as Activity)}
      relatedContacts={relatedContacts.map(c => stripNulls(c) as unknown as RelatedContact)}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      teamMembers={teamMembers as any}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );

  });
}
