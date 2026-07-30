# ADR-0002: Socket.io with Redis for Realtime

## Status

Accepted

## Context

NuCRM requires realtime updates for deal movements, notifications, and
collaborative features. The system already uses Redis for caching and session
storage. The realtime layer must support multi-instance horizontal scaling,
authenticated channels per tenant, and presence awareness.

## Decision

Use Socket.io with the Redis adapter (`@socket.io/redis-adapter`) for all
realtime communication. Redis pub/sub synchronizes events across multiple
server instances.

Key properties:

- Leverages existing Redis infrastructure with no additional managed services.
- Socket.io handles reconnection, fallback transports, and room-based routing
  natively.
- Redis adapter enables horizontal scaling without sticky sessions at the
  application layer.
- Tenant-scoped rooms (`tenant:{id}`) enforce isolation at the transport level.

## Consequences

- Operational responsibility for WebSocket infrastructure stays in-house rather
  than offloaded to a vendor.
- Redis pub/sub adds slight latency compared to direct in-process events, but
  this is negligible for CRM update frequencies.
- Must handle connection lifecycle (heartbeats, reconnection backoff) in
  application code.
- Socket.io's protocol overhead is larger than raw WebSocket, but the built-in
  features (rooms, acknowledgments, binary support) justify it.

## Alternatives Considered

- **Pusher**: Fully managed, zero infrastructure. Rejected due to per-message
  pricing at scale, vendor lock-in, and inability to leverage existing Redis.
- **Ably**: Similar to Pusher with better protocol support. Rejected for the
  same cost and lock-in concerns.
- **Raw WebSocket + custom pub/sub**: Maximum control, rejected for the
  engineering cost of reimplementing rooms, reconnection, and scaling logic.
