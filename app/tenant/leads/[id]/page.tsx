import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { leads, users, leadActivities, contacts, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql, desc, or, ilike } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import LeadDetailClient from '@/components/tenant/lead-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: PageProps) {
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
    // Joined fields
    assigned_name: users.fullName,
    assigned_avatar: users.avatarUrl,
    assigned_email: users.email,
  })
  .from(leads)
  .leftJoin(users, eq(users.id, leads.assignedTo))
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
      lead={lead}
      activities={activities}
      relatedContacts={relatedContacts}
      teamMembers={teamMembers as any}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
