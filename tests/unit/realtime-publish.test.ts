/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coverage for lib/realtime/publish.ts — the server-side half of #644.
 *
 * `lib/realtime/events.ts` and `lib/use-notifications.ts` both arrived with
 * tests; the publisher did not. It is the piece with the most ways to go quietly
 * wrong, because its entire contract is "never throw, never block the caller":
 * every API route that creates a notification calls it *after* the row is
 * already committed. A publisher that threw on a dead Redis would turn a
 * best-effort convenience into a failed write, and because the client falls back
 * to polling, a publisher that silently stopped publishing would look like
 * nothing worse than slightly stale badges.
 *
 * So these tests pin two things: the exact envelope put on the wire (the socket
 * server validates it with isRealtimeMessage and drops anything malformed), and
 * that every failure mode resolves `false` instead of rejecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { REALTIME_CHANNEL, RealtimeEvent, isRealtimeMessage } from '@/lib/realtime/events';

const h = vi.hoisted(() => ({
  ctorCalls: [] as Array<[string, Record<string, any>]>,
  publish: vi.fn(async () => 1),
  quit: vi.fn(async () => 'OK'),
  disconnect: vi.fn(),
  handlers: {} as Record<string, (err: Error) => void>,
  instances: 0,
}));

vi.mock('ioredis', () => ({
  Redis: class {
    constructor(url: string, opts: Record<string, any>) {
      h.ctorCalls.push([url, opts]);
      h.instances += 1;
    }
    publish = (...args: any[]) => h.publish.apply(null, args as any);
    quit = () => h.quit();
    disconnect = () => h.disconnect();
    on(event: string, cb: (err: Error) => void) {
      h.handlers[event] = cb;
      return this;
    }
  },
}));

const loggerWarn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({
  logger: { warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ORIGINAL_REDIS_URL = process.env['REDIS_URL'];

beforeEach(() => {
  vi.clearAllMocks();
  h.ctorCalls.length = 0;
  h.instances = 0;
  h.handlers = {};
  h.publish.mockImplementation(async () => 1);
  h.quit.mockImplementation(async () => 'OK');
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  // The module memoises both the client and its disabled-reason, so each test
  // needs a fresh instance.
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env['REDIS_URL'];
  else process.env['REDIS_URL'] = ORIGINAL_REDIS_URL;
});

/** The envelope handed to Redis on the most recent publish. */
function lastEnvelope() {
  const [channel, raw] = h.publish.mock.calls.at(-1) as unknown as [string, string];
  return { channel, message: JSON.parse(raw) };
}

describe('publishRealtime', () => {
  it('publishes a valid envelope on the shared channel', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    const ok = await publishRealtime(RealtimeEvent.RecordAssigned, {
      tenantId: 't-1',
      userId: 'u-1',
      payload: { recordId: 'r-1' },
    });

    expect(ok).toBe(true);
    const { channel, message } = lastEnvelope();
    expect(channel).toBe(REALTIME_CHANNEL);
    expect(message).toMatchObject({
      event: RealtimeEvent.RecordAssigned,
      tenantId: 't-1',
      userId: 'u-1',
      payload: { recordId: 'r-1' },
    });
    expect(typeof message.ts).toBe('number');
    // The socket server drops anything isRealtimeMessage rejects, so a publisher
    // that emitted a subtly wrong shape would fail completely silently.
    expect(isRealtimeMessage(message)).toBe(true);
  });

  it('omits userId entirely for a tenant-wide event', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.RecordAssigned, { tenantId: 't-1' });

    const { message } = lastEnvelope();
    // Not `userId: undefined` — an explicit undefined would survive as a key in
    // some serialisers and targetRoom() branches on its presence.
    expect('userId' in message).toBe(false);
    expect(isRealtimeMessage(message)).toBe(true);
  });

  it('defaults payload to an empty object', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1', userId: 'u-1' });
    expect(lastEnvelope().message.payload).toEqual({});
  });

  it('stamps ts with the current time', async () => {
    const before = Date.now();
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });
    const { ts } = lastEnvelope().message;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it('refuses to publish without a tenantId', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    // Without a tenant the room name would be `t:undefined:...`, which could
    // collide across tenants — so this must be rejected, not best-effort.
    await expect(
      publishRealtime(RealtimeEvent.NotificationNew, { tenantId: '', userId: 'u-1' }),
    ).resolves.toBe(false);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('never even constructs a client when the tenant is missing', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: '' });
    expect(h.instances).toBe(0);
  });

  it('is a no-op when REDIS_URL is not configured', async () => {
    delete process.env['REDIS_URL'];
    vi.resetModules();
    const { publishRealtime } = await import('@/lib/realtime/publish');

    // Single-instance dev without Redis: no push, but no error either.
    await expect(
      publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' }),
    ).resolves.toBe(false);
    expect(h.instances).toBe(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('stays disabled without retrying the connection on every call', async () => {
    delete process.env['REDIS_URL'];
    vi.resetModules();
    const { publishRealtime } = await import('@/lib/realtime/publish');
    for (let i = 0; i < 3; i++) {
      await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });
    }
    expect(h.instances).toBe(0);
  });

  it('resolves false instead of throwing when the publish fails', async () => {
    h.publish.mockRejectedValue(new Error('READONLY You cannot write against a replica'));
    const { publishRealtime } = await import('@/lib/realtime/publish');

    // The caller has already committed a row; a rejection here would surface as
    // a failed request for work that actually succeeded.
    await expect(
      publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1', userId: 'u-1' }),
    ).resolves.toBe(false);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('handles a non-Error rejection without throwing', async () => {
    h.publish.mockRejectedValue('connection reset');
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await expect(
      publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' }),
    ).resolves.toBe(false);
  });

  it('reuses one connection across many publishes', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    for (let i = 0; i < 5; i++) {
      await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });
    }
    // A client per publish would exhaust Redis connections under load.
    expect(h.instances).toBe(1);
    expect(h.publish).toHaveBeenCalledTimes(5);
  });

  it('configures the client to fail fast rather than queue', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });

    const [url, opts] = h.ctorCalls[0];
    expect(url).toBe('redis://localhost:6379');
    // Queueing offline would make a request wait on a dead Redis — the opposite
    // of best-effort.
    expect(opts.enableOfflineQueue).toBe(false);
    expect(opts.maxRetriesPerRequest).toBe(1);
  });

  it('backs off linearly then gives up after 5 attempts', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });

    const retryStrategy = h.ctorCalls[0][1].retryStrategy as (n: number) => number | null;
    expect([1, 2, 3, 4, 5].map(retryStrategy)).toEqual([200, 400, 600, 800, 1000]);
    // Returning null tells ioredis to stop retrying.
    expect(retryStrategy(6)).toBeNull();
    expect(retryStrategy(50)).toBeNull();
    // Note: the `Math.min(times * 200, 3000)` cap in publish.ts is unreachable.
    // `times > 5` short-circuits to null first, so the largest delay ever
    // returned is 1000ms at times === 5. Harmless, but the 3000 is dead.
  });

  it('logs but swallows redis client errors', async () => {
    const { publishRealtime } = await import('@/lib/realtime/publish');
    await publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });

    expect(h.handlers['error']).toBeTypeOf('function');
    expect(() => h.handlers['error'](new Error('ECONNREFUSED'))).not.toThrow();
    expect(loggerWarn).toHaveBeenCalledWith(
      '[realtime] publisher redis error',
      expect.objectContaining({ error: 'ECONNREFUSED' }),
    );
  });
});

