/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { createBackupSchema } from '@/lib/api/schemas';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/backup
 * List full-database backup history.
 *
 * SECURITY: backup_records are whole-database pg_dump backups (no tenantId
 * column), so this exposes infrastructure metadata (storage paths, sizes,
 * checksums, error messages). Only super-admins may read it, mirroring the
 * POST handler's gate.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Only super-admins can view full-DB backup history (no tenantId column — these are pg_dump records)
    if (!ctx.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super-admins can view database backup history.' },
        { status: 403 }
      );
    }

    const backups = await db.query.backupRecords.findMany({
      orderBy: [desc(backupRecords.createdAt)],
      limit: 50,
    });

    // #1300: standardize list responses on { data }; keep `backups` for
    // backward compatibility with existing consumers.
    return NextResponse.json({ data: backups, backups });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

/**
 * POST /api/tenant/backup
 * Trigger a manual backup for the current tenant.
 * 
 * SECURITY FIX: Only super-admins can trigger backups because pg_dump
 * operates on the full database. Regular tenant admins should use the
 * selective restore export instead (export/route.ts).
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'backup', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Only super-admins can trigger pg_dump (it operates on full DB)
    if (!ctx.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super-admins can trigger database backups. Tenant admins should use the export feature.' },
        { status: 403 }
      );
    }

    let body;
    try { body = await readJsonBody(request); } catch (err) { void logError({ error: err, context: 'tenant/backup JSON parse', level: 'warning' }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    // Validate the request body (#1072) — bounds backup_type to the allowed
    // enum and rejects unexpected shapes with a 400 before triggering pg_dump.
    const validated = validateBody(createBackupSchema, body);
    if (validated instanceof NextResponse) return validated;
    const backupType = validated.data.backup_type === 'schema' ? 'schema' : 'full';

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
      const cronError = await cronRes.json().catch((err) => { void logError({ error: err, context: 'tenant/backup cron response parse', level: 'warning' }); return { error: `HTTP ${cronRes.status}` }; });
      return NextResponse.json({ error: cronError.error || 'Backup failed' }, { status: 500 });
    }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const errorMsg = err.name === 'AbortError' 
      ? 'Backup timed out after 5 minutes' 
      : err.message.slice(0, 500);
    return NextResponse.json({ error: 'Failed to run backup: ' + errorMsg }, { status: 500 });
  }
});
