/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The realtime handshake: cookie -> verified session -> tenant, in one place.
 *
 * Extracted from `realtime.ts` for #3289. That file is a process entry point — it binds an HTTP
 * server, opens two Redis clients and installs the socket.io adapter at import time — so nothing
 * ever reached this logic in a test, which is how a handshake that rejected *every* connection
 * stayed undetected: the failure surfaces as a client-side `connect_error`, and the server keeps
 * reporting `online` with a plausible `clientsCount`.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { getCurrentUserForToken } from '@/lib/auth/session';

const SESSION_COOKIE = 'nucrm_session';

/** Minimal cookie-header parser — avoids a dependency for one header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export type HandshakeOutcome =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; rejection: 'unauthorized' | 'forbidden' };

/**
 * Resolve a handshake's identity from the `nucrm_session` cookie. The client never tells us who it
 * is: rooms are derived from what this returns, so a caller cannot subscribe to another user's or
 * another tenant's room by asking for it.
 */
export async function resolveHandshakeIdentity(cookieHeader: string | undefined): Promise<HandshakeOutcome> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return { ok: false, rejection: 'unauthorized' };

  // #2216: the handshake must fail once the session row is gone, even while the JWT itself is
  // still cryptographically valid.
  const verified = await getCurrentUserForToken(token);
  if (!verified?.id) return { ok: false, rejection: 'unauthorized' };

  // Resolve the tenant from the membership table, not from the client.
  const [membership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, verified.id),
        eq(tenantMembers.status, 'active'),
      ),
    )
    .limit(1);

  if (!membership?.tenantId) return { ok: false, rejection: 'forbidden' };

  return { ok: true, userId: verified.id, tenantId: membership.tenantId };
}
