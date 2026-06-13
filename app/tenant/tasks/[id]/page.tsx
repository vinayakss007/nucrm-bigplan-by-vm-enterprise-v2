import { requireTenantCtx, can } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { tasks, contacts, deals, users } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import TaskDetailClient from '@/components/tenant/task-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;

  const [task] = await db.select({
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    status: tasks.status,
    priority: tasks.priority,
    due_at: tasks.dueDate,
    created_at: tasks.createdAt,
    updated_at: tasks.updatedAt,
    contact_id: tasks.contactId,
    deal_id: tasks.dealId,
    assigned_to: tasks.assignedTo,
    tenant_id: tasks.tenantId,
    first_name: contacts.firstName,
    last_name: contacts.lastName,
    contact_email: contacts.email,
    deal_title: deals.title,
    deal_value: deals.amount,
    assigned_name: users.fullName,
    assigned_avatar: users.avatarUrl,
  })
  .from(tasks)
  .leftJoin(contacts, eq(contacts.id, tasks.contactId))
  .leftJoin(deals, eq(deals.id, tasks.dealId))
  .leftJoin(users, eq(users.id, tasks.assignedTo))
  .where(
    and(
      eq(tasks.id, id),
      eq(tasks.tenantId, ctx.tenantId),
      isNull(tasks.deletedAt)
    )
  )
  .limit(1);

  if (!task) notFound();

  const permissions = {
    canEdit: can(ctx, 'tasks.edit'),
    canDelete: can(ctx, 'tasks.delete'),
    canAssign: can(ctx, 'tasks.assign'),
  };

  return (
    <TaskDetailClient
      task={task}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
