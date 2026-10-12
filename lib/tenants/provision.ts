/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { dealStages, onboardingProgress, pipelines, roles, tenantMembers } from '@/drizzle/schema';
import { installDefaultModules } from '@/lib/modules/auto-install';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_STAGES = [
  { name: 'Lead', order: 0 },
  { name: 'Qualified', order: 1 },
  { name: 'Proposal', order: 2 },
  { name: 'Negotiation', order: 3 },
  { name: 'Won', order: 4 },
  { name: 'Lost', order: 5 },
];

export interface ProvisionWorkspaceOptions {
  tenantId: string;
  /** Made an active admin of the workspace. */
  userId: string;
  /** Plan whose default modules the workspace gets. */
  planId: string;
}

/**
 * Bring a tenant up to the state a first member signs up into: admin + sales
 * rep roles, an active admin membership, the default sales pipeline with its
 * stages, and the plan's modules.
 *
 * Every step is idempotent, so this doubles as the repair path for a tenant
 * that was created before any of it existed.
 *
 * The caller owns the RLS context. Each table written here isolates on
 * `app.current_tenant` with no super-admin escape, so `setTenantContext(tenantId,
 * userId, tx)` has to have run on this same transaction — without it the inserts
 * raise 42501 and the updates silently match zero rows while the route still
 * answers success. `installDefaultModules` additionally writes the `modules`
 * registry, which is gated on `app.is_super_admin`; callers that are not
 * super admin leave that GUC unset and the registry insert is skipped.
 */
export async function provisionTenantWorkspace(
  tx: Tx,
  { tenantId, userId, planId }: ProvisionWorkspaceOptions
): Promise<void> {
  let [adminRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'admin')))
    .limit(1);

  if (!adminRole) {
    [adminRole] = await tx
      .insert(roles)
      .values({
        tenantId,
        slug: 'admin',
        name: 'Administrator',
        permissions: { all: true },
        isSystem: true,
      })
      .returning({ id: roles.id });
  }

  if (!adminRole) throw new Error(`[provision] could not create the admin role for tenant ${tenantId}`);

  await tx
    .insert(tenantMembers)
    .values({
      tenantId,
      userId,
      roleId: adminRole.id,
      roleSlug: 'admin',
      status: 'active',
      joinedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tenantMembers.tenantId, tenantMembers.userId],
      set: { status: 'active', roleId: adminRole.id, roleSlug: 'admin', updatedAt: new Date() },
    });

  const [salesRep] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, 'sales_rep')))
    .limit(1);

  if (!salesRep) {
    await tx.insert(roles).values({
      tenantId,
      slug: 'sales_rep',
      name: 'Sales Representative',
      isSystem: false,
      sortOrder: 2,
      permissions: {
        'contacts.view': true, 'contacts.create': true, 'contacts.edit': true,
        'deals.view': true, 'deals.create': true, 'deals.edit': true,
        'tasks.view': true, 'tasks.create': true, 'tasks.manage': true,
      },
    });
  }

  // A workspace with no pipeline has never been opened, so this is also the
  // guard that keeps a second join from adding a duplicate default pipeline.
  const [existingPipeline] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), isNull(pipelines.deletedAt)))
    .limit(1);

  if (!existingPipeline) {
    const [pipeline] = await tx
      .insert(pipelines)
      .values({ tenantId, name: 'Sales Pipeline', isDefault: true })
      .returning({ id: pipelines.id });

    if (!pipeline) throw new Error(`[provision] could not create the default pipeline for tenant ${tenantId}`);

    await tx.insert(dealStages).values(
      DEFAULT_STAGES.map((stage) => ({
        tenantId,
        pipelineId: pipeline.id,
        name: stage.name,
        order: stage.order,
      }))
    );
  }

  await installDefaultModules(tenantId, planId, undefined, tx);

  await tx
    .insert(onboardingProgress)
    .values([
      { tenantId, userId, stepName: 'account_created', isCompleted: true, completedAt: new Date() },
      { tenantId, userId, stepName: 'onboarding_complete', isCompleted: true, completedAt: new Date() },
    ])
    .onConflictDoNothing();
}
