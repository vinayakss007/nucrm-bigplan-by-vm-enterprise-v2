/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { checkRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';
import { withTenantContext } from '@/lib/db/rls';
import { invitations, tenants, users, roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    // Get current user from session
    const cookieStore = await cookies();
    const token = cookieStore.get('nucrm_session')?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    // #2216: require a live sessions row, not just a valid JWT signature.
    const session = await getCurrentUserForToken(token);
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    const userId = session.id;

    const limited = await checkRateLimit(request, { action: 'accept-invite', max: 10, windowMinutes: 15 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { token: inviteToken } = validated.data;

    // #3182: this row is what names the workspace, so the read cannot run in a tenant
    // context the request does not have yet. `invitations` carries only
    // `tenant_isolation`, so the contextless pool read answered 0 rows and the route
    // returned 404 "Invitation not found or expired" for every genuine invitation.
    // Migration 0133 adds a SELECT-only arm on `app.portal_lookup_token` — the same
    // credential GUC 0122/0123 use — and every write below runs in the tenant
    // context this lookup supplies.
    const inv = await withPortalLookupContext({ accessToken: inviteToken }, (lookup) =>
      lookup
        .select({
          id: invitations.id,
          tenantId: invitations.tenantId,
          email: invitations.email,
          roleSlug: invitations.roleSlug,
          invitedBy: invitations.invitedBy,
          tenantName: tenants.name,
        })
        .from(invitations)
        .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
        .where(and(
          eq(invitations.token, inviteToken),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date())
        ))
        .then(res => res[0]));

    if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 });

    // #3182: this used to re-read `users` on the bare pool to get the address. That
    // read is policed by `users_read_self` (app.current_user), so it answered
    // undefined and every invite — right token or not — came back
    // 403 "This invitation is for a different email address". The session already
    // carries the verified address: getCurrentUserForToken() resolves it through
    // withAuthResolutionContext (#2216), so there is nothing left to read.
    if (!session.email || session.email.toLowerCase() !== inv.email.toLowerCase()) {
      return NextResponse.json({ error: 'This invitation is for a different email address' }, { status: 403 });
    }

    // #3182: a db.transaction() handle carries no tenant GUCs, so this block was both
    // refused (the `tenant_members` INSERT raised 42501) and silently inert (the
    // `accepted_at` UPDATE matched no visible row and affected 0). withTenantContext
    // sets app.current_tenant and app.current_user for the whole block, which is what
    // `tenants_authenticated_update` and `users_update_own` need alongside
    // `tenant_isolation`'s WITH CHECK.
    await withTenantContext(inv.tenantId, userId, async (tx) => {
      // Find role
      const role = await tx.query.roles.findFirst({
        where: and(
          eq(roles.tenantId, inv.tenantId),
          eq(roles.slug, inv.roleSlug)
        ),
        columns: { id: true }
      });

      // Upsert tenant member
      await tx.insert(tenantMembers)
        .values({
          tenantId: inv.tenantId,
          userId: userId,
          roleSlug: inv.roleSlug,
          roleId: role?.id || null,
          status: 'active',
          invitedBy: inv.invitedBy,
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tenantMembers.tenantId, tenantMembers.userId],
          set: {
            roleSlug: inv.roleSlug,
            roleId: role?.id || null,
            status: 'active',
            joinedAt: new Date(),
            updatedAt: new Date(),
          }
        });

      // Mark invitation as accepted
      await tx.update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, inv.id));

      // Update user's last tenant
      await tx.update(users)
        .set({ lastTenantId: inv.tenantId })
        .where(eq(users.id, userId));

      // Update tenant user count
      const memberCount = await tx
        .select({ count: sql`count(*)` })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, inv.tenantId),
          eq(tenantMembers.status, 'active')
        ))
        .then(res => Number(res[0]?.count || 0));

      await tx.update(tenants)
        .set({ currentUsers: memberCount })
        .where(eq(tenants.id, inv.tenantId));
    });

    return NextResponse.json({ ok: true, tenant_name: inv.tenantName });
 
 
  } catch (err) {
    void logError({ error: err, context: 'auth/accept-invite POST', requestUrl: request.url, requestMethod: request.method });
    return apiError(err);
  }
}
