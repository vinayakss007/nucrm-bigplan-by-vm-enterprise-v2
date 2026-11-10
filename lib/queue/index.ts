/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Queue — one backend: Redis (BullMQ).
 *
 * #3411. This module used to negotiate Redis → pg-boss → in-memory and cache
 * whichever it landed on for the lifetime of the process. That was three ways to
 * lose a job quietly:
 *
 *  - **pg-boss had no consumer.** Nothing in this repo calls `boss.work()`, so any
 *    job that fell through to it was written to a Postgres table and read by
 *    nobody, while the route that enqueued it returned success.
 *  - **The memory adapter discards what it buffers** (it warns and drops on the
 *    5s tick — there is nothing to register a handler with).
 *  - **The choice was cached**, so one transient Redis blip during the first
 *    enqueue re-routed that process's jobs forever, not just for the outage.
 *
 * Enqueuing is not delivering. If Redis cannot be reached, `addJob` now rejects
 * and the caller says so; nothing is accepted into a queue nobody drains. The
 * adapter is cached only once it has actually connected, so a failed negotiation
 * is retried by the next request.
 */

import type { Queue as QueueType } from 'bullmq';

/**
 * The single job registry (#3411). One list, read by the producer side here, by
 * the worker's dead-letter listeners, and by the screen that insists every type
 * has BOTH halves: `lib/queue` will not accept a type that is not in it, and
 * `worker.ts` must consume every type that is. Three hand-maintained copies used
 * to let a type exist on one side only.
 */
export const JOB_TYPES = [
  'send-email',
  'send-notification',
  'send-bulk-emails',
  'export-csv',
  'contact-import',
  'run-automation',
  'send-lead-warming',
  'whatsapp-webhook',
  'webhooks',
  'tenant-cleanup',
] as const;

export type JobType = typeof JOB_TYPES[number];
export type QueueProvider = 'redis';

/**
 * Job payloads are passed through verbatim to the queue backend (BullMQ's
 * `data`), which serializes them to JSON. Nothing here interprets them, so the
 * honest type is `unknown` — consumers narrow the payload on the worker side
 * where the job type is known.
 */
export interface JobData {
  type: JobType;
  payload: unknown;
  tenantId?: string;
  userId?: string;
}

export interface JobOptions {
  delay?: number;
  priority?: number;
  attempts?: number;
}

export interface QueueAdapter {
  provider: QueueProvider;
  addJob(jobType: JobType, data: unknown, options?: JobOptions): Promise<void>;
  close(): Promise<void>;
}

let adapter: QueueAdapter | null = null;

/**
 * Initialize the queue adapter.
 *
 * Only a *successful* connection is cached: a Redis outage makes this throw, and
 * the next call tries again rather than living with the failure for the rest of
 * the process's life.
 */
export async function getQueueAdapter(): Promise<QueueAdapter> {
  if (adapter) return adapter;

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error(
      '[Queue] REDIS_URL is not set. The queue has no fallback backend by design (#3411): ' +
      'jobs that cannot reach Redis are refused, not buffered somewhere nothing reads.',
    );
  }

  adapter = await createRedisAdapter(redisUrl);
  console.log('[Queue] Using Redis provider');
  return adapter;
}

/**
 * Redis Adapter (BullMQ). Dynamic import keeps BullMQ out of bundles that only
 * read this module's types.
 */
async function createRedisAdapter(redisUrl: string): Promise<QueueAdapter> {
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  });

  const queues = new Map<JobType, QueueType>();

  try {
    // Probe before building anything. A connection that cannot answer a PING is
    // not a queue, and saying so here is what stops the caller from telling a
    // user their export had started.
    await connection.ping();

    for (const type of JOB_TYPES) {
      queues.set(type, new Queue(type, { connection }));
    }
  } catch (err) {
    await connection.quit().catch(() => undefined);
    throw new Error(
      `[Queue] Redis is unavailable, so no job can be delivered: ${(err as Error).message}`,
    );
  }

  return {
    provider: 'redis',
    async addJob(jobType: JobType, data: unknown, options?: JobOptions) {
      const queue = queues.get(jobType);
      if (!queue) throw new Error(`Unknown job type: ${jobType}`);

      await queue.add(jobType, data, {
        delay: options?.delay,
        priority: options?.priority,
        attempts: options?.attempts || 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    },
    async close() {
      for (const [, queue] of queues) {
        await queue.close();
      }
      await connection.quit();
    },
  };
}

/**
 * Convenience function to add a job. Rejects if the job cannot be handed to
 * Redis — callers that surface this to a user should say the work was not
 * scheduled, not that it was.
 */
export async function addJob(jobType: JobType, data: unknown, options?: JobOptions): Promise<void> {
  const queue = await getQueueAdapter();
  await queue.addJob(jobType, data, options);
}

/**
 * Close all queue connections (for graceful shutdown)
 */
export async function closeQueue(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
}

// Re-export Job type for worker (lazy import)
export type { Job } from 'bullmq';
