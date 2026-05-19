import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { superAdminBackups } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { parseBackupFile } from '@/lib/restore/backup-parser';
import { existsSync } from 'fs';

/**
 * POST: Parse and preview backup file contents
 * Shows tenants, tables, and record counts without restoring anything
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { backup_id } = body;

    if (!backup_id) {
      return NextResponse.json({ error: 'backup_id required' }, { status: 400 });
    }

    const [existingBackup] = await db
      .select()
      .from(superAdminBackups)
      .where(eq(superAdminBackups.id, backup_id))
      .limit(1);

    if (!existingBackup) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    }

    if (existingBackup.status === 'completed') {
      return NextResponse.json({
        backup_id,
        file_name: existingBackup.backupName,
        file_size: existingBackup.backupSize,
        backup_type: existingBackup.backupType,
        completed_at: existingBackup.completedAt,
        // The original had tenants_included, total_record_count, tables_available in the DB.
        // If these are not in the schema, we might need to re-parse or use execute.
      });
    }

    if (existingBackup.status === 'failed') {
      return NextResponse.json({
        error: 'Backup parsing failed',
      }, { status: 400 });
    }

    if (!existingBackup.storagePath || !existsSync(existingBackup.storagePath)) {
      return NextResponse.json({
        error: 'Backup file not found on server',
        path: existingBackup.storagePath,
      }, { status: 404 });
    }

    const metadata = await parseBackupFile(existingBackup.storagePath);

    return NextResponse.json({
      backup_id,
      file_name: existingBackup.backupName,
      file_size: metadata.file_size,
      statement_count: metadata.statement_count,
      tables_found: metadata.tables_found,
      tenants: metadata.tenants_found,
      total_records: metadata.tenants_found.reduce((sum, t) => sum + t.total_records, 0),
      date_range: metadata.date_range,
      parse_duration_ms: metadata.parse_duration_ms,
    });

  } catch (err: any) {
    console.error('[selective-restore/preview POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
