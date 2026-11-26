/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextResponse } from 'next/server';
import { cache } from '@/lib/cache';

const KEY_PREFIX = 'v1_2fa_fail:';
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export async function check2faLockout(userId: string): Promise<NextResponse | null> {
  const failures = await cache.get<number>(keyFor(userId));
  if (typeof failures === 'number' && failures >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many failed verification attempts. Try again in 15 minutes.' },
      { status: 429 },
    );
  }
  return null;
}

export async function record2faFailure(userId: string): Promise<void> {
  const attempts = await cache.incr(keyFor(userId), WINDOW_SECONDS);
  if (attempts === 0) {
    throw new Error('2FA failure counter is unavailable — refusing an unverifiable attempt');
  }
}

export async function clear2faFailures(userId: string): Promise<void> {
  await cache.del(keyFor(userId));
}
