/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Redis readiness grace (#3259).
 *
 * `lib/cache/index.ts#acquireLock` fails CLOSED while `redis.status !== 'ready'`
 * (the #M3 note there). That is right for "another worker holds the lock", and
 * right for "Redis is down", but the same `acquired: false` also answers
 * "the client this call just constructed has not finished its handshake yet" —
 * and those three are indistinguishable to the caller.
 *
 * It is not a race, it is deterministic: `getRedisClient()` builds the `ioredis`
 * client lazily, so the first caller to need it gets an instance whose status is
 * `'connecting'` (`ioredis` 5.x leaves it there until the socket plus the ready
 * check complete). The first cron request of every process start therefore
 * reported its own lock as held and answered 423 — a nightly job skipped with a
 * reason that points at a peer instead of at the handshake, and one that
 * "works when I try it manually", because the second call always finds the
 * connection ready.
 *
 * The grace window is deliberately narrow:
 *   - one window per client INSTANCE, remembered in a WeakMap and SHARED by
 *     concurrent callers. A Redis that is genuinely unreachable must not make
 *     every later lock probe pay the wait again — the first probe learns the
 *     truth, the rest fail closed instantly.
 *   - bounded, so a hung handshake degrades to the previous behaviour rather
 *     than to a wedged request.
 *   - skipped entirely for a client that can no longer emit `ready`
 *     (`'end'`: retries exhausted), and for `null` (no REDIS_URL, circuit open,
 *     or permanently disconnected — `getRedisClient` already tells us).
 *
 * This does NOT make the lock fail open. It only lets a connection that is about
 * to be ready answer the question before it is refused.
 */
import type { Redis } from 'ioredis';

/**
 * How long to wait for an in-flight handshake. A same-host connect plus the
 * ready check is single-digit milliseconds; this covers a TLS handshake to a
 * managed Redis and a cold DNS lookup, and it is two orders of magnitude below
 * the smallest cron spacing in `app/api/cron/` (300s), so waiting cannot itself
 * cause a double run — the lock that was taken still spaces the next accepted run.
 */
export const DEFAULT_REDIS_READY_WAIT_MS = 1500;

/**
 * The grace window handed out per client instance. Weak, so a client destroyed
 * by the reconnect path does not keep the previous instance alive; a settled
 * `false` stays settled, which is what stops every later probe of a Redis that
 * is genuinely down from paying the wait again.
 */
const graceWindow = new WeakMap<object, Promise<boolean>>();

/**
 * Resolve `true` once the client reports `'ready'`.
 *
 * Returns `true` immediately when it already is, `false` when the client is
 * beyond saving or the bounded window elapsed. Concurrent callers of one client
 * SHARE the same window, so a scheduler that fires three jobs against a
 * booting process does not refuse the second and third for a reason the first
 * is already waiting on. Safe with any object that exposes a subset of the
 * EventEmitter API (a caller without `on` just waits out the window and gets
 * the fail-closed answer it used to get instantly).
 */
export function waitForRedisReady(
  client: Redis,
  timeoutMs: number = DEFAULT_REDIS_READY_WAIT_MS,
): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  // A client that has run out of retries can never emit 'ready' again; the next
  // getRedisClient() call builds a fresh one.
  if (client.status === 'end' || timeoutMs <= 0) return Promise.resolve(false);

  const alreadyWaiting = graceWindow.get(client);
  if (alreadyWaiting) return alreadyWaiting;

  const window = beginReadinessWait(client, timeoutMs);
  graceWindow.set(client, window);
  return window;
}

function beginReadinessWait(client: Redis, timeoutMs: number): Promise<boolean> {
  // Guarded because `Redis`'s own `on`/`off` are only present on a real client;
  // a partial stand-in should still get the bounded wait, not a TypeError.
  const emitter = client as unknown as {
    status: string;
    on?: (event: string, listener: () => void) => unknown;
    off?: (event: string, listener: () => void) => unknown;
  };

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const subscriptions: Array<['ready' | 'end', () => void]> = [];

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [event, listener] of subscriptions) emitter.off?.(event, listener);
      resolve(ready);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    // Never keep a process alive for someone else's lock probe.
    if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref();

    if (emitter.status === 'ready') return finish(true);
    if (typeof emitter.on === 'function') {
      subscriptions.push(['ready', () => finish(true)], ['end', () => finish(false)]);
      for (const [event, listener] of subscriptions) emitter.on?.(event, listener);
    }
  });
}
