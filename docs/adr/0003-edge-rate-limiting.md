# ADR-0003: In-Memory Edge Rate Limiting

## Status

Accepted

## Context

NuCRM uses Next.js middleware for authentication and request preprocessing.
Rate limiting must run at the edge (middleware layer) to reject abusive traffic
before it reaches API routes or the database. A Redis round-trip per request at
the edge adds 5-15ms latency, which is unacceptable for the hot path on every
single request.

## Decision

Use in-memory sliding window rate limiting in Next.js middleware, synchronized
periodically with Redis for cross-instance consistency.

Key properties:

- Per-request rate checks happen in-memory with sub-millisecond latency.
- Redis sync runs on a configurable interval (default: 5 seconds) to share
  counters across instances.
- Token bucket algorithm with per-tenant and per-IP dimensions.
- Graceful degradation: if Redis sync fails, local counters continue
  functioning independently.

## Consequences

- Rate limits are eventually consistent across instances within the sync
  interval. A burst could briefly exceed limits during the sync window.
- Memory usage grows linearly with active client count; a TTL-based eviction
  ensures bounded memory.
- More complex than a pure Redis solution: two layers of state to reason about.
- Edge middleware cold starts carry the in-memory map initialization cost.

## Alternatives Considered

- **Redis-only (e.g., `@upstash/ratelimit`)**: Simplest architecture with
  strong consistency. Rejected because the per-request Redis round-trip at the
  edge adds unacceptable latency for every request.
- **Cloudflare Rate Limiting**: Vendor-specific, not portable across deployment
  targets. Rejected for lock-in.
- **Application-level only (no edge)**: Allows abusive traffic to reach API
  routes and consume compute. Rejected for insufficient protection.
