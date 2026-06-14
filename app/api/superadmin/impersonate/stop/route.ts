import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

const schema = z.object({ sessionId: z.string().min(1) });

/**
 * POST /api/superadmin/impersonate/stop
 * End current impersonation session
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const body = await request.json();
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { sessionId } = validated.data;

    // End impersonation session (updates DB + creates audit log)
    await db.execute(sql`SELECT public.end_impersonation(${sessionId})`);

    // Clear last tenant
    await db
      .update(users)
      .set({ lastTenantId: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ ok: true, message: 'Impersonation ended' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Impersonation Stop] Error:', err);
    return apiError(err);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[Impersonation List] Error:', err);
    return apiError(err);
  }
}

