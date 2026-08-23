/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { verifySecret } from '@/lib/crypto';

/**
 * Verify the cron secret from the request header
 * Uses timing-safe comparison to prevent timing attacks
 */
export async function verifyCronSecret(req: NextRequest): Promise<boolean> {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || !process.env.CRON_SECRET) {
    return false;
  }
  return verifySecret(cronSecret, process.env.CRON_SECRET);
}
