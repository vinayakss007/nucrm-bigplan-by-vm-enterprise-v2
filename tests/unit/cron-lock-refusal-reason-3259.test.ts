/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3259 ask 2 — a refused cron lock names WHICH refusal it is.
 *
 * PR #3287 shipped the grace window, so "the handshake had not finished" is no
 * longer read as contention. What it left deliberate (its own body, `:68-72`:
 * "Issue option 2 … Out of scope for a missed-job fix") is that the two
 * remaining states were still one string: `lib/cache#acquireLock` answered
 * `{ acquired: false, value: '' }` both when a peer holds the key and when the
 * store could not be consulted, and `lib/cron/cron-lock.ts` mapped any of that
 * to `423 { reason: "lock-held" }` plus a `recordCronSkip` row that repeats the
 * same claim. A Redis outage therefore reported a busy scheduler, to the HTTP
 * caller and in the log the operator reads.
 *
 * Nothing here needs a live Redis or a database: the seam is `new Redis(...)`
 * from 'ioredis', the same one #3287's screen replaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_REDIS_URL = 'redis://nucrm-unit-test-3259-reason:6379';
const CRON_SECRET = 'unit-test-cron-secret-for-3259';

type Listener = (...args: unknown[]) => void;

let clientConfig = {
  status: 'ready',
  /** What `SET … NX` answers: 'OK' = free, null = a peer holds it. */
  setResult: 'OK' as string | null,
  /** A store that cannot be consulted, as opposed to one that says "taken". */
  callThrows: false,
};

class FakeClient {
  status: string;
  readonly setCommands: unknown[][] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.status = clientConfig.status;
    clients.push(this);
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

  async call(...args: unknown[]): Promise<string | null> {
    this.setCommands.push(args);
    if (clientConfig.callThrows) throw new Error('connection reset by peer');
    return clientConfig.setResult;
  }
}

let clients: FakeClient[] = [];

/** The skip logger is the other half of the fix: it must stop lying too. */
const logError = vi.fn(async () => {});

async function acquireLockReal(key: string, ttl: number) {
  const { acquireLock } = await import('@/lib/cache');
  return acquireLock(key, ttl);
}

async function refusalFor(key = 'cron:backup', ttl = 7200) {
  const { refuseIfCronLockHeld } = await import('@/lib/cron/cron-lock');
  return refuseIfCronLockHeld(key, ttl);
}

