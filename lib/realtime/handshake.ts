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
import { and, asc, eq } from 'drizzle-orm';
import { tenantMembers } from '@/drizzle/schema';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { withAuthResolutionContext } from '@/lib/db/rls';

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

/**
 * Why a handshake was refused. `rejection` is what the socket sees and has to stay the two names
 * it already returned; `reason` is the server-side distinction those two names collapse —
 * `unauthorized` used to mean both "no credential" and "session gone", and `forbidden` meant only
 * "membership not found", which under FORCE RLS was also every member of every workspace.
 */
export type HandshakeRejection = 'no_cookie' | 'no_session' | 'no_membership';

export interface HandshakeOutcome {
  userId?: string;
  tenantId?: string;
  rejection?: 'unauthorized' | 'forbidden';
  reason?: HandshakeRejection;
}

const rejections: Record<HandshakeRejection, number> = { no_cookie: 0, no_session: 0, no_membership: 0 };

/** Exposed so `/healthz` can show rejections climbing while `clientsCount` sits at zero. */
export function getHandshakeRejectionCounts(): Record<HandshakeRejection | 'total', number> {
  return {
    ...rejections,
    total: rejections.no_cookie + rejections.no_session + rejections.no_membership,
  };
}

function refuse(reason: HandshakeRejection, userId?: string): HandshakeOutcome {
  rejections[reason] += 1;
  // The value being refused is a bearer credential, so it is never logged — the reason and, when
  // one is known, the user id are the whole record.
  console.warn(`[Realtime] handshake rejected: ${reason}${userId ? ` user=${userId}` : ''}`);
  return {
    rejection: reason === 'no_membership' ? 'forbidden' : 'unauthorized',
    reason,
  };
}

/**
 * Resolve a handshake's identity from the `nucrm_session` cookie. The client never tells us who it
 * is: rooms are derived from what this returns, so a caller cannot subscribe to another user's or
 * another tenant's room by asking for it.
 */
export async function resolveHandshakeIdentity(cookieHeader: string | undefined): Promise<HandshakeOutcome> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return refuse('no_cookie');

  // #2216: the handshake must fail once the session row is gone, even while the JWT itself is
  // still cryptographically valid.
  const verified = await getCurrentUserForToken(token);
  if (!verified?.id) return refuse('no_session');

  // Resolve the tenant from the membership table, not from the client.
  //
  // #3289: this read used to run on the bare pool, and `tenant_members_self_read` (0127) is
  // `status = 'active' AND user_id = current_setting('app.current_user')::uuid` — the identity this
  // handshake is still in the middle of establishing. `lib/db/pool.ts` clears every `app.*` GUC on
  // acquire AND release, so the deparsed policy matched zero rows for every user and every socket
  // was refused with `forbidden`. `withAuthResolutionContext` is what `getCurrentUserForToken`
  // itself uses for the same chicken-and-egg (#2216, PP-026) and is read-only by construction.
  //
  // A member of several workspaces then has to be picked deterministically. The old unordered
  // `.limit(1)` chose whichever row the heap returned first, which is why this reads the caller's
  // own active memberships (a small set, and 0127 confines it to exactly that) and prefers the
  // workspace the app last put them in; `asc(tenant_id)` makes the fallback stable instead of
  // arbitrary.
  const memberships = await withAuthResolutionContext(verified.id, (tx) =>
    tx
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, verified.id), eq(tenantMembers.status, 'active')))
      .orderBy(asc(tenantMembers.tenantId))
  );

  // Destructuring rather than `length === 0` + `memberships[0]` — the indexed read is `T |
  // undefined` under `noUncheckedIndexedAccess`, so the emptiness test and the fall-back value are
  // the same statement.
  const [first] = memberships;
  if (!first) return refuse('no_membership', verified.id);

  const lastTenantId = verified.lastTenantId ?? null;
  const tenantId =
    lastTenantId && memberships.some((m) => m.tenantId === lastTenantId)
      ? lastTenantId
      : first.tenantId;

  return { userId: verified.id, tenantId };
}
