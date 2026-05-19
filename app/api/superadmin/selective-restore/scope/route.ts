import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { superAdminBackups, tenants } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { extractTenantSQL } from '@/lib/restore/backup-parser';
import { countExistingRecords, validateTenant } from '@/lib/restore/restore-executor';
import { existsSync } from 'fs';

/**
 * POST: Get restore scope preview
 * Shows exactly what will be restored and what already exists
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { backup_id, tenant_id, tables, restore_mode = 'insert_only', user_id, contact_id } = body;

    if (!backup_id || !tenant_id || !tables || !Array.isArray(tables) || tables.length === 0) {
      return NextResponse.json({ error: 'backup_id, tenant_id, and tables array are required' }, { status: 400 });
    }

    const tenantValidation = await validateTenant(tenant_id);
    if (!tenantValidation.valid) {
      return NextResponse.json({ error: `Invalid tenant: ${tenantValidation.error}` }, { status: 400 });
    }

    // If user_id or contact_id provided, verify they exist in tenant
    if (user_id) {
      const { users, tenantMembers } = await import('@/drizzle/schema');
      const [userExists] = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(and(eq(users.id, user_id), eq(tenantMembers.tenantId, tenant_id)))
        .limit(1);
      if (!userExists) {
        return NextResponse.json({ error: 'User not found in this tenant' }, { status: 400 });
      }
    }

    if (contact_id) {
      const { contacts } = await import('@/drizzle/schema');
      const [contactExists] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, contact_id), eq(contacts.tenantId, tenant_id)))
        .limit(1);
      if (!contactExists) {
        return NextResponse.json({ error: 'Contact not found in this tenant' }, { status: 400 });
      }
    }

    const [backup] = await db
      .select({ storagePath: superAdminBackups.storagePath, backupName: superAdminBackups.backupName })
      .from(superAdminBackups)
      .where(eq(superAdminBackups.id, backup_id))
      .limit(1);

    if (!backup || !backup.storagePath || !existsSync(backup.storagePath)) {
      return NextResponse.json({ error: 'Backup file not found' }, { status: 404 });
    }

    const tenantSQL = await extractTenantSQL(backup.storagePath, tenant_id, tables);
    
    const backupCounts: Record<string, number> = {};
    let totalFromBackup = 0;
    for (const table of tables) {
      backupCounts[table] = tenantSQL[table]?.length || 0;
      totalFromBackup += backupCounts[table];
    }

    const existingCounts = await countExistingRecords(tenant_id, tables);
    let totalExisting = 0;
    for (const count of Object.values(existingCounts)) {
      totalExisting += count;
    }

    const preview: Record<string, { from_backup: number; existing: number; new: number; updated: number; skipped: number }> = {};
    let totalNew = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const table of tables) {
      const fromBackup = backupCounts[table] || 0;
      const existing = existingCounts[table] || 0;

      let newCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      if (restore_mode === 'insert_only') {
        newCount = fromBackup;
        skippedCount = 0;
      } else if (restore_mode === 'upsert') {
        newCount = fromBackup;
      } else if (restore_mode === 'replace') {
        newCount = fromBackup;
      }

      preview[table] = {
        from_backup: fromBackup,
        existing: existing,
        new: newCount,
        updated: updatedCount,
        skipped: skippedCount,
      };

      totalNew += newCount;
      totalUpdated += updatedCount;
      totalSkipped += skippedCount;
    }

    return NextResponse.json({
      tenant: tenantValidation.tenant,
      backup_file: backup.backupName,
      restore_mode,
      tables_selected: tables,
      filters: {
        user_id: user_id || null,
        contact_id: contact_id || null,
      },
      summary: {
        total_records_in_backup: totalFromBackup,
        total_existing_records: totalExisting,
        estimated_new_records: totalNew,
        estimated_updated_records: totalUpdated,
        estimated_skipped_records: totalSkipped,
      },
      per_table: preview,
      warnings: generateWarnings(tables, existingCounts, restore_mode),
    });

  } catch (err: any) {
    console.error('[selective-restore/scope POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function generateWarnings(tables: string[], existingCounts: Record<string, number>, restoreMode: string): string[] {
  const warnings: string[] = [];
  if (restoreMode === 'replace') {
    const totalExisting = Object.values(existingCounts).reduce((sum, c) => sum + c, 0);
    if (totalExisting > 0) {
      warnings.push(`⚠️ REPLACE mode will DELETE ${totalExisting} existing records before restoring`);
    }
  }
  for (const table of tables) {
    const existing = existingCounts[table] || 0;
    if (existing > 1000) {
      warnings.push(`Table "${table}" has ${existing.toLocaleString()} existing records - restore may take time`);
    }
  }
  if (tables.includes('contacts') && !tables.includes('companies')) {
    warnings.push('Contacts may reference companies that are not being restored');
  }
  if (tables.includes('deals') && !tables.includes('pipelines')) {
    warnings.push('Deals may reference pipelines that are not being restored');
  }
  return warnings;
}
