import { apiError } from '@/lib/api-error';
/**
 * GDPR Data Export — GET /api/user/export
 * Returns all personal data for the authenticated user as JSON.
 * Required by GDPR Article 20 (right to data portability).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, sessions, activities, notifications, tenantMembers, tenants } from '@/drizzle/schema';
import { eq, desc, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [profile, userSessions, userActivities, userNotifications, memberships] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, ctx.userId),
        columns: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          timezone: true,
          avatarUrl: true,
          emailVerified: true,
          createdAt: true
        }
      }),
      db.select({
        id: sessions.id,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt
      })
      .from(sessions)
      .where(eq(sessions.userId, ctx.userId))
      .orderBy(desc(sessions.createdAt)),

      db.select({
        type: activities.eventType,
        description: activities.description,
        createdAt: activities.createdAt
      })
      .from(activities)
      .where(eq(activities.userId, ctx.userId))
      .orderBy(desc(activities.createdAt))
      .limit(500),

      db.select({
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        isRead: (notifications as { isRead: unknown }).isRead,
        createdAt: notifications.createdAt
      })
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(200),

      db.select({
        org_name: tenants.name,
        role_slug: tenantMembers.roleSlug,
        status: tenantMembers.status,
        joined_at: tenantMembers.joinedAt
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(eq(tenantMembers.userId, ctx.userId))
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      gdpr_note: 'This export contains all personal data NuCRM holds about you, per GDPR Article 20.',
      profile,
      organizations: memberships,
      sessions: userSessions.map(s => ({ 
        ...s, 
        ipAddress: s.ipAddress ? s.ipAddress.replace(/\.\d+$/, '.xxx') : null 
      })),
      recent_activities: userActivities,
      notifications: userNotifications,
    };

    const json = JSON.stringify(exportData, null, 2);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nucrm-data-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err: any) {
    console.error('[UserExport] Error:', err);
    return apiError(err);
  }
}
