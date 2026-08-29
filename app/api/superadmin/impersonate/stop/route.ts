/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, tenantMembers } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { withApiRoute } from '@/lib/api/with-api-route';

const schema = z.object({ sessionId: z.string().min(1) });

/**
 * POST /api/superadmin/impersonate/stop
 * End current impersonation session
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { sessionId } = validated.data;

    // Fetch impersonation session to retrieve original membership state before deleting it
    const sessionRes = await db.execute(sql`
      SELECT impersonator_id, tenant_id, notes
      FROM impersonation_sessions
      WHERE id = ${sessionId}::uuid AND ended_at IS NULL
      LIMIT 1
    `);

    const sessionRow = (sessionRes.rows?.[0] as Record<string, unknown>) || null;
    const impersonatorId = sessionRow?.impersonator_id as string | undefined;
    const tenantId = sessionRow?.tenant_id as string | undefined;

    // Parse the original membership state saved at impersonation start
    let originalMembershipState: {
      existed: boolean;
      status: string;
      roleSlug: string;
    } | null = null;
    if (sessionRow?.notes) {
      try {
        const parsed = JSON.parse(sessionRow.notes as string);
        originalMembershipState = parsed.originalMembershipState || null;
      } catch {
        // Malformed notes — safest to revert to non-member
        originalMembershipState = { existed: false, status: 'active', roleSlug: 'member' };
      }
    }

    // End impersonation session (deletes session + creates audit log)
    await db.execute(sql`SELECT public.end_impersonation(${sessionId})`);

    // Restore the superadmin's original tenant membership state
    if (impersonatorId && tenantId) {
      if (originalMembershipState?.existed) {
        // Restore to the original role and status
        await db
          .update(tenantMembers)
          .set({
            status: originalMembershipState.status,
            roleSlug: originalMembershipState.roleSlug,
          })
          .where(and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, impersonatorId),
          ));
      } else {
        // Membership was created solely for impersonation — remove it
        await db
          .delete(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, impersonatorId),
          ));
      }
    }

    // Clear last tenant
    await db
      .update(users)
      .set({ lastTenantId: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'user.impersonation_ended',
      targetType: 'user',
      metadata: { sessionId, originalMembershipState },
    });

    return NextResponse.json({ ok: true, message: 'Impersonation ended' });
 
 
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Impersonation Stop] Error:', err);
    return apiError(err);
  }
});

/**
 * GET /api/superadmin/impersonate/active
 * Get active impersonation sessions
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    // Using execute for view access
    const res = await db.execute(sql`
      SELECT id, super_admin_id, user_id, tenant_id, started_at, expires_at 
      FROM public.active_impersonation_sessions
      LIMIT 50
    `);

    return NextResponse.json({ data: res.rows });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Impersonation List] Error:', err);
    return apiError(err);
  }
});

