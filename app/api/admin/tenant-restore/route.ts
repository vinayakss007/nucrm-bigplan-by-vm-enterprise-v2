import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, tenantBackupRecords, tenantRestoreRecords } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { TenantDataExporter } from '@/lib/tenant-data-export';
import { TenantDataImporter } from '@/lib/tenant-data-import';

const backupSchema = z.object({
  tenantId: z.string().min(1),
  includeTables: z.array(z.string()).optional(),
  backupNote: z.string().optional().nullable(),
});

const restoreSchema = z.object({
  backupId: z.string().optional(),
  tenantId: z.string().optional(),
  confirmRestore: z.boolean(),
  restoreOptions: z.object({ deleteExisting: z.boolean().optional(), skipTables: z.array(z.string()).optional() }).optional(),
});

/**
 * Per-tenant backup/restore API
 * 
 * GET    /api/admin/tenant-restore?tenantId=xxx  → Get backup info for a tenant
 * POST   /api/admin/tenant-restore                → Backup a tenant's data
 * PUT    /api/admin/tenant-restore                → Restore a tenant's data from backup
 * DELETE /api/admin/tenant-restore?backupId=xxx   → Delete a tenant backup
 */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const listBackups = searchParams.get('listBackups');
    const backupId = searchParams.get('backupId');

    // List all tenants with backup status
    if (!tenantId && !listBackups) {
      const results = await db.select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        createdAt: tenants.createdAt,
        ownerId: tenants.ownerId,
        ownerEmail: users.email,
        backupCount: sql<number>`(SELECT COUNT(*) FROM tenant_backup_records WHERE tenant_id = ${tenants.id} AND status = 'completed')`,
        lastBackup: sql<Date>`(SELECT MAX(created_at) FROM tenant_backup_records WHERE tenant_id = ${tenants.id} AND status = 'completed')`
      })
      .from(tenants)
      .leftJoin(users, eq(tenants.ownerId, users.id))
      .orderBy(desc(tenants.createdAt));

      return NextResponse.json({ tenants: results });
    }

    // List backups for a specific tenant
    if (listBackups && tenantId) {
      const results = await db.query.tenantBackupRecords.findMany({
        where: eq(tenantBackupRecords.tenantId, tenantId),
        orderBy: [desc(tenantBackupRecords.createdAt)],
        limit: 50
      });
      return NextResponse.json({ backups: results });
    }

    // Get details of a specific backup
    if (backupId) {
      const result = await db.query.tenantBackupRecords.findFirst({
        where: eq(tenantBackupRecords.id, backupId),
        with: {
          // Assuming relation exists, if not we join manually
        }
      });
      
      if (!result) {
        return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
      }

      // Manual join if needed for tenant info
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, result.tenantId!)
      });

      return NextResponse.json({ 
        backup: { 
          ...result, 
          tenant_name: tenant?.name, 
          tenant_slug: tenant?.slug 
        } 
      });
    }

    return NextResponse.json({ error: 'Missing tenantId or listBackups parameter' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[Tenant Restore GET] Error:', err);
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = validateBody(backupSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { tenantId, includeTables, backupNote } = validated.data;

    // Verify tenant exists
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId)
    });
    
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Create backup record
    const [backupRecord] = await db.insert(tenantBackupRecords)
      .values({
        tenantId,
        status: 'running',
        initiatedBy: ctx.userId,
        backupNote: backupNote || null,
        includeTables: includeTables || null,
      })
      .returning();

    if (!backupRecord) {
      return NextResponse.json({ error: 'Failed to create backup record' }, { status: 500 });
    }

    // Start async backup
    performTenantBackup(backupRecord.id, tenantId, includeTables).catch((err) => {
      console.error(`[Tenant Backup ${backupRecord.id}] Failed:`, err);
    });

    return NextResponse.json({
      message: 'Backup started',
      backupId: backupRecord.id,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    });
  } catch (err: unknown) {
    console.error('[Tenant Restore POST] Error:', err);
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = validateBody(restoreSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { backupId, tenantId, restoreOptions } = validated.data;

    if (!backupId && !tenantId) {
      return NextResponse.json({ error: 'backupId or tenantId is required' }, { status: 400 });
    }

    // If backupId provided, restore from that specific backup
    if (backupId) {
      const backup = await db.query.tenantBackupRecords.findFirst({
        where: and(eq(tenantBackupRecords.id, backupId), eq(tenantBackupRecords.status, 'completed'))
      });

      if (!backup) {
        return NextResponse.json({ error: 'Backup not found or not completed' }, { status: 404 });
      }

      const targetTenantId = backup.tenantId!;

      // Verify tenant still exists
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, targetTenantId)
      });
      
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant no longer exists' }, { status: 404 });
      }

      // Start async restore
      const restoreRecord = await performTenantRestore(
        backupId,
        targetTenantId,
        restoreOptions || {},
        ctx.userId
      );

      return NextResponse.json({
        message: 'Restore started',
        restoreId: restoreRecord.id,
        tenant,
      });
    }

    // If tenantId provided, restore from latest backup
    if (tenantId) {
      const latestBackup = await db.query.tenantBackupRecords.findFirst({
        where: and(eq(tenantBackupRecords.tenantId, tenantId), eq(tenantBackupRecords.status, 'completed')),
        orderBy: [desc(tenantBackupRecords.createdAt)]
      });

      if (!latestBackup) {
        return NextResponse.json({ error: 'No completed backup found for this tenant' }, { status: 404 });
      }

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId)
      });

      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }

      const restoreRecord = await performTenantRestore(
        latestBackup.id,
        tenantId,
        restoreOptions || {},
        ctx.userId
      );

      return NextResponse.json({
        message: 'Restore started from latest backup',
        restoreId: restoreRecord.id,
        tenant,
      });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (err: unknown) {
    console.error('[Tenant Restore PUT] Error:', err);
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const backupId = searchParams.get('backupId');

  if (!backupId) {
    return NextResponse.json({ error: 'backupId is required' }, { status: 400 });
  }

  try {
    const [deleted] = await db.delete(tenantBackupRecords)
      .where(eq(tenantBackupRecords.id, backupId))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Backup deleted', backupId });
  } catch (err: unknown) {
    console.error('[Tenant Restore DELETE] Error:', err);
    return apiError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── Background Backup Function ──────────────────────────────────────────────

async function performTenantBackup(backupId: string, tenantId: string, includeTables?: string[]) {
  const startTime = Date.now();

  try {
    const exporter = new TenantDataExporter(tenantId);
    const result = await exporter.exportAll(includeTables);

    const duration = Date.now() - startTime;

    await db.update(tenantBackupRecords)
      .set({
        status: 'completed',
        dataSize: result.dataSize,
        tableCount: result.tableCount,
        recordCount: result.totalRecords,
        backupData: result.tables,
        durationMs: duration,
        completedAt: new Date(),
      })
      .where(eq(tenantBackupRecords.id, backupId));

    console.log(`[Tenant Backup ${backupId}] Completed: ${result.tableCount} tables, ${result.totalRecords} records, ${result.dataSize} bytes`);
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(tenantBackupRecords)
      .set({
        status: 'failed',
        errorMessage,
        durationMs: duration,
        completedAt: new Date(),
      })
      .where(eq(tenantBackupRecords.id, backupId));
    throw err;
  }
}

// ── Background Restore Function ─────────────────────────────────────────────

async function performTenantRestore(backupId: string, tenantId: string, options: Record<string, unknown> = {}, userId: string) {
  // Create restore record
  const [restoreRecord] = await db.insert(tenantRestoreRecords)
    .values({
      backupId,
      tenantId,
      status: 'running',
      restoreOptions: options,
      initiatedBy: userId,
    })
    .returning();

  if (!restoreRecord) {
    throw new Error('Failed to create restore record');
  }

  // Run restore in background
  runTenantRestore(restoreRecord.id, backupId, tenantId, options).catch((err) => {
    console.error(`[Tenant Restore ${restoreRecord.id}] Failed:`, err);
  });

  return restoreRecord;
}

async function runTenantRestore(restoreId: string, backupId: string, tenantId: string, options: { deleteExisting?: boolean; skipTables?: string[] } = {}) {
  const startTime = Date.now();
  const { deleteExisting = false, skipTables = [] } = options;

  try {
    // Get backup data
    const backup = await db.query.tenantBackupRecords.findFirst({
      where: and(eq(tenantBackupRecords.id, backupId), eq(tenantBackupRecords.status, 'completed'))
    });

    if (!backup || !backup.backupData) {
      throw new Error('Backup not found or not completed');
    }

    const tables = backup.backupData as Record<string, unknown>;

    const importer = new TenantDataImporter(tenantId);

    if (deleteExisting) {
      await importer.deleteExistingData(skipTables);
    }

    const result = await importer.importAll(tables);

    const duration = Date.now() - startTime;

    await db.update(tenantRestoreRecords)
      .set({
        status: 'completed',
        tablesRestored: result.tablesRestored,
        recordsRestored: result.recordsRestored,
        durationMs: duration,
        completedAt: new Date(),
      })
      .where(eq(tenantRestoreRecords.id, restoreId));

    console.log(`[Tenant Restore ${restoreId}] Completed: ${result.tablesRestored} tables, ${result.recordsRestored} records restored`);
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(tenantRestoreRecords)
      .set({
        status: 'failed',
        errorMessage,
        durationMs: duration,
        completedAt: new Date(),
      })
      .where(eq(tenantRestoreRecords.id, restoreId));
    throw err;
  }
}
