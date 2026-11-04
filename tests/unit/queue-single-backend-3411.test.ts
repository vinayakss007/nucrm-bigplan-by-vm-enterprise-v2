/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3411 — the queue negotiates Redis → pg-boss → memory and caches that choice
 * for the lifetime of the process. Enqueuing is not delivering: pg-boss has no
 * consumer anywhere in this repo, and the memory adapter discards what it buffers,
 * so one Redis blip permanently re-routes a process's jobs into a backend nothing
 * reads while the API keeps answering 200.
 *
 * These screens hold the four things the fix has to guarantee:
 *   A. there is exactly one backend, so there is exactly one failure mode;
 *   B. that failure is thrown at the caller, and a failed negotiation is not
 *      remembered (the next request re-tries Redis);
 *   C. one job registry, and every type in it has both a producer and a consumer;
 *   D. the health route fails on a missing heartbeat instead of describing it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Comment prose is not a call site — the header of this very file says "pg-boss". */
function codeLines(src: string): string[] {
  return src.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
}

const state = vi.hoisted(() => ({
  redisWorks: true,
  heartbeat: null as string | null,
  builtQueues: [] as string[],
}));

vi.mock('ioredis', () => ({
  default: vi.fn(function MockIORedis() {
    return {
      connect: async () => undefined,
      ping: async () => {
        if (!state.redisWorks) throw new Error('ECONNREFUSED 127.0.0.1:6379');
        return 'PONG';
      },
      get: async () => state.heartbeat,
      quit: async () => 'OK',
      disconnect: () => undefined,
      on: () => undefined,
    };
  }),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue(name: string) {
    state.builtQueues.push(name);
    return {
      add: async () => {
        if (!state.redisWorks) throw new Error('ECONNREFUSED');
        return { id: 'job-1' };
      },
      getJobCounts: async () => ({}),
      close: async () => undefined,
    };
  }),
  Worker: vi.fn(),
  QueueEvents: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C,>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const QUEUE_MODULE = '@/lib/queue/index';

describe('#3411 A — one backend, so one failure mode', () => {
  it('lib/queue no longer knows pg-boss', () => {
    const orphans = codeLines(read('lib/queue/index.ts')).filter((l) => /pg-boss|PgBoss|pgboss/i.test(l));
    expect(orphans, 'the pg-boss adapter has no consumer; it must not be reachable').toEqual([]);
  });

  it('lib/queue no longer buffers jobs in memory', () => {
    const orphans = codeLines(read('lib/queue/index.ts')).filter((l) =>
      /createMemoryAdapter|MemoryQueue|provider:\s*'memory'/.test(l));
    expect(orphans, 'a buffer nothing drains is how the jobs went missing').toEqual([]);
  });

  it('the provider type names exactly one provider', () => {
    expect(read('lib/queue/index.ts')).toMatch(/export type QueueProvider\s*=\s*'redis'/);
  });

  it('no caller still asks for the pg-boss instance', () => {
    expect(codeLines(read('lib/queue/index.ts')).filter((l) => /export async function getBoss/.test(l))).toEqual([]);
  });
});

describe('#3411 B — an outage is heard by the caller, and is not remembered', () => {
  beforeEach(() => {
    vi.resetModules();
    state.redisWorks = true;
    state.builtQueues.length = 0;
    process.env.REDIS_URL = 'redis://localhost:6379';
    delete process.env.DATABASE_URL;
  });

  it('addJob rejects while Redis is down instead of accepting the job', async () => {
    state.redisWorks = false;
    const { addJob } = await import(QUEUE_MODULE);
    await expect(addJob('send-email', { to: 'someone@example.com' })).rejects.toThrow();
  });

  it('refuses when REDIS_URL is unset, in any environment', async () => {
    delete process.env.REDIS_URL;
    const { addJob } = await import(QUEUE_MODULE);
    await expect(addJob('send-email', { to: 'someone@example.com' })).rejects.toThrow(/REDIS_URL/);
  });

  it('a failed negotiation is not cached — the next call gets a working adapter', async () => {
    state.redisWorks = false;
    const first = await import(QUEUE_MODULE);
    await expect(first.getQueueAdapter()).rejects.toThrow();

    state.redisWorks = true;
    const adapter = await first.getQueueAdapter();
    expect(adapter.provider).toBe('redis');
  });

  it('the refusal names the queue, so a route can tell the user nothing was scheduled', async () => {
    state.redisWorks = false;
    const { addJob } = await import(QUEUE_MODULE);
    await expect(addJob('export-csv', {})).rejects.toThrow(/queue|redis/i);
  });
});

describe('#3411 C — one registry; a type with only one half fails', () => {
  it('the job types are declared once, as a value the adapters and the worker both read', () => {
    const src = read('lib/queue/index.ts');
    expect(src).toMatch(/export const JOB_TYPES\s*=\s*\[/);
    expect(src).toMatch(/export type JobType = typeof JOB_TYPES\[number\]/);
    // The two per-adapter literal arrays are what let a type exist on one side only.
    expect(codeLines(src).filter((l) => /:\s*JobType\[\]\s*=\s*\[/.test(l))).toEqual([]);
  });

  it('worker.ts reads that list instead of keeping its own', () => {
    const src = read('worker.ts');
    expect(codeLines(src).filter((l) => /const QUEUE_NAMES\s*=\s*\[/.test(l))).toEqual([]);
    expect(src).toMatch(/JOB_TYPES[^}]*\}\s*from\s*'@\/lib\/queue\/index'/);
  });

  it('every type a producer can enqueue has a consumer, and nothing consumes a type nobody produces', async () => {
    const { JOB_TYPES } = await import(QUEUE_MODULE) as unknown as { JOB_TYPES: readonly string[] };
    expect(JOB_TYPES.length).toBeGreaterThanOrEqual(10);

    const worker = read('worker.ts');
    const consumed = [...worker.matchAll(/new Worker\(\s*'([^']+)'/g)].map((m) => m[1]);

    for (const type of JOB_TYPES) {
      expect(consumed, `${type} can be produced but nothing consumes it`).toContain(type);
    }
    const unproduced = consumed.filter((type) => !JOB_TYPES.includes(type));
    expect(unproduced, 'worker consumes a type the registry cannot produce').toEqual([]);
  });

  it('the adapter opens a BullMQ queue for every declared type', async () => {
    state.builtQueues.length = 0;
    const { getQueueAdapter, closeQueue, JOB_TYPES } = await import(QUEUE_MODULE) as unknown as {
      getQueueAdapter: () => Promise<{ provider: string }>;
      closeQueue: () => Promise<void>;
      JOB_TYPES: readonly string[];
    };

    const adapter = await getQueueAdapter();
    expect(adapter.provider).toBe('redis');
    for (const type of JOB_TYPES) {
      expect(state.builtQueues, `${type} has no queue, so addJob(${type}) would throw`).toContain(type);
    }
    await closeQueue();
  });
});

describe('#3411 D — /api/system/worker-health fails on a missing heartbeat', () => {
  const rel = 'app/api/system/worker-health/route.ts';

  it('looks at the key the worker actually writes, not only at Redis', () => {
    expect(read(rel)).toMatch(/worker:heartbeat/);
  });

  it('is unhealthy when Redis answers but no worker has checked in', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);

    state.redisWorks = true;
    state.heartbeat = null;

    const { GET } = await import('@/app/api/system/worker-health/route');
    const response = await GET(new NextRequest('http://localhost/api/system/worker-health')) as Response;

    expect(response.status).toBe(503);
    const body = await response.json() as { data: { healthy: boolean; worker?: { present: boolean } } };
    expect(body.data.healthy).toBe(false);
    expect(body.data.worker?.present, 'the payload must say which half failed').toBe(false);
  });

  it('is healthy when Redis answers and a worker is reporting every queue running', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);

    state.redisWorks = true;
    state.heartbeat = JSON.stringify({ workers: { 'send-email': true }, uptime: 12 });

    const { GET } = await import('@/app/api/system/worker-health/route');
    const response = await GET(new NextRequest('http://localhost/api/system/worker-health')) as Response;

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { healthy: boolean } };
    expect(body.data.healthy).toBe(true);
  });

  it('is unhealthy when a worker reports a stopped consumer', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    vi.mocked(requireAuth).mockResolvedValue({ isSuperAdmin: true } as never);

    state.redisWorks = true;
    state.heartbeat = JSON.stringify({ workers: { 'send-email': true, 'webhooks': false }, uptime: 12 });

    const { GET } = await import('@/app/api/system/worker-health/route');
    const response = await GET(new NextRequest('http://localhost/api/system/worker-health')) as Response;

    expect(response.status).toBe(503);
  });
});
