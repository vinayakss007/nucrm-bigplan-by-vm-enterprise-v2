# ADR-0011: Realtime via socket.io + Redis in a separate process

**Status:** Accepted
**Date:** 2026-07-28
**Issue:** #644 (replace SSE polling with WebSocket)

## Context

Notifications were delivered over Server-Sent Events. The stream handler
(`app/api/tenant/notifications/stream/route.ts`) ran `setInterval(sendUnread, 30000)`
per connected client, and each tick executed a `COUNT(*)` against `notifications`.

Cost therefore scaled with **connected clients**, not with **events**: 200 idle
users with nothing happening still produced 400 count queries per minute. It also
meant a notification created at t=0 could take up to 30 seconds to appear.

The user chose **socket.io + Redis on the existing infrastructure** over a managed
service (Pusher/Ably).

## Decision

Realtime runs as a **separate Node process** (`realtime.ts`), fanned out through
**Redis pub/sub**, with `@socket.io/redis-adapter` for shared room membership.

```
API route / worker ──publish──▶ Redis channel `nucrm:realtime`
                                        │
                        ┌───────────────┴───────────────┐
                   realtime #1                     realtime #2
                        └────────── io.to(room).emit ───┘
```

### Why a separate process, not Next's server

The app runs on `next start`, which owns its own HTTP server and exposes no hook
to attach socket.io. The alternatives were:

1. **Replace Next's server with a custom one.** Rejected: gives up Next's
   production server optimisations and complicates the build for one feature.
2. **Separate process.** Chosen. It mirrors the pattern `worker.ts` already
   uses, needs no change to how the app is built or started, and can be scaled
   or restarted independently of the web tier.

nginx proxies `/socket.io/` to it (`upstream nucrm_realtime`, `ip_hash` so the
long-poll handshake lands on one replica).

### Why Redis, not direct emits

`docker-compose.scale.yml` runs several `web` replicas behind nginx. A
notification created on replica A must reach a socket held by realtime process B.
Publishing to Redis means any publisher reaches every socket server, and the
adapter keeps `io.to(room)` correct across processes.

Redis is already a dependency (cache, BullMQ), so this adds no new infrastructure.

### Rooms are derived from the session, never from client input

The handshake reads the same `nucrm_session` JWT cookie the app uses, verifies it,
then resolves the tenant from `tenant_members` server-side. The client cannot ask
to join a room. Room names are tenant-prefixed (`t:{tenantId}:u:{userId}`) so a
user id alone can never address another tenant's room.

### Envelopes off Redis are validated before broadcast

`isRealtimeMessage()` gates every message. A partially-written or hand-crafted
payload with a missing `tenantId` would otherwise produce a room name like
`t:undefined:u:x`, which could collide across tenants. Invalid messages are
dropped and logged, not forwarded.

## Consequences

**Deliberate trade-offs**

- **Publishing is best-effort and never throws.** A notification row is the source
  of truth; the push is a convenience. If Redis is unreachable, the DB write must
  still succeed — so `publishRealtime()` swallows its errors and returns `false`.
- **SSE is kept as an automatic client fallback.** The realtime process deploys
  separately, so it can legitimately be absent (local dev, partial rollout). On
  `connect_error` the client falls back to the existing SSE stream rather than
  going dark. This means the old polling path stays in the codebase; removing it
  would make realtime a hard dependency of notifications, which is a worse
  failure mode than some retained code.
- **The client increments on `notification:new`** rather than re-querying, which
  is the whole point of leaving polling behind. It seeds the absolute count once
  on connect, and the server can push an authoritative count (mark-all-read
  publishes `0`) to correct any drift.
- **One extra process to operate.** `/healthz` is exposed for the orchestrator,
  and SIGTERM/SIGINT drain sockets before exit.

**Not done**

- The SSE endpoint is not deleted (see fallback above).
- Presence and collaborative editing, mentioned in #644, are not implemented —
  the room and event plumbing supports them, but they need product decisions.

## Verification

Verified end to end against real Redis 7 + PostgreSQL 16:

| Check                              | Result                                 |
| ---------------------------------- | -------------------------------------- |
| `/healthz`                         | `{"status":"ok","sockets":0}`          |
| Unauthenticated socket             | `REJECTED: unauthorized`               |
| Authenticated socket               | resolves correct tenant + user from DB |
| Publish → user room                | delivered                              |
| Publish for a **different tenant** | **not delivered**                      |
| Malformed / tenant-less envelope   | dropped, server stays up               |

Plus 14 unit tests pinning the channel, path, room construction, and envelope
validation.
