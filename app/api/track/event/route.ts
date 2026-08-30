/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Product Analytics Ingest
 * POST /api/track/event
 *
 * Records how people use the NuCRM app itself (page views, feature usage,
 * lifecycle events). Works for both anonymous visitors and logged-in users:
 *
 *   - Identity (tenantId / userId) is resolved SERVER-SIDE from the session
 *     cookie. It is never taken from the request body.
 *   - Paid/plan (`isPaid`, `planId`) is resolved SERVER-SIDE from the tenant
 *     record via resolveEntitlement(). A client cannot claim to be paid.
 *   - The `nucrm_anon_id` cookie stitches pre-login and post-login events.
 *
 * The endpoint is intentionally forgiving: it is unauthenticated (anon events
 * are valid) and rate-limited per IP. It always returns 204 on accepted input
 * so client tracking never surfaces errors to end users.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { safeJson } from '@/lib/api/validate';
import { checkPublicRateLimit } from '@/lib/rate-limit-simple';
import { getSessionToken, verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { users, tenantMembers } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { ensureAnonId } from '@/lib/analytics/cookie';
import { resolveEntitlement } from '@/lib/analytics/entitlement';
import { recordEvent } from '@/lib/analytics/store';

const MAX_PROPERTIES_BYTES = 8_192;

const eventSchema = z.object({
  // Event name: short, snake/kebab identifier. Rejects free-form junk.
  event: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/, 'invalid event name'),
  properties: z.record(z.string(), z.unknown()).optional(),
  url: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  sessionId: z.string().max(128).optional(),
});

/**
 * Resolve the caller's tenantId/userId from the session cookie WITHOUT the
 * full requireAuth machinery (no RLS pinning needed for an append-only insert
 * and we must tolerate anonymous callers). Returns nulls when unauthenticated.
 */
async function resolveIdentity(): Promise<{ userId: string | null; tenantId: string | null }> {
  try {
    const token = await getSessionToken();
    if (!token) return { userId: null, tenantId: null };

    const payload = await verifyToken(token);
    if (!payload?.userId) return { userId: null, tenantId: null };

    // Prefer the user's last-active tenant; fall back to any active membership.
    const [row] = await db
      .select({
        userId: users.id,
        lastTenantId: users.lastTenantId,
        memberTenantId: tenantMembers.tenantId,
      })
      .from(users)
      .leftJoin(
        tenantMembers,
        and(eq(tenantMembers.userId, users.id), eq(tenantMembers.status, 'active')),
      )
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!row) return { userId: null, tenantId: null };
    return {
      userId: row.userId,
      tenantId: row.lastTenantId ?? row.memberTenantId ?? null,
    };
  } catch (err) {
    void logError({ error: err, context: 'track/event identity-resolution', level: 'warning' });
    return { userId: null, tenantId: null };
  }
}

export async function POST(req: NextRequest) {
  // Per-IP rate limit — generous enough for normal page-view volume, tight
  // enough to blunt abuse of an unauthenticated endpoint.
  const limited = checkPublicRateLimit(req, { max: 120, windowMs: 60_000, prefix: 'track-event' });
  if (limited) return limited;

  const parsed = await safeJson(req);
  if (parsed instanceof NextResponse) return parsed;

  const result = validateBody(eventSchema, parsed.data);
  if (result instanceof NextResponse) return result;
  const body = result.data;

  // Guard against oversized property blobs bloating the event stream.
  const props = body.properties ?? {};
  if (JSON.stringify(props).length > MAX_PROPERTIES_BYTES) {
    return NextResponse.json({ error: 'properties payload too large' }, { status: 413 });
  }

  // Stable browser id (mints + sets the cookie if absent).
  const anonId = await ensureAnonId();

  // Server-resolved identity + entitlement. Never trusted from the client.
  const { userId, tenantId } = await resolveIdentity();
  const entitlement = tenantId
    ? await resolveEntitlement(tenantId)
    : { tenantId: null, planId: null, isPaid: false };

  await recordEvent({
    anonId,
    eventName: body.event,
    tenantId,
    userId,
    isPaid: entitlement.isPaid,
    planId: entitlement.planId,
    properties: props,
    url: body.url ?? '',
    referrer: body.referrer ?? '',
    sessionId: body.sessionId ?? '',
  });

  // 204: accepted, nothing to return. Cookie (if newly minted) rides along.
  return new NextResponse(null, { status: 204 });
}
