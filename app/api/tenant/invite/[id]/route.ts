/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invitations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DELETE = withApiRoute(async (request: NextRequest, { params }: any) => {
  try {
  const limited = await rateLimitMutating(request, 'settings', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { id } = await params;
    
    const result = await db.delete(invitations)
      .where(and(
        eq(invitations.id, id),
        eq(invitations.tenantId, ctx.tenantId)
      ));
      
    if (result.rowCount === 0) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'tenant/invite/[id] DELETE' });
    return apiError(err);
  }
});
