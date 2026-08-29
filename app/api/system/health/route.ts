/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Deep Health Check Endpoint (Admin-only)
 *
 * Returns structured health information:
 * - Database connectivity + pool stats
 * - Redis connectivity
 * - Disk space for backup storage
 * - Last successful backup time + age
 * - Migration version
 * - Overall status: healthy / degraded / unhealthy
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { checkDatabaseHealth } from '@/lib/db/safe-connection';
import { cache } from '@/lib/cache';
import type { DatabaseHealthResult } from '@/lib/db/safe-connection';
import { withApiRoute } from '@/lib/api/with-api-route';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface RedisHealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
}

interface DiskHealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  freeBytes?: number;
  totalBytes?: number;
  usagePercent?: number;
  error?: string;
}

interface BackupHealthResult {
  lastBackupTime: string | null;
  ageMinutes: number | null;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

interface MigrationHealthResult {
  currentVersion: string | null;
  status: 'healthy' | 'unknown';
}

interface SystemHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  database: DatabaseHealthResult;
  redis: RedisHealthResult;
  disk: DiskHealthResult;
  backup: BackupHealthResult;
  migration: MigrationHealthResult;
}

// -------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------

export const GET = withApiRoute(async (request: NextRequest) => {
  // Auth: require superadmin
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  if (!authResult.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const health: SystemHealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      healthy: false,
      reachable: false,
      latencyMs: 0,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    },
    redis: { status: 'unhealthy' },
    disk: { status: 'unknown' as 'healthy' | 'degraded' | 'unhealthy' },
    backup: { lastBackupTime: null, ageMinutes: null, status: 'unhealthy' },
    migration: { currentVersion: null, status: 'unknown' },
  };

  // 1. Database health
  try {
    health.database = await checkDatabaseHealth();
  } catch {
    health.database = {
      healthy: false,
      reachable: false,
      latencyMs: 0,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
      error: 'Failed to check database health',
    };
  }

  // 2. Redis health
  try {
    const redisHealth = await cache.health();
    if (redisHealth.status === 'healthy' || redisHealth.status === 'slow') {
      health.redis = {
        status: redisHealth.status === 'healthy' ? 'healthy' : 'degraded',
        latencyMs: redisHealth.latency,
      };
    } else {
      health.redis = { status: 'unhealthy', latencyMs: redisHealth.latency };
    }
  } catch {
    health.redis = { status: 'unhealthy' };
  }

  // 3. Disk space (backup directory)
  try {
    const { execFileSync } = await import('child_process');
    const backupDir = process.env['BACKUP_DIR'] || '/tmp/backups';
    // Validate directory path to prevent command injection
    if (!/^[a-zA-Z0-9_\-/.~]+$/.test(backupDir)) {
      health.disk = { status: 'degraded', error: 'Invalid BACKUP_DIR path' };
    } else {
      let dfOutput: string;
      try {
        dfOutput = execFileSync('df', ['-B1', backupDir], { encoding: 'utf-8' });
      } catch {
        // Fallback to root filesystem
        dfOutput = execFileSync('df', ['-B1', '/'], { encoding: 'utf-8' });
      }
      const lines = dfOutput.trim().split('\n');
      const parts = lines[1]?.split(/\s+/);
      if (parts && parts.length >= 4) {
        const total = parseInt(parts[1] || '0', 10);
        const available = parseInt(parts[3] || '0', 10);
        const usagePercent = total > 0 ? Math.round(((total - available) / total) * 100) : 0;
        health.disk = {
          status: usagePercent > 90 ? 'unhealthy' : usagePercent > 75 ? 'degraded' : 'healthy',
          freeBytes: available,
          totalBytes: total,
          usagePercent,
        };
      } else {
        health.disk = { status: 'healthy' };
      }
    }
  } catch {
    health.disk = { status: 'degraded', error: 'Unable to check disk space' };
  }

  // 4. Last backup time
  try {
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    const backupResult = await pool.query(
      `SELECT MAX(created_at) AS last_backup FROM backups WHERE status = 'completed'`
    );
    const lastBackup = backupResult.rows[0]?.last_backup;
    if (lastBackup) {
      const ageMs = Date.now() - new Date(lastBackup).getTime();
      const ageMinutes = Math.round(ageMs / 60_000);
      health.backup = {
        lastBackupTime: new Date(lastBackup).toISOString(),
        ageMinutes,
        // Alert if backup is older than 24 hours
        status: ageMinutes > 1440 ? 'degraded' : 'healthy',
      };
    } else {
      health.backup = { lastBackupTime: null, ageMinutes: null, status: 'degraded' };
    }
  } catch {
    health.backup = { lastBackupTime: null, ageMinutes: null, status: 'unhealthy' };
  }

  // 5. Migration version
  try {
    const { getPool } = await import('@/lib/db/pool');
    const pool = getPool();
    const vResult = await pool.query(
      `SELECT MAX(id)::text AS version FROM "__drizzle_migrations"`
    );
    health.migration = {
      currentVersion: vResult.rows[0]?.version || null,
      status: 'healthy',
    };
  } catch {
    health.migration = { currentVersion: null, status: 'unknown' };
  }

  // Compute overall status
  const statuses = [
    health.database.healthy ? 'healthy' : 'unhealthy',
    health.redis.status,
    health.disk.status,
    health.backup.status,
  ];

  if (statuses.includes('unhealthy')) {
    health.status = health.database.healthy ? 'degraded' : 'unhealthy';
  } else if (statuses.includes('degraded')) {
    health.status = 'degraded';
  } else {
    health.status = 'healthy';
  }

  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  return NextResponse.json(health, { status: statusCode });
});