describe('publishUnreadCount', () => {
  it('sends an authoritative count to one user', async () => {
    const { publishUnreadCount } = await import('@/lib/realtime/publish');
    await expect(publishUnreadCount('t-1', 'u-1', 7)).resolves.toBe(true);

    const { message } = lastEnvelope();
    expect(message.event).toBe(RealtimeEvent.NotificationUnread);
    expect(message.tenantId).toBe('t-1');
    expect(message.userId).toBe('u-1');
    expect(message.payload).toEqual({ count: 7 });
    expect(isRealtimeMessage(message)).toBe(true);
  });

  it('can send zero, which is what mark-all-read produces', async () => {
    const { publishUnreadCount } = await import('@/lib/realtime/publish');
    await publishUnreadCount('t-1', 'u-1', 0);
    expect(lastEnvelope().message.payload).toEqual({ count: 0 });
  });
});

describe('publishNewNotification', () => {
  it('pushes the notification fields to one user', async () => {
    const { publishNewNotification } = await import('@/lib/realtime/publish');
    await expect(
      publishNewNotification('t-1', 'u-1', {
        title: 'Deal assigned',
        body: 'Acme renewal',
        link: '/tenant/deals/d-1',
        type: 'assignment',
      }),
    ).resolves.toBe(true);

    const { message } = lastEnvelope();
    expect(message.event).toBe(RealtimeEvent.NotificationNew);
    expect(message.userId).toBe('u-1');
    expect(message.payload).toEqual({
      title: 'Deal assigned',
      body: 'Acme renewal',
      link: '/tenant/deals/d-1',
      type: 'assignment',
    });
    expect(isRealtimeMessage(message)).toBe(true);
  });

  it('carries a title-only notification', async () => {
    const { publishNewNotification } = await import('@/lib/realtime/publish');
    await publishNewNotification('t-1', 'u-1', { title: 'Ping' });
    expect(lastEnvelope().message.payload).toEqual({ title: 'Ping' });
  });

  it('preserves an explicitly null link', async () => {
    const { publishNewNotification } = await import('@/lib/realtime/publish');
    await publishNewNotification('t-1', 'u-1', { title: 'Ping', link: null });
    expect(lastEnvelope().message.payload).toEqual({ title: 'Ping', link: null });
  });
});

describe('closeRealtimePublisher', () => {
  it('quits an open connection', async () => {
    const mod = await import('@/lib/realtime/publish');
    await mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });
    await mod.closeRealtimePublisher();
    expect(h.quit).toHaveBeenCalledTimes(1);
    expect(h.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to disconnect when quit fails', async () => {
    h.quit.mockRejectedValue(new Error('already closed'));
    const mod = await import('@/lib/realtime/publish');
    await mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });

    // A failed graceful quit must not leave the socket dangling on shutdown.
    await expect(mod.closeRealtimePublisher()).resolves.toBeUndefined();
    expect(h.disconnect).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when nothing was ever opened', async () => {
    const mod = await import('@/lib/realtime/publish');
    await expect(mod.closeRealtimePublisher()).resolves.toBeUndefined();
    expect(h.quit).not.toHaveBeenCalled();
  });

  it('allows publishing again after a close', async () => {
    const mod = await import('@/lib/realtime/publish');
    await mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' });
    await mod.closeRealtimePublisher();
    await expect(
      mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' }),
    ).resolves.toBe(true);
    expect(h.instances).toBe(2);
  });

  it('re-enables a publisher that had been disabled for want of REDIS_URL', async () => {
    delete process.env['REDIS_URL'];
    vi.resetModules();
    const mod = await import('@/lib/realtime/publish');
    expect(await mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' })).toBe(false);

    // closeRealtimePublisher clears disabledReason, so a later configured env
    // is picked up without a process restart.
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    await mod.closeRealtimePublisher();
    expect(await mod.publishRealtime(RealtimeEvent.NotificationNew, { tenantId: 't-1' })).toBe(true);
  });
});
