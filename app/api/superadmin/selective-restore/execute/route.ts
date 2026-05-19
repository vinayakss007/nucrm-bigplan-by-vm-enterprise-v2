import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { selectiveRestoreLogs, selectiveRestoreAuditLog, superAdminBackups } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { executeSelectiveRestore, validateTenant, createPreRestoreSnapshot } from '@/lib/restore/restore-executor';

/**
 * POST: Execute selective restore with SSE streaming
 * Streams progress updates to the client
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { backup_id, tenant_id, tables, restore_mode, confirm_restore, user_id, contact_id } = body;

    // Validate inputs
    if (!backup_id || !tenant_id || !tables || !restore_mode) {
      return NextResponse.json({
        error: 'backup_id, tenant_id, tables, and restore_mode are required',
      }, { status: 400 });
    }

    if (!['insert_only', 'upsert', 'replace'].includes(restore_mode)) {
      return NextResponse.json({
        error: 'restore_mode must be one of: insert_only, upsert, replace',
      }, { status: 400 });
    }

    if (restore_mode === 'replace' && !confirm_restore) {
      return NextResponse.json({
        error: 'Set confirm_restore: true for REPLACE mode. This will delete existing data.',
        warning: true,
      }, { status: 400 });
    }

    // Validate tenant
    const tenantValidation = await validateTenant(tenant_id);
    if (!tenantValidation.valid) {
      return NextResponse.json({
        error: `Invalid tenant: ${tenantValidation.error}`,
      }, { status: 400 });
    }

    // Log restore filter if user-specific
    if (user_id || contact_id) {
      console.log(`[Selective Restore] User-specific restore: user_id=${user_id}, contact_id=${contact_id}`);
    }

    // Get backup file
    const [backup] = await db
      .select({ storagePath: superAdminBackups.storagePath, backupName: superAdminBackups.backupName })
      .from(superAdminBackups)
      .where(eq(superAdminBackups.id, backup_id))
      .limit(1);

    if (!backup || !backup.storagePath || !existsSync(backup.storagePath)) {
      return NextResponse.json({ error: 'Backup file not found' }, { status: 404 });
    }

    // Create restore log entry
    const [restoreLog] = await db
      .insert(selectiveRestoreLogs)
      .values({
        backupId: backup_id,
        tenantId: tenant_id,
        action: 'execute',
        status: 'pending',
      })
      .returning({ id: selectiveRestoreLogs.id });

    if (!restoreLog) {
      return NextResponse.json({ error: 'Failed to create restore log' }, { status: 500 });
    }

    // Create audit log entry
    await createAuditLog({
      restore_log_id: restoreLog.id,
      tenant_id,
      action: 'execute',
      performed_by: ctx.userId,
      performed_by_email: (ctx as any).user?.email,
      details: { backup_id, tables, restore_mode },
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      user_agent: request.headers.get('user-agent'),
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          sendEvent('progress', {
            step: 'snapshot',
            status: 'running',
            message: 'Creating pre-restore snapshot...',
          });

          const snapshotId = await createPreRestoreSnapshot(tenant_id, tables);

          // Update restore log
          await db
            .update(selectiveRestoreLogs)
            .set({ 
              status: 'running', 
              startedAt: new Date() 
            })
            .where(eq(selectiveRestoreLogs.id, restoreLog.id));

          sendEvent('progress', {
            step: 'snapshot',
            status: 'completed',
            message: 'Snapshot created successfully',
            snapshot_id: snapshotId,
          });

          sendEvent('progress', {
            step: 'restoring',
            status: 'running',
            message: 'Starting selective restore...',
          });

          const result = await executeSelectiveRestore(
            {
              backupFilePath: backup.storagePath!,
              tenantId: tenant_id,
              tables,
              restoreMode: restore_mode as any,
              performedBy: ctx.userId,
            },
            (progress) => {
              sendEvent('progress', progress);
            }
          );

          await db
            .update(selectiveRestoreLogs)
            .set({ 
              status: result.success ? 'completed' : 'failed',
              completedAt: new Date(),
              errorMessage: result.error || null,
            })
            .where(eq(selectiveRestoreLogs.id, restoreLog.id));

          if (result.success) {
            sendEvent('complete', {
              success: true,
              records_affected: result.recordsAffected,
              records_per_table: result.recordsPerTable,
              duration_ms: result.durationMs,
            });
          } else {
            sendEvent('error', {
              success: false,
              error: result.error,
              message: 'Restore failed. Data has been rolled back to pre-restore state.',
            });
          }

        } catch (err: any) {
          console.error('[selective-restore/execute]', err);

          await db
            .update(selectiveRestoreLogs)
            .set({ 
              status: 'failed', 
              errorMessage: err.message, 
              completedAt: new Date() 
            })
            .where(eq(selectiveRestoreLogs.id, restoreLog.id));

          sendEvent('error', {
            success: false,
            error: err.message,
          });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err: any) {
    console.error('[selective-restore/execute POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

interface AuditLogParams {
  restore_log_id: string;
  tenant_id: string;
  action: string;
  performed_by: string;
  performed_by_email?: string;
  details?: any;
  ip_address?: string | null;
  user_agent?: string | null;
}

async function createAuditLog(params: AuditLogParams) {
  try {
    await db.insert(selectiveRestoreAuditLog).values({
      tenantId: params.tenant_id,
      action: params.action,
      oldData: params.details, // Using oldData for details in this context
      performedBy: params.performed_by,
      performedAt: new Date(),
      // In schema, selectiveRestoreAuditLog has: tenantId, action, tableName, recordId, oldData, newData, performedBy, performedAt.
    });
  } catch (err) {
    console.error('[audit-log]', err);
  }
}
