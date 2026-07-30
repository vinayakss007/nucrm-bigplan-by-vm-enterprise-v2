/**
 * Deal Stage Change Notifications
 *
 * Sends real-time notifications when deals move between pipeline stages.
 * Critical for sales managers tracking pipeline movement.
 */

import { createNotification } from '@/lib/notifications';

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
    let type: 'info' | 'success' | 'warning' = 'info';

    if (isWon) {
      title = `Deal won: "${dealTitle}"`;
      type = 'success';
    } else if (isLost) {
      title = `Deal lost: "${dealTitle}"`;
      type = 'warning';
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
