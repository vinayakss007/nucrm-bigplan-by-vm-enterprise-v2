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
import { parseLimitOffset } from '@/lib/api/query-params';
import { withApiRoute } from '@/lib/api/with-api-route';

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
          leadId ? eq(leadAssignments.leadId, leadId) : undefined
        )
      )
      .orderBy(desc(leadAssignments.createdAt))
      .limit(limit);

    const data = await query;
    
    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) { 
    console.error('[leads/history]', err);
    return apiError(err); 
  }
});
