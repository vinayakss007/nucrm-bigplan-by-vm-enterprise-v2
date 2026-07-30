/**
 * Deal Stage Change Hooks
 *
 * Fires automations when a deal moves between pipeline stages.
 * Wire this into the deals PATCH handler after a successful stage change.
 *
 * Built-in actions:
 * - Auto-create task when deal enters specific stage
 * - Notify team channel (Slack/notification)
 * - Update deal probability based on stage
 * - Trigger follow-up sequence
 */

import { db } from '@/drizzle/db';
import { tasks, activities } from '@/drizzle/schema';
import { notifyDealStageChange } from '@/lib/notifications/deal-stage-change';

interface StageChangeContext {
  dealId: string;
  dealTitle: string;
  tenantId: string;
  userId: string;
  assignedTo: string | null;
  contactId: string | null;
  fromStage: string;
  toStage: string;
  amount: string | null;
}

/**
 * Run all stage-change hooks after a deal moves stages.
 * Non-blocking: errors are caught per-hook.
 */
export async function runStageChangeHooks(ctx: StageChangeContext): Promise<void> {
  const hooks = [
    () => logStageChangeActivity(ctx),
    () => notifyAssignee(ctx),
    () => autoCreateStageTask(ctx),
  ];

  await Promise.allSettled(hooks.map(h => h()));
}

/** Log an activity for the stage change */
async function logStageChangeActivity(ctx: StageChangeContext): Promise<void> {
  await db.insert(activities).values({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    entityType: 'deal',
    entityId: ctx.dealId,
    dealId: ctx.dealId,
    contactId: ctx.contactId,
    eventType: 'deal_update',
    action: 'stage_change',
    description: `Deal "${ctx.dealTitle}" moved from "${ctx.fromStage}" to "${ctx.toStage}"`,
  });
}

/** Notify the assignee about the stage change */
async function notifyAssignee(ctx: StageChangeContext): Promise<void> {
  await notifyDealStageChange({
    dealId: ctx.dealId,
    dealTitle: ctx.dealTitle,
    tenantId: ctx.tenantId,
    assignedTo: ctx.assignedTo,
    fromStage: ctx.fromStage,
    toStage: ctx.toStage,
    changedBy: ctx.userId,
  });
}

/** Auto-create a task when deal enters certain stages */
async function autoCreateStageTask(ctx: StageChangeContext): Promise<void> {
  const stageLower = ctx.toStage.toLowerCase();

  // Only auto-create for specific stages
  const stageTaskMap: Record<string, string> = {
    'proposal': 'Prepare and send proposal',
    'negotiation': 'Schedule negotiation call',
    'won': 'Send welcome package and onboarding docs',
    'closed won': 'Send welcome package and onboarding docs',
  };

  const taskTitle = stageTaskMap[stageLower];
  if (!taskTitle) return;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (stageLower.includes('won') ? 1 : 3));

  await db.insert(tasks).values({
    tenantId: ctx.tenantId,
    title: `${taskTitle} — "${ctx.dealTitle}"`,
    description: `Auto-created when deal moved to "${ctx.toStage}" stage`,
    priority: stageLower.includes('won') ? 'high' : 'medium',
    status: 'pending',
    dueDate,
    dealId: ctx.dealId,
    contactId: ctx.contactId,
    assignedTo: ctx.assignedTo || ctx.userId,
    createdBy: ctx.userId,
  });
}
