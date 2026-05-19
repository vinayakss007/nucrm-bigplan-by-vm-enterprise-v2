import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, activities } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

/**
 * Admin Recovery: Disable 2FA for a user
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Only super admins can disable 2FA for others
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const { user_email, reason } = await request.json();

    if (!user_email) {
      return NextResponse.json({ error: 'User email required' }, { status: 400 });
    }

    // Find user
    const userRow = await db.query.users.findFirst({
      where: eq(sql`lower(${users.email})`, user_email.toLowerCase().trim()),
      columns: { id: true, email: true, fullName: true, totpEnabled: true }
    });

    if (!userRow) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!userRow.totpEnabled) {
      return NextResponse.json({ error: 'User does not have 2FA enabled' }, { status: 400 });
    }

    // Disable 2FA for user
    await db.update(users)
      .set({ 
        totpEnabled: false, 
        totpSecret: null, 
        totpBackupCodes: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, userRow.id));

    // Log the action
    await logAudit({ 
      tenantId: ctx.tenantId, 
      userId: ctx.userId, 
      action: 'admin_disable_2fa', 
      entityType: 'user', 
      entityId: userRow.id, 
      newData: { reason: reason || 'Admin recovery', user_email } 
    });

    return NextResponse.json({
      ok: true,
      message: `2FA disabled for ${userRow.email}`,
      user: { email: userRow.email, full_name: userRow.fullName }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
