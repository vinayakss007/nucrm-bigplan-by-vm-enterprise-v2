/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/system/worker-health
 * Checks background worker/queue connectivity.
 * Protected: superadmin only.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check Redis connectivity (BullMQ uses Redis) — and read the heartbeat the
    // worker writes on its own connection (`worker:heartbeat`, worker.ts:690).
    // #3411: Redis answering only proves the queue is *reachable*. The jobs this
    // page is supposed to be about are delivered by the worker process, and a
    // worker that has died, failed to start, or been left stale by a deploy
    // leaves the key absent while Redis stays perfectly healthy. Reporting
    // `healthy: true` there is the same lie as accepting a job nobody drains.
    let redisHealthy = false;
    let redisError: string | null = null;
    let heartbeat: { workers?: Record<string, boolean>; uptime?: number } | null = null;
    let heartbeatError: string | null = null;

    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: true,
      });
      await redis.connect();
      const pong = await redis.ping();
      redisHealthy = pong === 'PONG';

      if (redisHealthy) {
        const raw = await redis.get('worker:heartbeat');
        if (raw) {
          try {
            heartbeat = JSON.parse(raw) as { workers?: Record<string, boolean>; uptime?: number };
          } catch {
            heartbeatError = 'heartbeat payload is not valid JSON';
          }
        } else {
          heartbeatError = 'no heartbeat — the worker is not checking in';
        }
      }

      await redis.quit();
    } catch (e) {
      redisError = e instanceof Error ? e.message : 'Redis connection failed';
    }

    // Check if BullMQ queues are accessible
    let queuesHealthy = false;
    let queueCount = 0;

    try {
      const { Queue } = await import('bullmq');
      const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) };
      const testQueue = new Queue('health-check', { connection });
      await testQueue.getJobCounts();
      queueCount = 1; // If we got here, at least one queue is accessible
      queuesHealthy = true;
      await testQueue.close();
    } catch {
      // BullMQ may not be configured in all environments
      queuesHealthy = false;
    }

    const heartbeatPresent = heartbeat !== null;
    const workersRunning = heartbeat?.workers
      ? Object.values(heartbeat.workers).every(Boolean)
      : false;

    const healthy = redisHealthy && heartbeatPresent && workersRunning;

    const payload = {
      data: {
        healthy,
        redis: { connected: redisHealthy, error: redisError },
        worker: {
          present: heartbeatPresent,
          running: workersRunning,
          error: heartbeatPresent ? null : heartbeatError,
          uptime: heartbeat?.uptime ?? null,
        },
        queues: { accessible: queuesHealthy, count: queueCount },
        timestamp: new Date().toISOString(),
      },
    };

    // A worker that is not checking in, or is reporting a stopped consumer, is an
    // outage for whatever is queued — 503, so monitoring reacts (#3411).
    return NextResponse.json(payload, { status: healthy ? 200 : 503 });
  } catch (err) {
    return apiError(err);
  }
});
