/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';
import { setSuperAdminContext } from '@/lib/db/rls';

// Object storage hands out a URL the browser fetches directly; a 5-minute
// lifetime is enough to start one download and short enough that a leaked link
// from a console tab stops being useful immediately.
const SIGN_TTL_SECONDS = 300;

/**
 * GET /api/superadmin/backups/[id]/download
 *
 * The backups table's Download button has always opened this URL
 * (components/superadmin/backups-data-table.tsx), and there was never a route
 * behind it, so the click produced a 404 page in a new tab — after a
 * "Download started" toast that had already claimed success.
 *
 * Only archives actually written to object storage can be served this way.
 * backup-service records storage_type 'local' for dumps left on the app
 * volume, and those have no URL to sign, so they get an explicit refusal
 * instead of a redirect to a key that would 404 at the storage layer.
 */
export const GET = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id } = await params;

    // PP-031: this read is deny-by-default RLS with no super-admin GUC, so it
    // found nothing and the Download button 404'd on archives that exist.
    await setSuperAdminContext();

    const [backup] = await db
      .select({
        storagePath: backupRecords.storagePath,
        storageType: backupRecords.storageType,
        status: backupRecords.status,
      })
      .from(backupRecords)
      .where(and(eq(backupRecords.id, id), isNull(backupRecords.deletedAt)))
      .limit(1);

    if (!backup) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });

    if (backup.status !== 'completed' || !backup.storagePath) {
      return NextResponse.json(
        { error: `This backup has no archive to download (status: ${backup.status}).` },
        { status: 409 },
      );
    }

    if (!/^s3/.test(backup.storageType ?? '')) {
      return NextResponse.json(
        {
          error: 'This backup was written to the app volume, not object storage, so it cannot be downloaded from the browser.',
          storageType: backup.storageType,
        },
        { status: 409 },
      );
    }

    const { getSignedUrl } = await import('@/lib/storage/s3');
    const url = await getSignedUrl(backup.storagePath, SIGN_TTL_SECONDS);

    return NextResponse.redirect(url, 302);
  } catch (err: unknown) {
    await logError({ error: err, context: 'superadmin/backups/[id]/download GET', requestMethod: 'GET' });
    return apiError(err);
  }
});
