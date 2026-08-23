/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { followUps, contacts, leads, deals, users } from '@/drizzle/schema';
import { eq, and, isNull, asc, lte, sql } from 'drizzle-orm';
import { MissedFollowUpsClient } from './missed-followups-client';

export default async function MissedFollowUpsPage() {
  const ctx = await requireTenantCtx();
  const now = new Date();

  const filters = [
    eq(followUps.tenantId, ctx.tenantId),
    isNull(followUps.deletedAt),
    eq(followUps.status, 'pending'),
    lte(followUps.dueDate, now),
  ];

  const followUpItems = await db
    .select({
      id: followUps.id,
      title: followUps.title,
      description: followUps.description,
      dueDate: followUps.dueDate,
      status: followUps.status,
      missedDays: followUps.missedDays,
      autoAiEnabled: followUps.autoAiEnabled,
      completedAt: followUps.completedAt,
      leadId: followUps.leadId,
      contactId: followUps.contactId,
      dealId: followUps.dealId,
      assignedTo: followUps.assignedTo,
      createdAt: followUps.createdAt,
      contactName: sql<string>`COALESCE(NULLIF(${contacts.firstName} || ' ' || NULLIF(${contacts.lastName}, ''), ' '), '')`.as('contactName'),
      leadName: sql<string>`COALESCE(NULLIF(${leads.firstName} || ' ' || NULLIF(${leads.lastName}, ''), ' '), '')`.as('leadName'),
      dealTitle: deals.title,
      assigneeName: users.fullName,
    })
    .from(followUps)
    .leftJoin(contacts, eq(contacts.id, followUps.contactId))
    .leftJoin(leads, eq(leads.id, followUps.leadId))
    .leftJoin(deals, eq(deals.id, followUps.dealId))
    .leftJoin(users, eq(users.id, followUps.assignedTo))
    .where(and(...filters))
    .orderBy(asc(followUps.dueDate))
    .limit(100);

  return (
    <MissedFollowUpsClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      items={followUpItems as any}
    />
  );
}
