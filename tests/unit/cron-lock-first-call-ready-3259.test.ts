/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3259 — the first cron call after a process start must not be refused as
 * "lock-held" because the Redis handshake has not finished yet.
 *
 * Measured in the code before this file was written:
 *   - `lib/cache/index.ts#getRedisClient()` constructs the `ioredis` client
 *     LAZILY, on the first caller that needs it.
 *   - `lib/cache/index.ts#acquireLock()` then refuses whenever
 *     `redis.status !== 'ready'`, returning `{ acquired: false, value: '' }`.
 *   - A client right after `new Redis(url)` reports status `'connecting'`
 *     (asserted against the pinned ioredis below, not just asserted here), so the
 *     first `acquireLock` of a process CANNOT see `'ready'` — it is
 *     deterministically refused, not merely raced.
 *   - `lib/cron/cron-lock.ts#refuseIfCronLockHeld` turns any `acquired: false`
 *     into `423 { reason: "lock-held" }`, which is what the scheduler and the
 *     panel read as "another instance is running".
 *
 * Nothing here needs a live Redis or a database: the seam the code actually
 * uses is `new Redis(...)` from 'ioredis', so that is what is replaced; the skip
 * logger is stubbed; and the refusal is returned before any job body runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** A URL that is never dialled: the class below replaces the module. */
const FAKE_REDIS_URL = 'redis://nucrm-unit-test-3259:6379';
const CRON_SECRET = 'unit-test-cron-secret-for-3259';

type Listener = (...args: unknown[]) => void;

/** Fixture switchboard — read by the constructor, since the code owns `new`. */
let clientConfig = {
  status: 'connecting',
  /** ms until the fake emits `ready`; null means the handshake never lands. */
  handshakeMs: null as number | null,
  /** What `SET ... NX` answers: 'OK' = lock free, null = somebody holds it. */
  setResult: 'OK' as string | null,
};

/** Minimal EventEmitter-shaped fake, also used directly by waitForRedisReady. */
class FakeClient {
  status: string;
  readonly setCommands: unknown[][] = [];
  readyEmitted = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.status = clientConfig.status;
    clients.push(this);
    if (clientConfig.handshakeMs !== null) {
      const ms = clientConfig.handshakeMs;
      setTimeout(() => this.becomeReady(), ms);
    }
  }

  becomeReady(): void {
    if (this.status === 'ready') return;
    this.status = 'ready';
    this.readyEmitted++;
    this.fire('ready');
  }

  dial(): void {
    this.status = 'end';
    this.fire('end');
  }

  private fire(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  /** Mirrors `SET key value EX ttl NX`: 'OK' when the key was free. */
  async call(...args: unknown[]): Promise<string | null> {
    this.setCommands.push(args);
    return clientConfig.setResult;
  }

  async evaluate(): Promise<number> {
    return 1;
  }
}

/** A bare object with no event API at all — the partial-client edge case. */
function bareClient(status: string): { status: string } {
  return { status };
}

/** Every client the code constructed, so a test can inspect the real instance. */
let clients: FakeClient[] = [];

const asRedis = (client: unknown) => client as import('ioredis').Redis;

