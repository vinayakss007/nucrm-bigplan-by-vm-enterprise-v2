/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The parts of the SCIM single-user surface that are not per-verb logic.
 *
 * These three live here rather than in `app/api/scim/v2/Users/[id]/route.ts` because that file was
 * crossing **#1843**'s 500-line ceiling while #3303 wrapped every statement in a context, and
 * because `authenticateSCIM` had already been copied into `.../Users/route.ts` — a bearer-token
 * gate is the worst kind of thing to have two of. Same behaviour, one definition.
 *
 * Nothing here opens a transaction or names a privilege beyond what the caller already holds:
 * `withScimUserIdentity` (#3303) is the only context call, and it borrows the identity of the user
 * the caller passed, for the two questions SCIM has to ask across workspaces.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { sessions, tenantMembers } from '@/drizzle/schema';
import { and, eq, ne } from 'drizzle-orm';
import { generateSCIMError, verifySCIMToken } from '@/lib/scim';
import { withScimUserIdentity } from '@/lib/db/scim-context';
import type { RlsTransaction } from '@/lib/db/rls';

/**
 * Bearer check for every SCIM verb. Returns the workspace the token names, or the 401 to answer
 * with — so a caller that gets a `NextResponse` back must return it untouched.
 */
export async function authenticateSCIMRequest(
  request: NextRequest,
): Promise<{ tenantId: string } | NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      generateSCIMError('Bearer token required', 401),
      { status: 401, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }

  const token = authHeader.slice(7);
  // Accept tenant ID from header as fallback for v1 tokens;
  // v2 tokens embed the tenant ID and ignore the header value.
  const headerTenantId = request.headers.get('x-tenant-id') ?? '';

  const result = await verifySCIMToken(token, headerTenantId);
  if (!result) {
    return NextResponse.json(
      generateSCIMError('Invalid or expired SCIM token', 401),
      { status: 401, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }

  return { tenantId: result.tenantId };
}

/**
 * #2787 — the not-found answer, in the envelope every reader here has to return: SCIM clients
 * parse `application/scim+json`, and the row-missing body is deliberately what a malformed id
 * gets too, so the status cannot be used to ask whether a user exists.
 */
export function scimUserNotFound(): NextResponse {
  return NextResponse.json(
    generateSCIMError('User not found', 404),
    { status: 404, headers: { 'Content-Type': 'application/scim+json' } }
  );
}

/**
 * Revoke a user's login sessions on SCIM deactivate/delete — but ONLY when the
 * user has no OTHER active tenant membership.
 *
 * `sessions` are per-user and NOT tenant-scoped (the active tenant is resolved
 * per-request from membership). A blanket `DELETE FROM sessions WHERE user_id`
 * on a single-tenant deactivate therefore logs the user out of EVERY other
 * workspace they belong to — a cross-tenant denial of service triggered by one
 * tenant's IdP. We only clear sessions when this was their last active
 * workspace; otherwise their remaining workspaces keep them signed in and the
 * per-request membership check already denies access to the deactivated tenant.
 *
 * Both statements answer questions about the user ACROSS workspaces, which
 * `app.scim_tenant` deliberately cannot: `tenant_members_self_read` (0127) and
 * `sessions_user_own` (0088) admit exactly the user's own rows in every tenant,
 * so the reads borrow that user's identity and hand it back (#3303).
 *
 * @param tx        the active transaction (or db)
 * @param userId    the user being deactivated
 * @param tenantId  the tenant that just deactivated them (excluded from the check)
 */
export async function revokeSessionsIfLastActiveTenant(
  tx: RlsTransaction,
  userId: string,
  tenantId: string,
): Promise<void> {
  await withScimUserIdentity(tx, userId, async () => {
    // Any active membership in a DIFFERENT tenant means we must keep the user's
    // sessions (the deactivated tenant is already denied per-request).
    const otherActive = await tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.status, 'active'),
        ne(tenantMembers.tenantId, tenantId),
      ))
      .limit(1);

    if ((otherActive as Array<{ id: string }>).length === 0) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
  });
}
