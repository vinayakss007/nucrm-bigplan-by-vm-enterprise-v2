import { NextRequest } from 'next/server';

/**
 * Verify the cron secret from the request header
 */
export async function verifyCronSecret(req: NextRequest): Promise<boolean> {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || !process.env.CRON_SECRET) {
    return false;
  }
  return cronSecret === process.env.CRON_SECRET;
}
