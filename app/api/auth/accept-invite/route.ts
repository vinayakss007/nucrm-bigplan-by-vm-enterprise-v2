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
import { invitations, tenants, users, roles, tenantMembers } from '@/drizzle/schema';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { withTenantContext } from '@/lib/db/rls';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';

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

    // #3182: `invitations` has one shipped policy, 0037's `tenant_isolation`
    // FOR ALL, and it compares `tenant_id` to `app.current_tenant` — a value this
    // request does not have, because finding it IS the query. Read on the
    // contextless pool it matched nothing and the route answered 404 for a live
    // invitation: acceptance was unreachable, not merely wrong. So the read runs
    // under the credential arm 0133 adds for exactly this lookup — SELECT-only,
    // keyed on the token the caller presented, never on a tenant it names. The
    // tenant-scoped half below is a separate context, which is what keeps the
    // narrow read narrow (`lib/db/portal-lookup-context.ts:126`).
    const inv = await withPortalLookupContext({ accessToken: inviteToken }, (tx) =>
      tx
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
          isNull(invitations.deletedAt),
          gt(invitations.expiresAt, new Date())
        ))
        .then(res => res[0]));

    if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 });

    // #3182, second half: the writes below were no better off. A transaction
    // handle carries no GUCs of its own (#2446), so `tx.insert(tenantMembers)`
    // raised 42501 and `tx.update(invitations).set({ acceptedAt })` matched zero
    // rows without an error — an accepted invitation that stays live forever. The
    // `users` read belongs in this context too: `users_read_self` keys on
    // `app.current_user`, which is the other half of what `withTenantContext`
    // sets, and that is why the identity is the real session user rather than
    // `NO_USER_SENTINEL`. The email check returns as data and is answered outside,
    // the #2446 rule that no branch may reply while the transaction still holds a
    // half-done join.
    const outcome = await withTenantContext(inv.tenantId, userId, async (tx): Promise<'email_mismatch' | 'accepted'> => {
      const user = await tx.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true }
      });

      if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) return 'email_mismatch';

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

      return 'accepted';
    });

    if (outcome === 'email_mismatch') {
      return NextResponse.json({ error: 'This invitation is for a different email address' }, { status: 403 });
    }

    return NextResponse.json({ ok: true, tenant_name: inv.tenantName });
 
 
  } catch (err) {
    void logError({ error: err, context: 'auth/accept-invite POST', requestUrl: request.url, requestMethod: request.method });
    return apiError(err);
  }
}
