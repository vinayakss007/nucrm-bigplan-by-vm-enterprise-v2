/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Keep-Alive Endpoint
 * 
 * Simple query to keep Neon connection warm
 * Called every 5 minutes by client-side service
 */
export async function POST(request: NextRequest) {
  try {
    // #1154: throttle this unauthenticated endpoint against abuse.
    const limited = await checkRateLimit(request, { action: 'keepalive', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    await db.execute(sql`SELECT 1 as ping`);

    // #1153: do not disclose server timestamp or query latency to
    // unauthenticated callers — return only a liveness boolean.
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'keepalive' });
    return apiError(err, "Internal server error", 500);
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
