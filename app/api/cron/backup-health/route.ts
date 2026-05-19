import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { alertSuperAdmin } from '@/lib/email/service';
import { db } from '@/drizzle/db';
import { backupRecords, backupAlerts } from '@/drizzle/schema';
import { eq, and, desc, gt } from 'drizzle-orm';

// Runs every 6 hours — checks backup health and alerts if backup is overdue
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const lastBackup = await db.query.backupRecords.findFirst({
      where: eq(backupRecords.status, 'completed'),
      orderBy: [desc(backupRecords.completedAt)],
    });

    const now = Date.now();
    const alertThresholdHours = 25; // Alert if no backup in 25 hours

    if (!lastBackup || !lastBackup.completedAt) {
      // No backup ever — critical
      const alreadyAlerted = await db.query.backupAlerts.findFirst({
        where: and(
          eq(backupAlerts.alertType, 'no_backup'),
          eq(backupAlerts.resolved, false),
          gt(backupAlerts.createdAt, new Date(Date.now() - 6 * 3600000))
        )
      });
      if (!alreadyAlerted) {
        await db.insert(backupAlerts).values({
          alertType: 'no_backup',
          message: 'No backup has ever been completed',
        });
        await alertSuperAdmin(
          'WARNING: No database backup has ever been run',
          'Please configure automated backups immediately.\n\nVisit: /superadmin/backups'
        );
      }
      return NextResponse.json({ ok: false, alert: 'no_backup_ever' });
    }

    const hoursSinceBackup = (now - lastBackup.completedAt.getTime()) / 3600000;

    if (hoursSinceBackup > alertThresholdHours) {
      const alreadyAlerted = await db.query.backupAlerts.findFirst({
        where: and(
          eq(backupAlerts.alertType, 'no_backup'),
          eq(backupAlerts.resolved, false),
          gt(backupAlerts.createdAt, new Date(Date.now() - 6 * 3600000))
        )
      });
      if (!alreadyAlerted) {
        await db.insert(backupAlerts).values({
          alertType: 'no_backup',
          message: `No backup in ${Math.floor(hoursSinceBackup)} hours. Last backup: ${lastBackup.completedAt.toISOString()}`,
        });
        await alertSuperAdmin(
          `WARNING: No backup in ${Math.floor(hoursSinceBackup)} hours`,
          `Last successful backup: ${lastBackup.completedAt.toISOString()}\nStorage: ${lastBackup.storagePath}\nSize: ${lastBackup.sizeBytes ? (lastBackup.sizeBytes/1024/1024).toFixed(1)+'MB' : 'unknown'}\n\nPlease check the backup cron job.`
        );
      }
      return NextResponse.json({ ok: false, hours_since_backup: hoursSinceBackup });
    }

    return NextResponse.json({
      ok: true,
      last_backup: lastBackup.completedAt,
      hours_since: Math.round(hoursSinceBackup * 10) / 10,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
