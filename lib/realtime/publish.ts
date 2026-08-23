/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import 'server-only';

/**
 * Server-side realtime publisher.
 *
 * API routes and workers call `publishRealtime()`; the standalone socket.io
 * server (realtime.ts) subscribes to the same Redis channel and fans the message
 * out to the addressed room. Going through Redis rather than emitting directly is
 * what makes this work with several `web` replicas behind nginx — any replica can
 * publish, and every socket server sees it.
 *
 * Publishing is strictly best-effort: a realtime notification is a convenience on
 * top of a row that is already committed. If Redis is down, the DB write must
 * still succeed and the client falls back to polling. So nothing here throws.
 */

import { Redis } from 'ioredis';
import {
  REALTIME_CHANNEL,
  RealtimeEvent,
  type RealtimeEventName,
  type RealtimeMessage,
} from './events';
import { logger } from '@/lib/logger';

let publisher: Redis | null = null;
let disabledReason: string | null = null;

function getPublisher(): Redis | null {
  if (disabledReason) return null;
  if (publisher) return publisher;

  const url = process.env['REDIS_URL'];
  if (!url) {
    // Not an error: single-instance dev without Redis simply has no push.
    disabledReason = 'REDIS_URL not configured';
    return null;
  }

  publisher = new Redis(url, {
    // A publish must never queue up behind a dead connection — fail fast and
    // let the caller carry on. The client's polling fallback covers the gap.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 3000)),
    lazyConnect: false,
  });

  publisher.on('error', (err) => {
    logger.warn('[realtime] publisher redis error', { error: err.message });
  });

  return publisher;
}

/** Publish an event. Never throws. Returns true if it reached Redis. */
export async function publishRealtime(
  event: RealtimeEventName,
  args: { tenantId: string; userId?: string; payload?: Record<string, unknown> },
): Promise<boolean> {
  const { tenantId, userId, payload = {} } = args;

  // A message without a tenant cannot be addressed to a room safely.
  if (!tenantId) return false;

  const client = getPublisher();
  if (!client) return false;

  const message: RealtimeMessage = {
    event,
    tenantId,
    ...(userId ? { userId } : {}),
    payload,
    ts: Date.now(),
  };

  try {
    await client.publish(REALTIME_CHANNEL, JSON.stringify(message));
    return true;
  } catch (err) {
    logger.warn('[realtime] publish failed', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Convenience: tell one user their unread notification count changed. */
export async function publishUnreadCount(
  tenantId: string,
  userId: string,
  count: number,
): Promise<boolean> {
  return publishRealtime(RealtimeEvent.NotificationUnread, {
    tenantId,
    userId,
    payload: { count },
  });
}

/** Convenience: push a freshly created notification to one user. */
export async function publishNewNotification(
  tenantId: string,
  userId: string,
  notification: { title: string; body?: string; link?: string | null; type?: string },
): Promise<boolean> {
  return publishRealtime(RealtimeEvent.NotificationNew, {
    tenantId,
    userId,
    payload: { ...notification },
  });
}

/** Test/shutdown hook. */
export async function closeRealtimePublisher(): Promise<void> {
  if (publisher) {
    try {
      await publisher.quit();
    } catch {
      publisher.disconnect();
    }
    publisher = null;
  }
  disabledReason = null;
}
