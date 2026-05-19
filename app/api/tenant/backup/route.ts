import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords, platformSettings } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/tenant/backup
 * List backup history for the current tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const backups = await db.query.backupRecords.findMany({
      orderBy: [desc(backupRecords.createdAt)],
      limit: 50,
    });

    return NextResponse.json({ backups });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/backup
 * Trigger a manual backup for the current tenant.
 * 
 * SECURITY FIX: Only super-admins can trigger backups because pg_dump
 * operates on the full database. Regular tenant admins should use the
 * selective restore export instead (export/route.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Only super-admins can trigger pg_dump (it operates on full DB)
    if (!ctx.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super-admins can trigger database backups. Tenant admins should use the export feature.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const backupType = body.backup_type === 'schema' ? 'schema' : 'full';

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    const cronRes = await fetch(`${baseUrl}/api/cron/backup?type=${backupType}`, {
      method: 'POST',
      headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (cronRes.ok) {
      const cronData = await cronRes.json();
      return NextResponse.json({
        ok: true,
        ...cronData,
        message: 'Backup completed successfully',
      });
    } else {
      const cronError = await cronRes.json().catch(() => ({}));
      return NextResponse.json({ error: cronError.error || 'Backup failed' }, { status: 500 });
    }
  } catch (err: any) {
    const errorMsg = err.name === 'AbortError' 
      ? 'Backup timed out after 5 minutes' 
      : err.message.slice(0, 500);
    return NextResponse.json({ error: 'Failed to run backup: ' + errorMsg }, { status: 500 });
  }
}
