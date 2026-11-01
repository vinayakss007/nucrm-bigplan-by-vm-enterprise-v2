/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { alertSuperAdmin } from './service';
import type { SendResult } from './service';

export async function sendAlertEmail(subject: string, message: string): Promise<SendResult> {
  return alertSuperAdmin(subject, message);
}
