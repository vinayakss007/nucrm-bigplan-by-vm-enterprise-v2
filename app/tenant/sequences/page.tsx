import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { sequences as sequencesTable, sequenceEnrollments, contacts } from '@/drizzle/schema';
import { eq, sql, desc } from 'drizzle-orm';
import SequencesClient from '@/components/tenant/sequences-client';

export default async function SequencesPage() {
  const ctx = await requireTenantCtx();
  
  const permissions = {
    canView: can(ctx, 'automations.view'),
    canManage: can(ctx, 'automations.manage'),
  };

  const [sequences, enrollments] = await Promise.all([
    db.select({
      id: sequencesTable.id,
      name: sequencesTable.name,
      description: sequencesTable.description,
      status: sequencesTable.status,
      created_at: sequencesTable.createdAt,
      updated_at: sequencesTable.updatedAt,
      tenant_id: sequencesTable.tenantId,
      enrollment_count: sql<number>`(SELECT count(*)::int FROM sequence_enrollments WHERE sequence_id = ${sequencesTable.id})`,
      active_count: sql<number>`(SELECT count(*)::int FROM sequence_enrollments WHERE sequence_id = ${sequencesTable.id} AND status = 'active')`,
    })
    .from(sequencesTable)
    .where(eq(sequencesTable.tenantId, ctx.tenantId))
    .orderBy(desc(sequencesTable.createdAt)),

    db.select({
      id: sequenceEnrollments.id,
      sequence_id: sequenceEnrollments.sequenceId,
      contact_id: sequenceEnrollments.contactId,
      status: sequenceEnrollments.status,
      enrolled_at: sequenceEnrollments.enrolledAt,
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      email: contacts.email,
    })
    .from(sequenceEnrollments)
    .innerJoin(contacts, eq(contacts.id, sequenceEnrollments.contactId))
    .where(eq(sequenceEnrollments.tenantId, ctx.tenantId))
    .orderBy(desc(sequenceEnrollments.enrolledAt))
    .limit(50),
  ]);

  return (
    <SequencesClient
      sequences={sequences}
      recentEnrollments={enrollments}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
