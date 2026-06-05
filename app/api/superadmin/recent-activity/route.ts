/**
 * Super-Admin: Recent platform activity (cross-tenant)
 *   GET /api/superadmin/recent-activity?limit=...
 *
 * Returns:
 *   - bulk_ops: latest bulk_* audit entries across every tenant
 *   - settings_changes: latest update_* / reset_* settings actions
 *   - critical: security-relevant events (login_policy changes, tenant_restore)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 25, 1), 100);

    // Single round-trip per category — cross-tenant joins for tenant + user names
    const bulkOps = await db.execute(sql`
      SELECT a.id, a.action, a.entity_type, a.created_at, a.new_data,
             a.tenant_id, t.name AS tenant_name,
             a.user_id, u.full_name AS user_name, u.email AS user_email
      FROM audit_logs a
      LEFT JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN users   u ON u.id = a.user_id
      WHERE a.action LIKE 'bulk_%'
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `);

    const settingsChanges = await db.execute(sql`
      SELECT a.id, a.action, a.entity_type, a.created_at, a.new_data,
             a.tenant_id, t.name AS tenant_name,
             a.user_id, u.full_name AS user_name, u.email AS user_email
      FROM audit_logs a
      LEFT JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN users   u ON u.id = a.user_id
      WHERE a.action IN (
        'update_localization', 'update_login_policy', 'update_picklists',
        'update_user_defaults', 'reset_user_defaults',
        'tag_rename', 'tag_merge', 'tag_delete'
      )
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `);

    const critical = await db.execute(sql`
      SELECT a.id, a.action, a.entity_type, a.created_at, a.new_data,
             a.tenant_id, t.name AS tenant_name,
             a.user_id, u.full_name AS user_name, u.email AS user_email
      FROM audit_logs a
      LEFT JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN users   u ON u.id = a.user_id
      WHERE a.action IN (
        'update_login_policy', 'tenant_restore', 'tenant_suspend',
        'role_change', 'remove_member', 'ooo_auto_reassign', 'bulk_transfer'
      )
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `);

    return NextResponse.json({
      bulk_ops:          (bulkOps as any).rows         ?? [],
      settings_changes:  (settingsChanges as any).rows ?? [],
      critical:          (critical as any).rows        ?? [],
    });
  } catch (err: any) {
    console.error('[superadmin recent-activity]', err);
    return apiError(err);
  }
}
