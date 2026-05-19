import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * POST /api/superadmin/impersonate/stop
 * End current impersonation session
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    // End impersonation session (updates DB + creates audit log)
    await db.execute(sql`SELECT public.end_impersonation(${sessionId})`);

    // Clear last tenant
    await db
      .update(users)
      .set({ lastTenantId: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true, message: 'Impersonation ended' });
  } catch (err: any) {
    console.error('[Impersonation Stop] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/superadmin/impersonate/active
 * Get active impersonation sessions
 */
export async function GET(request: NextRequest) {
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
  } catch (err: any) {
    console.error('[Impersonation List] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

