/**
 * Hybrid Queue System
 * Auto-detects: Redis (BullMQ) → pg-boss → In-memory (dev fallback)
 *
 * Uses dynamic imports to avoid loading unused queue libraries
 */

import type { Queue as QueueType } from 'bullmq';

export type QueueProvider = 'redis' | 'pgboss' | 'memory';
export type JobType = 'send-email' | 'send-notification' | 'send-bulk-emails' | 'export-csv' | 'contact-import' | 'run-automation';

export interface JobData {
  type: JobType;
  payload: any;
  tenantId?: string;
  userId?: string;
}

export interface QueueAdapter {
  provider: QueueProvider;
  addJob(jobType: JobType, data: any, options?: JobOptions): Promise<void>;
  close(): Promise<void>;
}

export interface JobOptions {
  delay?: number;
  priority?: number;
  attempts?: number;
}

let adapter: QueueAdapter | null = null;
let pgbossInstance: any = null;

/**
 * Initialize the queue adapter (auto-detect best available)
 * Uses dynamic imports to avoid loading unused libraries
 */
export async function getQueueAdapter(): Promise<QueueAdapter> {
  if (adapter) return adapter;

  const redisUrl = process.env['REDIS_URL'];
  const databaseUrl = process.env.DATABASE_URL;

  // Try Redis first
  if (redisUrl) {
    try {
      const redisAdapter = await createRedisAdapter(redisUrl);
      adapter = redisAdapter;
      console.log(`[Queue] Using Redis provider`);
      return adapter;
    } catch (err) {
      console.warn(`[Queue] Redis unavailable: ${(err as Error).message}. Falling back to pg-boss...`);
    }
  }

  // Fallback to pg-boss
  if (databaseUrl) {
    try {
      const pgbossAdapter = await createPgBossAdapter(databaseUrl);
      adapter = pgbossAdapter;
      console.log(`[Queue] Using pg-boss provider`);
      return adapter;
    } catch (err) {
      console.warn(`[Queue] pg-boss unavailable: ${(err as Error).message}. Falling back to memory...`);
    }
  }

  // Last resort: in-memory (dev only)
  const memoryAdapter = createMemoryAdapter();
  adapter = memoryAdapter;
  console.warn(`[Queue] Using in-memory provider (NOT FOR PRODUCTION)`);
  return adapter;
}

/**
 * Redis Adapter (BullMQ) - Best performance
 * Uses dynamic import to avoid loading BullMQ when not needed
 */
async function createRedisAdapter(redisUrl: string): Promise<QueueAdapter> {
  // Dynamic import - only loads if Redis is configured
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  });

  // Test connection
  await connection.ping();

  const queues = new Map<JobType, QueueType>();

  const jobTypes: JobType[] = ['send-email', 'send-notification', 'send-bulk-emails', 'export-csv', 'contact-import', 'run-automation'];
  for (const type of jobTypes) {
    queues.set(type, new Queue(type, { connection }));
  }

  return {
    provider: 'redis',
    async addJob(jobType: JobType, data: any, options?: JobOptions) {
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
 * pg-boss Adapter - Good alternative, uses existing PostgreSQL
 * Uses dynamic import to avoid loading pg-boss when not needed
 */
async function createPgBossAdapter(databaseUrl: string): Promise<QueueAdapter> {
  // Dynamic import - only loads if pg-boss is needed
  const PgBossModule = await import('pg-boss');
  const PgBoss = (PgBossModule as any).default || PgBossModule;

  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  pgbossInstance = boss;

  const jobTypes: JobType[] = ['send-email', 'send-notification', 'send-bulk-emails', 'export-csv', 'contact-import', 'run-automation'];

  // Create queues for each job type
  for (const type of jobTypes) {
    await boss.createQueue(type);
  }

  return {
    provider: 'pgboss',
    async addJob(jobType: JobType, data: any, options?: JobOptions) {
      await boss.send(jobType, data, {
        startAfter: options?.delay ? new Date(Date.now() + options.delay) : undefined,
        priority: options?.priority,
        retryLimit: options?.attempts || 3,
        retryDelay: 5,
      });
    },
    async close() {
      await boss.stop();
    },
  };
}

/**
 * In-Memory Adapter - Dev fallback only!
 */
function createMemoryAdapter(): QueueAdapter {
  const pendingJobs: Array<{ type: JobType; data: any; runAt: number }> = [];

  // Process jobs every 5 seconds
  const interval = setInterval(() => {
    const now = Date.now();
    const dueJobs = pendingJobs.filter(j => j.runAt <= now);
    for (const job of dueJobs) {
      console.log(`[MemoryQueue] Processing: ${job.type}`, job.data);
      pendingJobs.splice(pendingJobs.indexOf(job), 1);
    }
  }, 5000);

  return {
    provider: 'memory',
    async addJob(jobType: JobType, data: any, options?: JobOptions) {
      pendingJobs.push({
        type: jobType,
        data,
        runAt: Date.now() + (options?.delay || 0),
      });
      console.log(`[MemoryQueue] Queued: ${jobType}`);
    },
    async close() {
      clearInterval(interval);
      pendingJobs.length = 0;
    },
  };
}

/**
 * Convenience function to add a job
 */
export async function addJob(jobType: JobType, data: any, options?: JobOptions): Promise<void> {
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

/**
 * Get the underlying pg-boss instance for advanced usage
 * Returns null if not using pg-boss provider
 */
export async function getBoss(): Promise<any> {
  if (!pgbossInstance) {
    const queueAdapter = await getQueueAdapter();
    if (queueAdapter.provider !== 'pgboss') {
      throw new Error('getBoss() is only available with pg-boss provider. Current: ' + queueAdapter.provider);
    }
  }
  return pgbossInstance;
}
