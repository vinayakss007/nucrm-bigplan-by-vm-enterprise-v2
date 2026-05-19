import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { auditLogs, users } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import AuditLogClient from '@/components/tenant/settings/audit-client';

export default async function AuditLogPage() {
  const ctx = await requireTenantCtx();
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  const logs = await db.select({
    id: auditLogs.id,
    action: auditLogs.action,
    resource_type: auditLogs.entityType,
    resource_id: auditLogs.entityId,
    created_at: auditLogs.createdAt,
    ip_address: auditLogs.ipAddress,
    old_data: auditLogs.oldData,
    new_data: auditLogs.newData,
    full_name: users.fullName,
    email: users.email,
  })
  .from(auditLogs)
  .leftJoin(users, eq(users.id, auditLogs.userId))
  .where(eq(auditLogs.tenantId, ctx.tenantId))
  .orderBy(desc(auditLogs.createdAt))
  .limit(500);

  return <AuditLogClient logs={logs} />;
}
