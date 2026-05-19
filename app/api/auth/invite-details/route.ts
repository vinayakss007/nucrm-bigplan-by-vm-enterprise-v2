import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { invitations, tenants, users } from '@/drizzle/schema';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

    const inv = await db
      .select({
        email: invitations.email,
        roleSlug: invitations.roleSlug,
        expiresAt: invitations.expiresAt,
        tenantName: tenants.name,
        primaryColor: tenants.primaryColor,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(and(
        eq(invitations.token, token),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date())
      ))
      .then(res => res[0]);

    if (!inv) return NextResponse.json({ error: 'Invitation not found or has expired' }, { status: 404 });

    // Check if already logged in with matching email
    let isLoggedIn = false;
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get('nucrm_session')?.value;
      if (sessionToken) {
        const p = await verifyToken(sessionToken);
        if (p) {
          const u = await db.query.users.findFirst({
            where: eq(users.id, p.userId),
            columns: { email: true }
          });
          isLoggedIn = u?.email?.toLowerCase() === inv.email.toLowerCase();
        }
      }
    } catch {}

    return NextResponse.json({
      email: inv.email, 
      role_slug: inv.roleSlug, 
      expires_at: inv.expiresAt,
      tenant_name: inv.tenantName, 
      primary_color: inv.primaryColor, 
      isLoggedIn,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
