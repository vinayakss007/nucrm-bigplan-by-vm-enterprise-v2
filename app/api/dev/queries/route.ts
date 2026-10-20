/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * GET /api/dev/queries — the slow-query list the dev dashboard polls (#2881).
 *
 * The handler existed. It was called `GET_QUERIES`, and it sat in
 * `app/api/dev/dashboard/route.ts:154` for as long as that file has been in the tree.
 * A Next.js route module routes its HTTP-method exports — `GET`, `POST`, `PUT`,
 * `DELETE`, `PATCH`, `HEAD`, `OPTIONS` — and nothing else, so an export named
 * `GET_QUERIES` is an unused function that happens to type-check: no 404 could tell
 * anyone, the code read exactly like the endpoint it was meant to be, and its
 * `403 Development only` guard looked live.
 *
 * `app/dev/dashboard/page.tsx:78` asks for `/api/dev/queries?limit=50&slow=true`; the
 * Queries tab rendered "Slow Database Queries" over an empty list on a dev box whose
 * `devLogger.query()` was filling the buffer the whole time.
 *
 * Same body as before, now reachable, with two changes that only a real endpoint can
 * have: the gate also requires a super admin (`requireDevAccess`), because this dumps
 * SQL text and bind parameters, and `limit`/`threshold` are clamped instead of
 * `parseInt`, so `?limit=abc` cannot become `slice(-NaN)` — which is `slice(0)`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDevAccess } from '@/lib/dev-access';
import { devLogger } from '@/lib/dev-logger';
import { clampInt } from '@/lib/api/query-params';

/** `devLogger.query()` keeps the last 500 (`lib/dev-logger.ts:263`). */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_THRESHOLD_MS = 100;

export async function GET(request: NextRequest) {
  const access = await requireDevAccess(request);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(request.url);
  const limit = clampInt(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const threshold = clampInt(searchParams.get('threshold'), DEFAULT_THRESHOLD_MS, 0, 600_000);
  const slowOnly = searchParams.get('slow') === 'true';

  let queries = devLogger.exportLogs().queries;
  if (slowOnly) {
    queries = queries.filter((q) => q.duration > threshold);
  }

  return NextResponse.json({
    queries: queries.slice(-limit),
    total: queries.length,
    // `total` is what the filter left; this is how many of those cross the line the
    // Overview tab's "Slow Queries" card counts with the same threshold
    slow: queries.filter((q) => q.duration > threshold).length,
  });
}