describe('#3259 ask 2 — a lock refusal says which refusal it is', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clients = [];
    clientConfig = { status: 'ready', setResult: 'OK', callThrows: false };
    logError.mockClear();
    process.env.REDIS_URL = FAKE_REDIS_URL;
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.LOCK_FAIL_OPEN;
    vi.resetModules();
    vi.doMock('ioredis', () => ({ Redis: FakeClient }));
    vi.doMock('@/lib/errors-server', () => ({ logError }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock('ioredis');
    vi.doUnmock('@/lib/errors-server');
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('lib/cache#acquireLock reports the cause', () => {
    it('says "held" — and keeps the value it wrote nothing with — when a peer owns the key', async () => {
      clientConfig.setResult = null;

      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock).toMatchObject({ acquired: false, reason: 'held' });
      // The value is still returned because `releaseLock` callers compare it; an
      // empty string there would make a held lock indistinguishable from a
      // fail-open pass.
      expect(lock.value).not.toBe('');
      expect(clients[0].setCommands).toHaveLength(1);
    });

    it('says "unavailable" when the store rejects, rather than blaming a peer', async () => {
      clientConfig.callThrows = true;

      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock).toEqual({ acquired: false, value: '', reason: 'unavailable' });
    });

    it('says "unavailable" when there is no Redis configured at all', async () => {
      delete process.env.REDIS_URL;

      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock).toMatchObject({ acquired: false, reason: 'unavailable' });
      expect(clients).toHaveLength(0);
    });

    it('says "unavailable" when the client is not ready and the grace window elapsed', async () => {
      clientConfig.status = 'end'; // retries exhausted: nothing to wait for

      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock).toMatchObject({ acquired: false, reason: 'unavailable' });
    });

    it('reports no reason at all when the lock is ours', async () => {
      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock.acquired).toBe(true);
      expect(lock.reason).toBeUndefined();
    });

    it('leaves LOCK_FAIL_OPEN callers exactly as they were: a pass, no reason', async () => {
      process.env.LOCK_FAIL_OPEN = 'true';
      clientConfig.callThrows = true;

      const lock = await acquireLockReal('cron:backup', 7200);

      // Fail-open means "run anyway", so there is no refusal left to explain —
      // and the ~dozen non-cron callers (getOrSet, warm, the retry loops) must
      // still see the boolean they were written against.
      expect(lock).toEqual({ acquired: true, value: '' });
    });

    it('does not let LOCK_FAIL_OPEN turn real contention into a pass', async () => {
      // #M3's flag is about an unreachable store. A key a peer holds is not that,
      // and a stampede of two "first" runs is precisely what the lock exists to
      // stop.
      process.env.LOCK_FAIL_OPEN = 'true';
      clientConfig.setResult = null;

      const lock = await acquireLockReal('cron:backup', 7200);

      expect(lock).toMatchObject({ acquired: false, reason: 'held' });
    });
  });

  describe('the route-visible refusal', () => {
    it('answers 423 lock-held, unchanged, when a peer owns the key', async () => {
      clientConfig.setResult = null;

      const refusal = await refusalFor();

      expect(refusal!.status).toBe(423);
      expect(await refusal!.json()).toEqual({
        ok: false,
        skipped: 'lock-held',
        reason: 'lock-held',
        error: 'Cron job "cron:backup" did not run: its lock is already held by another instance',
      });
    });

    it('answers 423 lock-unavailable, and refuses to name a peer, when the store is out', async () => {
      clientConfig.callThrows = true;

      const refusal = await refusalFor();
      const body = (await refusal!.json()) as Record<string, unknown>;

      expect(refusal!.status).toBe(423);
      expect(body).toEqual({
        ok: false,
        skipped: 'lock-unavailable',
        reason: 'lock-unavailable',
        error:
          'Cron job "cron:backup" did not run: its lock store could not be consulted, ' +
          'so the dedup check failed closed — no other instance is implied',
      });
      // The sentence an operator reads must not accuse a process that does not exist.
      expect(String(body.error)).not.toContain('another instance');
      expect(String(body.error).toLowerCase()).not.toContain('busy');
    });

    it('keeps the four-key body shape, because consumers were written against it', async () => {
      clientConfig.callThrows = true;
      const refusal = await refusalFor();

      expect(Object.keys((await refusal!.json()) as object).sort()).toEqual([
        'error',
        'ok',
        'reason',
        'skipped',
      ]);
    });

    it('is byte-identical to #2539 when the caller does not pass a reason', async () => {
      const { cronLockRefusalResponse } = await import('@/lib/cron/cron-lock');

      const body = (await cronLockRefusalResponse('cron:cleanup').json()) as object;
      expect(body).toEqual({
        ok: false,
        skipped: 'lock-held',
        reason: 'lock-held',
        error: 'Cron job "cron:cleanup" did not run: its lock is already held by another instance',
      });
    });
  });

  describe('the log row the operator actually reads', () => {
    it('records contention as a warning that blames the holder', async () => {
      clientConfig.setResult = null;
      await refusalFor('cron:cleanup', 3600);
      await flush();

      const row = logError.mock.calls.at(-1)?.[0] as {
        level: string;
        context: string;
        metadata: Record<string, unknown>;
      };
      expect(row.context).toBe('cron-lock');
      expect(row.level).toBe('warning');
      expect(row.metadata).toEqual({ job: 'cron:cleanup', reason: 'lock-held' });
    });

    it('records an unreachable store as an error that says so', async () => {
      clientConfig.callThrows = true;
      await refusalFor('cron:cleanup', 3600);
      await flush();

      const row = logError.mock.calls.at(-1)?.[0] as {
        level: string;
        metadata: Record<string, unknown>;
      };
      // A Redis that is down is an outage, not a routine skip: the level is what
      // makes the two distinguishable in the error pipeline, not only in the
      // string.
      expect(row.level).toBe('error');
      expect(row.metadata).toEqual({ job: 'cron:cleanup', reason: 'lock-unavailable' });
    });

    it('logs nothing when the lock is ours', async () => {
      await refusalFor();
      await flush();

      expect(logError).not.toHaveBeenCalled();
    });
  });
});

/** `recordCronSkip` is fire-and-forget; give the dynamic import a tick. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