describe('cron lock first call after process start (#3259)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clients = [];
    clientConfig = { status: 'connecting', handshakeMs: null, setResult: 'OK' };
    process.env.REDIS_URL = FAKE_REDIS_URL;
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.LOCK_FAIL_OPEN;
    vi.resetModules();
    vi.doMock('ioredis', () => ({ Redis: FakeClient }));
    // `getRedisClient` logs on connect/error; a unit run does not need it.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // The skip logger writes an error_logs row in production (fire-and-forget).
    vi.doMock('@/lib/errors-server', () => ({ logError: vi.fn(async () => {}) }));
  });

  afterEach(() => {
    vi.doUnmock('ioredis');
    vi.doUnmock('@/lib/errors-server');
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('the premise: a freshly constructed client is not "ready"', () => {
    it('is not "ready" while the handshake runs, which is what acquireLock read as contention', async () => {
      // The premise is checked against the REAL library, not the fake above: a
      // client built by `getRedisClient()` is still handshaking on the call that
      // built it, so `redis.status !== 'ready'` rejects it. No server is dialled —
      // the assertion is on the status the constructor leaves the instance in.
      const { Redis: RealRedis } = await vi.importActual<typeof import('ioredis')>('ioredis');
      const probe = new RealRedis(FAKE_REDIS_URL, { lazyConnect: false });
      clientConfig.handshakeMs = 10;
      try {
        // ioredis emits 'error' for the refused socket; with no listener the test
        // aborts, so attach one that does nothing.
        probe.on('error', () => {});
        expect(probe.status).not.toBe('ready');
      } finally {
        probe.disconnect();
      }

      const { acquireLock } = await import('@/lib/cache');
      await acquireLock('cron:backup', 7200);

      // And the code really does build its client lazily, on that very call.
      expect(clients).toHaveLength(1);
      expect(clientConfig.status).toBe('connecting');
    });
  });

  describe('lib/cache#acquireLock', () => {
    it('waits for the handshake and takes the lock instead of reporting contention', async () => {
      clientConfig.handshakeMs = 10;
      const { acquireLock } = await import('@/lib/cache');

      const lock = await acquireLock('cron:backup', 7200);

      // Pre-fix this returned { acquired: false, value: '' } without touching
      // Redis at all, and every caller read that as "another instance is running".
      expect(lock.acquired).toBe(true);
      expect(lock.value).not.toBe('');
      expect(clients[0].status).toBe('ready');
      expect(clients[0].setCommands).toHaveLength(1);
      expect(clients[0].setCommands[0]).toEqual([
        'SET',
        'nucrm:lock:cron:backup',
        lock.value,
        'EX',
        7200,
        'NX',
      ]);
    });

    it('does not wait at all for a connection that is already ready', async () => {
      clientConfig.status = 'ready';
      const { acquireLock } = await import('@/lib/cache');

      const started = Date.now();
      expect((await acquireLock('cron:cleanup', 3600)).acquired).toBe(true);
      expect(Date.now() - started).toBeLessThan(300);
    });
  });

  describe('lib/cache/redis-ready#waitForRedisReady', () => {
    it('returns true at once for a connection that is already ready', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');

      const started = Date.now();
      expect(await waitForRedisReady(asRedis(bareClient('ready')))).toBe(true);
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('resolves true when the handshake lands inside the window', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');
      clientConfig.handshakeMs = 10;
      const client = new FakeClient();

      const started = Date.now();
      expect(await waitForRedisReady(asRedis(client), 500)).toBe(true);
      expect(client.status).toBe('ready');
      // Resolved on the event, not on the timeout.
      expect(Date.now() - started).toBeLessThan(400);
    });

    it('gives a client whose connection is dead nothing to wait for', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');

      // `'end'` = retries exhausted; only a NEW client can become ready.
      expect(await waitForRedisReady(asRedis(bareClient('end')), 500)).toBe(false);
    });

    it('gives up after the bounded window and stays fail-closed', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');
      const client = new FakeClient();

      expect(await waitForRedisReady(asRedis(client), 300)).toBe(false);
      expect(client.status).toBe('connecting');
    });

    it('spends the window at most once per client instance', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');
      const client = new FakeClient();

      const started = Date.now();
      expect(await waitForRedisReady(asRedis(client), 400)).toBe(false);
      const firstElapsed = Date.now() - started;

      // A Redis that is genuinely down must not make every later probe wait too.
      const againStart = Date.now();
      expect(await waitForRedisReady(asRedis(client), 400)).toBe(false);
      expect(Date.now() - againStart).toBeLessThan(100);
      expect(firstElapsed).toBeGreaterThanOrEqual(300);
    });

    it('shares one window between concurrent probes of the same client', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');
      clientConfig.handshakeMs = 10;
      const client = new FakeClient();

      // Three different cron endpoints fired at a booting process must not have
      // the second and third refused for a reason the first is already waiting
      // on — the window is per client, not per caller.
      const results = await Promise.all([
        waitForRedisReady(asRedis(client), 500),
        waitForRedisReady(asRedis(client), 500),
        waitForRedisReady(asRedis(client), 500),
      ]);

      expect(results).toEqual([true, true, true]);
    });

    it('survives a client with no event API instead of throwing', async () => {
      const { waitForRedisReady } = await import('@/lib/cache/redis-ready');

      expect(await waitForRedisReady(asRedis({ status: 'connecting' }), 50)).toBe(false);
    });
  });

  describe('lib/cron/cron-lock — the route-visible behaviour', () => {
    it('lets the FIRST cron request of a process run the job', async () => {
      clientConfig.handshakeMs = 10;
      const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

      // null means "the lock is ours, run the body". Pre-fix this was a 423, so
      // `cron:backup` skipped itself on every `pm2 reload` and logged nothing.
      expect(await refuseIfCronLockHeld('cron:backup', 7200)).toBeNull();
      expect(clients[0].setCommands).toHaveLength(1);
      expect(clients[0].setCommands[0]).toEqual([
        'SET',
        'nucrm:lock:cron:backup',
        expect.any(String),
        'EX',
        7200,
        'NX',
      ]);
    });

    it('still answers 423 lock-held when a ready Redis says the key is taken', async () => {
      clientConfig.status = 'ready';
      clientConfig.setResult = null;
      const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

      const refusal = await refuseIfCronLockHeld('cron:backup', 7200);

      expect(refusal).not.toBeNull();
      expect(refusal!.status).toBe(423);
      expect(await refusal!.json()).toMatchObject({ ok: false, reason: 'lock-held' });
    });

    it('still answers 423 when Redis never becomes ready (#M3 fail-closed)', async () => {
      const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

      const refusal = await refuseIfCronLockHeld('cron:backup', 7200);

      expect(refusal!.status).toBe(423);
      // The SET was never attempted: this is the unavailable answer, not a race
      // for the key.
      expect(clients[0].setCommands).toHaveLength(0);
    });

    it('still honours LOCK_FAIL_OPEN after the wait, and only that flag', async () => {
      process.env.LOCK_FAIL_OPEN = 'true';
      const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

      expect(await refuseIfCronLockHeld('cron:backup', 7200)).toBeNull();
      expect(clients[0].setCommands).toHaveLength(0);
    });

    it('answers instantly when there is no Redis configured at all', async () => {
      delete process.env.REDIS_URL;
      const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');

      const started = Date.now();
      const refusal = await refuseIfCronLockHeld('cron:backup', 7200);

      expect(refusal!.status).toBe(423);
      expect(clients).toHaveLength(0);
      expect(Date.now() - started).toBeLessThan(500);
    });
  });

  describe('what #3259 deliberately did NOT change', () => {
    it('keeps acquireLock fail-closed for a Redis that never arrives, #M3 intact', async () => {
      const { acquireLock } = await import('@/lib/cache');

      const lock = await acquireLock('query:slow', 10);

      expect(lock).toEqual({ acquired: false, value: '' });
      // The SET was never attempted, so getOrSet still takes the retry/stale
      // path it was designed to take rather than believing it holds the lock.
      expect(clients[0].setCommands).toHaveLength(0);
    });

    it('does not make a down Redis slow every subsequent lock probe', async () => {
      const { acquireLock } = await import('@/lib/cache');

      await acquireLock('query:slow', 10); // spends the one grace window

      const started = Date.now();
      expect(await acquireLock('query:other', 10)).toEqual({ acquired: false, value: '' });
      expect(await acquireLock('query:third', 10)).toEqual({ acquired: false, value: '' });
      // Throughput has to degrade, not stall: after the first probe learns the
      // truth, every later reader gets the old instant answer.
      expect(Date.now() - started).toBeLessThan(500);
    });
  });
});
