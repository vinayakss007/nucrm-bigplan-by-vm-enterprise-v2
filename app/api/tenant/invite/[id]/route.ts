import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invitations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(request: NextRequest, { params }: any) {
  try {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Invitation] DELETE error:', err);
    return apiError(err);
  }
}
