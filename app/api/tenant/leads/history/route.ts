/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leadAssignments, leads, users } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { parseLimitOffset } from '@/lib/api/query-params';
import { ownerScope } from '@/lib/api/owner-scope';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldRead } from '@/lib/rbac/enforce';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('lead_id');
    const { limit } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

    const assignedToUser = aliasedTable(users, 'assigned_to_user');
    
    const query = db
      .select({
        id: leadAssignments.id,
        tenantId: leadAssignments.tenantId,
        leadId: leadAssignments.leadId,
        userId: leadAssignments.userId,
        assignedAt: leadAssignments.assignedAt,
        reason: leadAssignments.reason,
        createdAt: leadAssignments.createdAt,
        assignedToName: assignedToUser.fullName,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
      })
      .from(leadAssignments)
      .leftJoin(assignedToUser, eq(assignedToUser.id, leadAssignments.userId))
      .leftJoin(leads, eq(leads.id, leadAssignments.leadId))
      .where(
        and(
          eq(leadAssignments.tenantId, ctx.tenantId),
          leadId ? eq(leadAssignments.leadId, leadId) : undefined,
          // #2696 — the trail joins `leads` for the name columns, so the lead's
          // own owner rule is available right here and its absence meant a rep
          // could read every handoff in the workspace (and, with `lead_id` set,
          // confirm that an unfamiliar id exists and who held it). A `view_all`
          // holder gets `undefined`, which drizzle's `and()` skips — see
          // lib/api/owner-scope.ts.
          ownerScope(ctx, 'leads.view_all', leads)
        )
      )
      .orderBy(desc(leadAssignments.createdAt))
      .limit(limit);

    const rows = await query;
    // #2618 — every history row carries the lead's name via a join
    // (leadFirstName/leadLastName); alias those spellings to first_name /
    // last_name so a name-hidden role does not recover it from the trail.
    const data = await enforceFieldRead(ctx, 'leads', rows);
    return NextResponse.json({ data });
 
 
  } catch (err) { 
    await logError({ error: err, context: 'tenant/leads/history GET', requestMethod: 'GET' });
    return apiError(err); 
  }
});
