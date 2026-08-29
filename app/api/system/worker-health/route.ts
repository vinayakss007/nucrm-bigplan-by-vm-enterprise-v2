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

    // Check Redis connectivity (BullMQ uses Redis)
    let redisHealthy = false;
    let redisError: string | null = null;

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

    const healthy = redisHealthy;

    const payload = {
      data: {
        healthy,
        redis: { connected: redisHealthy, error: redisError },
        queues: { accessible: queuesHealthy, count: queueCount },
        timestamp: new Date().toISOString(),
      },
    };

    // Workers down (Redis unreachable) → 503 so monitoring/alerting can react;
    // a 200 would mask outages for anything polling this endpoint.
    return NextResponse.json(payload, { status: healthy ? 200 : 503 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
