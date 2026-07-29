/**
 * Worker Health Check Endpoint
 *
 * Reads the BullMQ worker heartbeat from Redis to verify the background
 * worker process is alive and its queues are running.
 *
 * Returns:
 * - status: healthy / degraded / unhealthy
 * - worker info (pid, uptime, queue statuses) when available
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';

interface WorkerHeartbeat {
  pid: number;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  node: string;
  status: string;
  workers: Record<string, boolean>;
  timestamp: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth: require superadmin
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  if (!authResult.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    return NextResponse.json(
      { status: 'unhealthy', error: 'REDIS_URL not configured' },
      { status: 503 }
    );
  }

  try {
    const IORedis = (await import('ioredis')).default;
    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    await redis.connect();

    const raw = await redis.get('worker:heartbeat');
    await redis.quit();

    if (!raw) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          error: 'No worker heartbeat found. Worker process may not be running.',
          lastHeartbeat: null,
        },
        { status: 503 }
      );
    }

    const heartbeat: WorkerHeartbeat = JSON.parse(raw);
    const heartbeatAge = Date.now() - new Date(heartbeat.timestamp).getTime();
    const heartbeatAgeSec = Math.round(heartbeatAge / 1000);

    // If heartbeat is older than 90 seconds (3x the 30s interval), consider degraded
    // If older than 180 seconds, consider unhealthy
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (heartbeatAgeSec > 180) {
      status = 'unhealthy';
    } else if (heartbeatAgeSec > 90) {
      status = 'degraded';
    }

    // Check if any worker queue is not running
    const allRunning = Object.values(heartbeat.workers).every(Boolean);
    if (!allRunning && status === 'healthy') {
      status = 'degraded';
    }

    const response = {
      status,
      pid: heartbeat.pid,
      uptime: heartbeat.uptime,
      uptimeFormatted: formatUptime(heartbeat.uptime),
      node: heartbeat.node,
      memory: {
        rss: formatBytes(heartbeat.memory.rss),
        heapUsed: formatBytes(heartbeat.memory.heapUsed),
        heapTotal: formatBytes(heartbeat.memory.heapTotal),
      },
      queues: heartbeat.workers,
      lastHeartbeat: heartbeat.timestamp,
      heartbeatAgeSec,
    };

    return NextResponse.json(response, { status: status === 'unhealthy' ? 503 : 200 });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: `Failed to connect to Redis: ${(err as Error).message}`,
        lastHeartbeat: null,
      },
      { status: 503 }
    );
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
