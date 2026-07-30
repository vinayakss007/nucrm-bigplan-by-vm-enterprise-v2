/**
 * Deal Stage Change Notifications
 *
 * Sends real-time notifications when deals move between pipeline stages.
 * Critical for sales managers tracking pipeline movement.
 */

import { createNotification, type NotificationType } from '@/lib/notifications';

interface StageChangePayload {
  dealId: string;
  dealTitle: string;
  tenantId: string;
  assignedTo: string | null;
  fromStage: string;
  toStage: string;
  changedBy: string;
}

/**
 * Notify the deal's assigned user when their deal changes stage.
 * Skip if the changer IS the assignee (they already know).
 */
export async function notifyDealStageChange(payload: StageChangePayload): Promise<void> {
  try {
    const { dealId, dealTitle, tenantId, assignedTo, fromStage, toStage, changedBy } = payload;

    // Don't notify if no assignee or if assignee made the change
    if (!assignedTo || assignedTo === changedBy) return;

    const isWon = toStage.toLowerCase().includes('won');
    const isLost = toStage.toLowerCase().includes('lost');

    let title: string;
    // Must be a NotificationType (lib/notifications.ts). There is no generic
    // severity in that union, and no 'deal_lost' member, so a lost deal is
    // reported as a stage change like any other non-win.
    let type: NotificationType = 'deal_stage';

    if (isWon) {
      title = `Deal won: "${dealTitle}"`;
      type = 'deal_won';
    } else if (isLost) {
      title = `Deal lost: "${dealTitle}"`;
      type = 'deal_stage';
    } else {
      title = `Deal "${dealTitle}" moved to ${toStage}`;
    }

    await createNotification({
      userId: assignedTo,
      tenantId,
      type,
      title,
      body: `Stage changed from "${fromStage}" to "${toStage}"`,
      link: `/tenant/deals/${dealId}`,
    });
  } catch (err) {
    console.error('[notifications] Deal stage change notification failed:', err);
  }
}
