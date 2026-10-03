/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { setSuperAdminContext } from '@/lib/db/rls';

/**
 * GET /api/superadmin/backups/[id]
 * DELETE /api/superadmin/backups/[id]
 *
 * Both existed only as buttons: components/superadmin/backups-data-table.tsx
 * fetches these two paths from the live backups page, and neither route was
 * ever written, so "View" and "Delete" both 404'd.
 *
 * DELETE is a SOFT delete: it stamps deleted_at/deleted_by and leaves the
 * archive object in place. Hard-deleting an S3 object from a table row button
 * is not reversible, and retention is already handled by deleteOldBackups(),
 * which is what actually reclaims space.
 */
export const GET = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    // PP-031: tenant_backup_records is deny-by-default RLS and its policy only
    // admits a platform read through app.is_super_admin, which the plain `db`
    // handle never sets. Without this the query returns zero rows and every
    // "View" click 404s on a backup that exists. Safe on this connection:
    // withApiRoute pins it and the release reset clears the GUC.
    await setSuperAdminContext();

    const [backup] = await db
      .select()
      .from(backupRecords)
      .where(and(eq(backupRecords.id, id), isNull(backupRecords.deletedAt)))
      .limit(1);

    if (!backup) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });

    return NextResponse.json({ data: backup });
  } catch (err: unknown) {
    await logError({ error: err, context: 'superadmin/backups/[id] GET', requestMethod: 'GET' });
    return apiError(err);
  }
});

export const DELETE = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    // PP-031: without the platform context the UPDATE matches zero rows, so a
    // soft delete would answer 404 for a row that exists (see GET above).
    await setSuperAdminContext();

    // The deleted_at predicate makes a second click a 404 rather than a no-op
    // that reports success, so the console cannot show "Backup deleted" twice
    // for one row.
    const [removed] = await db
      .update(backupRecords)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(backupRecords.id, id), sql`${backupRecords.deletedAt} IS NULL`))
      .returning({ id: backupRecords.id, storageType: backupRecords.storageType });

    if (!removed) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'backup.deleted',
      metadata: { backupId: removed.id, storageType: removed.storageType },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    await logError({ error: err, context: 'superadmin/backups/[id] DELETE', requestMethod: 'DELETE' });
    return apiError(err);
  }
});
