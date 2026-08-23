/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Realtime server for NuCRM — socket.io + Redis, on the existing infrastructure.
 *
 * WHY A SEPARATE PROCESS
 * The app runs on `next start`, which owns its own HTTP server and gives no hook
 * to attach socket.io to it. Rather than replace Next's server with a custom one
 * (which costs its production optimisations), realtime runs as its own process —
 * exactly the pattern `worker.ts` already uses. nginx routes /socket.io to it.
 *
 * WHY REDIS
 * docker-compose.scale.yml runs several `web` replicas behind nginx, and this
 * process can itself be scaled. A notification created on replica A must reach a
 * socket held by replica B, so:
 *
 *   API route ──publish──▶ Redis channel ──▶ every realtime process ──▶ room
 *
 * The @socket.io/redis-adapter additionally keeps room membership shared, so
 * `io.to(room)` works no matter which process owns the socket.
 *
 * SECURITY
 * The handshake is authenticated from the same `nucrm_session` JWT cookie the app
 * uses, then the tenant membership is looked up server-side. The client never
 * tells us who it is: it cannot ask to join another user's or tenant's room,
 * because rooms are derived from the verified session, not from client input.
 *
 * See docs/adr/0011-realtime-socketio-redis.md and issue #644.
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { eq, and } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { tenantMembers } from '@/drizzle/schema';
import { verifyToken } from '@/lib/auth/session';
import {
  REALTIME_CHANNEL,
  REALTIME_PATH,
  isRealtimeMessage,
  targetRoom,
  userRoom,
  tenantRoom,
} from '@/lib/realtime/events';

const PORT = Number(process.env['REALTIME_PORT'] ?? 4001);
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';
const SESSION_COOKIE = 'nucrm_session';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal cookie-header parser — avoids a dependency for one header. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function makeRedis(label: string): IORedis {
  const client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > 20) {
        console.error(`[Realtime] Redis (${label}) failed after ${times} retries. Exiting.`);
        process.exit(1);
      }
      return Math.min(times * 500, 30_000);
    },
  });
  client.on('error', (err) => console.error(`[Realtime] Redis (${label}) error:`, err.message));
  client.on('connect', () => console.log(`[Realtime] Redis (${label}) connected`));
  return client;
}

// ── bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  // Assigned immediately below; the request handler only runs once a request
  // arrives, by which point it is set.
  let ioRef: Server | null = null;

  const httpServer = createServer((req, res) => {
    // Liveness probe for the orchestrator; everything else belongs to socket.io.
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sockets: ioRef?.engine?.clientsCount ?? 0 }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io = new Server(httpServer, {
    path: REALTIME_PATH,
    // Same-origin through nginx in production; permissive only when explicitly set.
    cors: process.env['REALTIME_CORS_ORIGIN']
      ? { origin: process.env['REALTIME_CORS_ORIGIN'], credentials: true }
      : undefined,
    // Long-poll fallback stays enabled so restrictive proxies still work.
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  ioRef = io;

  // Shared room membership + fanout across processes.
  const pubClient = makeRedis('adapter-pub');
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // ── handshake auth ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      if (!token) return next(new Error('unauthorized'));

      const verified = await verifyToken(token);
      if (!verified?.userId) return next(new Error('unauthorized'));

      // Resolve the tenant from the membership table, not from the client.
      const [membership] = await db
        .select({ tenantId: tenantMembers.tenantId })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.userId, verified.userId),
            eq(tenantMembers.status, 'active'),
          ),
        )
        .limit(1);

      if (!membership?.tenantId) return next(new Error('forbidden'));

      socket.data.userId = verified.userId;
      socket.data.tenantId = membership.tenantId;
      return next();
    } catch (err) {
      console.error('[Realtime] handshake failed:', err instanceof Error ? err.message : err);
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, userId } = socket.data as { tenantId: string; userId: string };

    // Rooms come from the verified session — the client cannot choose them.
    socket.join(userRoom(tenantId, userId));
    socket.join(tenantRoom(tenantId));

    socket.emit('ready', { tenantId, userId });

    socket.on('disconnect', (reason) => {
      if (process.env['REALTIME_DEBUG']) {
        console.log(`[Realtime] disconnect ${userId} (${reason})`);
      }
    });
  });

  // ── fanout: Redis channel -> rooms ────────────────────────────────────────
  const eventSub = makeRedis('events-sub');
  await eventSub.subscribe(REALTIME_CHANNEL);
  eventSub.on('message', (_channel, raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[Realtime] dropped unparseable message');
      return;
    }
    // Never broadcast an envelope we cannot fully trust — a missing tenantId
    // would produce a room name that could collide across tenants.
    if (!isRealtimeMessage(parsed)) {
      console.warn('[Realtime] dropped invalid message envelope');
      return;
    }
    io.to(targetRoom(parsed)).emit(parsed.event, parsed.payload);
  });

  httpServer.listen(PORT, () => {
    console.log(`[Realtime] socket.io listening on :${PORT}${REALTIME_PATH}`);
  });

  // ── graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[Realtime] ${signal} received, shutting down...`);
    try {
      await eventSub.unsubscribe(REALTIME_CHANNEL);
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await Promise.allSettled([eventSub.quit(), subClient.quit(), pubClient.quit()]);
    } catch (err) {
      console.error('[Realtime] shutdown error:', err instanceof Error ? err.message : err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Realtime] fatal startup error:', err);
  process.exit(1);
});
