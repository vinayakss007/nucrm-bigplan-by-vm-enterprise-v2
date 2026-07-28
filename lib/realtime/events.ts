/**
 * Realtime event contract — shared by the browser client, the API routes that
 * publish, and the standalone socket.io server that fans out.
 *
 * Deliberately dependency-free (no server-only imports, no ioredis) so it can be
 * imported from client components without pulling Node built-ins into the bundle.
 *
 * See docs/adr/0011-realtime-socketio-redis.md and issue #644.
 */

/** Redis pub/sub channel every realtime event travels on. */
export const REALTIME_CHANNEL = 'nucrm:realtime';

/** Socket.IO path — must match the nginx location block. */
export const REALTIME_PATH = '/socket.io';

export const RealtimeEvent = {
  /** Unread notification count changed for a user. */
  NotificationUnread: 'notification:unread',
  /** A new notification was created for a user. */
  NotificationNew: 'notification:new',
  /** A record was assigned to a user (lead/deal/ticket). */
  RecordAssigned: 'record:assigned',
} as const;

export type RealtimeEventName = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

/**
 * Rooms are the unit of delivery. Both are tenant-prefixed so a payload can
 * never be addressed to "user X" without also naming the tenant — that prefix is
 * what stops a cross-tenant delivery if a user id were ever reused or spoofed.
 */
export function userRoom(tenantId: string, userId: string): string {
  return `t:${tenantId}:u:${userId}`;
}

export function tenantRoom(tenantId: string): string {
  return `t:${tenantId}`;
}

/** Envelope published to Redis and re-emitted to the addressed room. */
export interface RealtimeMessage {
  event: RealtimeEventName;
  tenantId: string;
  /** When set, delivery is limited to this user; otherwise the whole tenant. */
  userId?: string;
  payload: Record<string, unknown>;
  /** Epoch ms, for staleness diagnostics. */
  ts: number;
}

/**
 * Validates an envelope arriving off Redis. The socket server must not trust
 * whatever lands on the channel: a malformed or partially-written payload would
 * otherwise be broadcast, and a missing tenantId would produce a room name like
 * `t:undefined:u:…` that could collide across tenants.
 */
export function isRealtimeMessage(value: unknown): value is RealtimeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<RealtimeMessage>;
  const validEvent =
    typeof m.event === 'string' &&
    (Object.values(RealtimeEvent) as string[]).includes(m.event);
  return (
    validEvent &&
    typeof m.tenantId === 'string' &&
    m.tenantId.length > 0 &&
    (m.userId === undefined || (typeof m.userId === 'string' && m.userId.length > 0)) &&
    typeof m.payload === 'object' &&
    m.payload !== null &&
    typeof m.ts === 'number'
  );
}

/** Room an envelope should be delivered to. */
export function targetRoom(message: RealtimeMessage): string {
  return message.userId
    ? userRoom(message.tenantId, message.userId)
    : tenantRoom(message.tenantId);
}
