/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, count } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

// Public endpoint — checks if any SUPER ADMIN users exist yet
export async function GET(request: NextRequest) {
  // #1154: throttle this unauthenticated endpoint to slow enumeration/timing.
  const limited = await checkRateLimit(request, { action: 'setup-check', max: 10, windowMinutes: 1 });
  if (limited) return limited;

  try {
    const [row] = await db.select({ 
      count: count() 
    })
    .from(users)
    .where(eq(users.isSuperAdmin, true));

    return NextResponse.json({ setup_done: (row?.count ?? 0) > 0 });
  } catch (err) {
    // #1151: on a DB error we do NOT know the install state. Returning
    // `setup_done: false` here was misleading and could make an existing
    // install look fresh. Surface a 503 so the client does not proceed as if
    // setup were open. (create-admin independently rejects when an admin
    // already exists, so this is defence-in-depth.)
    void logError({ error: err, context: 'setup/check' });
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
