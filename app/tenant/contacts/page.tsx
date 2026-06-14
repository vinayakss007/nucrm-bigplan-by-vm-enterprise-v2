import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { companies, tenantMembers, users } from '@/drizzle/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { getContacts } from '@/lib/db/services/contacts';
import { Suspense } from 'react';
import ContactsClient from '@/components/tenant/contacts-client';
import { toSnakeCase } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

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

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ offset?: string; q?: string; status?: string }> }) {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;
  const sp = await searchParams;
  const offset = parseInt(sp.offset || '0');
  const q = sp.q || '';
  const status = sp.status || 'all';
  const limit = 50;

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

  const [companiesList, teamMembers] = await Promise.all([
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
      .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active')))
  ]);

  return (
    <div className="space-y-6">
      <Suspense fallback={<LoadingSkeleton />}>
        <ContactsClient
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialContacts={toSnakeCase(contactsResult as any) as any}
          companies={companiesList}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          teamMembers={teamMembers as any}
          permissions={permissions}
          totalCount={totalCount}
          tenantId={tid}
          userId={ctx.userId}
          initialOffset={offset}
          initialQ={q}
          initialStatus={status}
        />
      </Suspense>
    </div>
  );
}
