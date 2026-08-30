/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { companies, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { getContacts } from '@/lib/db/services/contacts';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { getUserDefaultView } from '@/lib/user-defaults';
import { Skeleton } from '@/components/ui/skeleton';
import { withTenantScope } from '@/lib/api/with-api-route';
import type { ContactInput, TeamMemberOpt } from '@/components/tenant/contacts-client';

const ContactsClient = dynamic(() => import('@/components/tenant/contacts-client'));

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="admin-card">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ offset?: string; q?: string; lead_status?: string }> }) {
  return withTenantScope(async () => {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;
  const sp = await searchParams;
  const offset = parseInt(sp.offset || '0');
  const q = sp.q || '';
  const status = sp.lead_status || 'all';
  const limit = 25;

  const permissions = {
    canCreate: can(ctx, 'contacts.create'),
    canEdit: can(ctx, 'contacts.edit'),
    canDelete: can(ctx, 'contacts.delete'),
    canViewAll: can(ctx, 'contacts.view_all'),
    canImport: can(ctx, 'contacts.import'),
    canExport: can(ctx, 'contacts.export'),
    canAssign: can(ctx, 'contacts.assign'),
  };

  const { contacts: contactsResult, total: totalCount } = await getContacts({
    tenantId: tid,
    userId: ctx.userId,
    viewAll: permissions.canViewAll,
    q,
    status,
    limit,
    offset
  });

  const [companiesList, teamMembers, defaultView] = await Promise.all([
    db.query.companies.findMany({
      where: and(eq(companies.tenantId, tid), isNull(companies.deletedAt)),
      orderBy: [asc(companies.name)],
      columns: { id: true, name: true }
    }),
    db
      .select({
        user_id: tenantMembers.userId,
        full_name: users.fullName,
        avatar_url: users.avatarUrl,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active'))),
    getUserDefaultView(tid, ctx.userId),
  ]);

  // Map the typed Drizzle rows into the snake_case, JSON-serializable shape the
  // client component expects. Doing it explicitly here keeps the server →
  // client handoff fully typed instead of round-tripping through `any` (#1341).
  const initialContacts: ContactInput[] = contactsResult.map((c) => ({
    id: c.id,
    first_name: c.firstName,
    last_name: c.lastName ?? '',
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    company_name: c.companyName ?? undefined,
    lead_status: c.leadStatus ?? undefined,
    lead_source: c.leadSource ?? undefined,
    assigned_name: c.assignedName ?? undefined,
    assigned_to: c.assignedTo ?? undefined,
    score: c.score ?? undefined,
    tags: c.tags ?? undefined,
    city: c.city ?? undefined,
    country: c.country ?? undefined,
    lifecycle_stage: c.lifecycleStage ?? undefined,
    do_not_contact: c.doNotContact ?? undefined,
    last_activity_at: c.lastActivityAt ? c.lastActivityAt.toISOString() : undefined,
    created_at: c.createdAt ? c.createdAt.toISOString() : undefined,
  }));

  const teamMemberOptions: TeamMemberOpt[] = teamMembers.map((m) => ({
    user_id: m.user_id,
    full_name: m.full_name ?? '',
    avatar_url: m.avatar_url,
  }));

  return (
    <div className="space-y-6">
      <Suspense fallback={<LoadingSkeleton />}>
        <ContactsClient
          initialContacts={initialContacts}
          companies={companiesList}
          teamMembers={teamMemberOptions}
          permissions={permissions}
          totalCount={totalCount}
          tenantId={tid}
          userId={ctx.userId}
          initialOffset={offset}
          initialQ={q}
          initialStatus={status}
          defaultView={defaultView}
        />
      </Suspense>
    </div>
  );

  });
}
