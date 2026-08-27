/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Readiness probe — `/api/system/ready`
 *
 * A lightweight, unauthenticated endpoint for container orchestrators (K8s,
 * ECS, Cloud Run) and load balancers. Returns 200 when the instance can serve
 * traffic, 503 when it cannot.
 *
 * Checks:
 *  1. DB pool can execute a trivial query (SELECT 1)
 *  2. The application is not in graceful-shutdown mode
 *
 * Does NOT check:
 *  - Redis (non-critical for request serving, SSE/polling fallback exists)
 *  - Disk space (only relevant for backups, not request handling)
 *  - Backup freshness (operational concern, not readiness)
 *
 * This is deliberately separate from `/api/system/health` which is admin-only
 * and performs a deep diagnostic check. A readiness probe must be:
 *  - Fast (<100ms)
 *  - Unauthenticated (the LB has no session cookie)
 *  - Binary (200 or 503, nothing else matters to the orchestrator)
 *
 * Rate limiting: Not applied. Orchestrators poll every 5-10s per instance;
 * rate-limiting them would cause false-negative health signals.
 */

import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { isShuttingDown } from '@/lib/db/graceful-shutdown';
import { withDbCircuitBreaker, CircuitOpenError } from '@/lib/db/circuit-breaker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // If we are draining, tell the LB to stop sending traffic immediately.
  if (isShuttingDown()) {
    return NextResponse.json(
      { ready: false, reason: 'shutting_down' },
      { status: 503 }
    );
  }

  try {
    const pool = getPool();

    // #1224: run the readiness probe query through the shared DB circuit
    // breaker. When the DB has been failing, the breaker opens and the probe
    // short-circuits to 503 without hammering an already-struggling database,
    // then transitions to half-open after the cooldown to test recovery.
    await withDbCircuitBreaker(() => pool.query('SELECT 1'));

    // Pool saturation check: if all connections are busy and queries are
    // queueing, the instance is alive but unable to serve new traffic at
    // acceptable latency. The LB should route elsewhere.
    //
    // #1152: the orchestrator only needs the 200/503 status and a coarse
    // reason — it never consumes the numeric internals. Exposing exact pool
    // sizing/latency to an unauthenticated endpoint aided infrastructure
    // reconnaissance, so those figures are no longer in the response body.
    const { idleCount, waitingCount } = pool;
    if (waitingCount > 0 && idleCount === 0) {
      return NextResponse.json(
        { ready: false, reason: 'pool_saturated' },
        { status: 503 }
      );
    }

    return NextResponse.json({ ready: true });
  } catch (err) {
    // Do not surface the underlying error message to unauthenticated callers.
    const reason = err instanceof CircuitOpenError ? 'circuit_open' : 'db_unreachable';
    return NextResponse.json(
      { ready: false, reason },
      { status: 503 }
    );
  }
}
